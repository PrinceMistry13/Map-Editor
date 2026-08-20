export async function detectUnitsFromImage(floorPlanManager, floorPlanId) {
    const entry = floorPlanManager.overlays.get(floorPlanId);
    if (!entry) throw new Error('Floor plan not found');

    const { url, originalWidth: W, originalHeight: H } = entry;
    if (typeof cv === 'undefined') throw new Error('OpenCV is not loaded yet.');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, W, H);
    const imageData = ctx.getImageData(0, 0, W, H);

    let matsToDelete = [];
    try {
        let src = cv.matFromImageData(imageData);
        matsToDelete.push(src);

        let gray = new cv.Mat();
        matsToDelete.push(gray);
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
        cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        let imageArea = W * H;
        // Helper: bounding box of a pixel-path
        // Fix: Canny edge-following on a diagonal line produces pixel "staircase" steps.
        // approxPolyDP's epsilon is often too small to flatten these into one straight
        // segment, so the steps survive as many near-collinear vertices — this drops
        // any vertex whose turn angle is below threshold, keeping only real corners.
        function simplifyCollinear(pixels, angleThresholdDeg = 6) {
            if (pixels.length <= 3) return pixels;
            const n = pixels.length;
            const result = [];
            for (let i = 0; i < n; i++) {
                const prev = pixels[(i - 1 + n) % n];
                const curr = pixels[i];
                const next = pixels[(i + 1) % n];
                const v1x = curr.x - prev.x, v1y = curr.y - prev.y;
                const v2x = next.x - curr.x, v2y = next.y - curr.y;
                const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
                if (len1 === 0 || len2 === 0) continue; // drop duplicate points
                const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
                const angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
                if (angleDeg > angleThresholdDeg) result.push(curr); // real corner — keep
            }
            return result.length >= 3 ? result : pixels;
        }

        function getBBox(pixels) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let p of pixels) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }

        // --- Core Detection Pass: multi-preset Canny + shape-quality filter ---
        const parameterSets = [
            { canny: [50, 150], dilate: 1 },
            { canny: [30, 90], dilate: 2 },
            { canny: [80, 200], dilate: 0 }
        ];

        const minArea = imageArea * 0.0005; // reject tiny noise (< 0.05% of image)
        const maxArea = imageArea * 0.8;    // reject huge outer boundary (> 80% of image)
        let candidateContours = [];

        // --- Diagnostic instrumentation ---
        const DEBUG_REJECTIONS = true;
        function logReject(stage, area, bbox, extra = '') {
            if (!DEBUG_REJECTIONS) return;
            console.log(`[Reject:${stage}] area=${area.toFixed(0)} bbox=(${bbox.x},${bbox.y},${bbox.w},${bbox.h}) ${extra}`);
        }

        const M = cv.Mat.ones(3, 3, cv.CV_8U);
        matsToDelete.push(M);

        for (const params of parameterSets) {
            let edges = new cv.Mat();
            matsToDelete.push(edges);
            cv.Canny(gray, edges, params.canny[0], params.canny[1], 3, false);

            if (params.dilate > 0) {
                cv.dilate(edges, edges, M, new cv.Point(-1, -1), params.dilate, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
                cv.erode(edges, edges, M, new cv.Point(-1, -1), params.dilate, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
            }

            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            matsToDelete.push(contours, hierarchy);
            cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

            for (let i = 0; i < contours.size(); ++i) {
                const contour = contours.get(i);
                try {
                    const area = cv.contourArea(contour);
                    if (!(area > minArea && area < maxArea)) {
                        logReject('base-area', area, cv.boundingRect(contour));
                        continue;
                    }

                    const hull = new cv.Mat();
                    try {
                        cv.convexHull(contour, hull, false, true);
                        const hullArea = cv.contourArea(hull);
                        const solidity = hullArea > 0 ? area / hullArea : 0;

                        const rect = cv.boundingRect(hull);
                        const aspectRatio = Math.max(rect.width / rect.height, rect.height / rect.width);
                        const rectangularity = area / (rect.width * rect.height);

                        // Fix: taper/wedge plots (narrow, road-facing, converging to a point)
                        // have low area-to-bbox ratio by geometry, not by noise — relax the
                        // rectangularity floor as aspect ratio climbs instead of one flat cutoff.
                        const rectangularityFloor = aspectRatio > 4 ? 0.15 : 0.3;
                        if (solidity > 0.5 && aspectRatio < 10 && rectangularity > rectangularityFloor) {

                            const approx = new cv.Mat();
                            try {
                                // Relaxed relative epsilon (0.8% of hull arc length) smooths text-bump jaggedness
                                const epsilon = 0.008 * cv.arcLength(hull, true);
                                cv.approxPolyDP(hull, approx, epsilon, true);

                                // Allow up to 12 vertices to prevent rejecting slightly noisy plots
                                if (approx.rows >= 4 && approx.rows <= 12) {
                                    const M_moments = cv.moments(hull);
                                    const cx = M_moments.m10 / M_moments.m00;
                                    const cy = M_moments.m01 / M_moments.m00;

                                    const rawPixels = [];
                                    for (let j = 0; j < approx.rows; j++) {
                                        rawPixels.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
                                    }
                                    const pixels = simplifyCollinear(rawPixels);
                                    candidateContours.push({ area, cx, cy, pixels, bbox: getBBox(pixels), aspectRatio });
                                } else {
                                    logReject('vertex-count', area, cv.boundingRect(hull), `vertices=${approx.rows}`);
                                }
                            } finally {
                                approx.delete();
                            }
                        } else {
                            logReject('shape-filter', area, cv.boundingRect(hull),
                                `solidity=${solidity.toFixed(2)} ar=${aspectRatio.toFixed(2)} rect=${rectangularity.toFixed(2)} floor=${rectangularityFloor}`);
                        }
                    } finally {
                        hull.delete();
                    }
                } finally {
                    contour.delete();
                }
            }
        }

        if (candidateContours.length === 0) return [];

        // Area-range filtering relative to the detected median plot size
        candidateContours.sort((a, b) => a.area - b.area);
        const medianArea = candidateContours[Math.floor(candidateContours.length / 2)].area;
        // Fix: absolute floor alongside the relative one, so small road-facing wedge
        // plots aren't wiped out just because the median is dominated by larger plots.
        const dynamicMinArea = Math.min(medianArea * 0.1, imageArea * 0.0008);
        const maxPlotArea = medianArea * 15.0;
        let uniqueCandidates = candidateContours.filter(c => {
            const keep = c.area >= dynamicMinArea && c.area <= maxPlotArea;
            if (!keep) logReject('area-range', c.area, c.bbox, `medianArea=${medianArea.toFixed(0)}`);
            return keep;
        });

        // Centroid-distance dedup: process smallest-first. When a duplicate is found
        // (same plot detected twice due to inner/outer border-line edges), keep
        // whichever is the TRUE outer boundary — but only swap to the larger one if
        // the area increase is modest (inner vs outer stroke-width offset is small).
        // A big area jump means the "duplicate" is actually a separate merged
        // multi-plot blob, not the same plot's outer edge — so it must be rejected,
        // not swapped in.
        const MAX_OUTER_INNER_AREA_RATIO = 1.4; // tune if borders are unusually thick
        const acceptedForDedup = [];
        const dedupedCandidates = [];
        for (const candidate of uniqueCandidates) {
            let dupIndex = -1;
            for (let k = 0; k < acceptedForDedup.length; k++) {
                const accepted = acceptedForDedup[k];
                // Fix: require actual polygon overlap (bbox IoU) instead of pure centroid
                // proximity — narrow plots in a row along a road can have centroids close
                // together while being genuinely distinct plots.
                const accBbox = accepted.bbox || getBBox(accepted.pixels);
                const candBbox = candidate.bbox || getBBox(candidate.pixels);
                const ix2 = Math.max(accBbox.x, candBbox.x);
                const iy2 = Math.max(accBbox.y, candBbox.y);
                const iw2 = Math.min(accBbox.x + accBbox.w, candBbox.x + candBbox.w) - ix2;
                const ih2 = Math.min(accBbox.y + accBbox.h, candBbox.y + candBbox.h) - iy2;
                const interArea2 = (iw2 > 0 && ih2 > 0) ? iw2 * ih2 : 0;
                const unionArea2 = accBbox.w * accBbox.h + candBbox.w * candBbox.h - interArea2;
                const iou = unionArea2 > 0 ? interArea2 / unionArea2 : 0;
                if (iou > 0.4) {
                    dupIndex = k;
                    break;
                }
            }
            if (dupIndex === -1) {
                acceptedForDedup.push(candidate);
                dedupedCandidates.push(candidate);
            } else {
                const accepted = acceptedForDedup[dupIndex];
                const areaRatio = candidate.area / accepted.area;
                if (areaRatio > 1.0 && areaRatio < MAX_OUTER_INNER_AREA_RATIO) {
                    const idxInDeduped = dedupedCandidates.indexOf(accepted);
                    dedupedCandidates[idxInDeduped] = candidate;
                    acceptedForDedup[dupIndex] = candidate;
                } else {
                    logReject('dedup', candidate.area, candidate.bbox || getBBox(candidate.pixels),
                        `matchedIdx=${dupIndex} areaRatio=${areaRatio.toFixed(2)}`);
                }
            }
        }
        uniqueCandidates = dedupedCandidates;

        // --- Final Invariant Check: Zero Overlap Guarantee ---
        // Ensure no two plots overlap by more than a small sliver (e.g. 5% area).
        let validFinalCandidates = [];
        for (let i = 0; i < uniqueCandidates.length; i++) {
            let c = uniqueCandidates[i];
            if (!c.bbox) c.bbox = getBBox(c.pixels); // Ensure gap-fill candidates have bbox
            let hasConflict = false;

            for (let j = 0; j < validFinalCandidates.length; j++) {
                let u = validFinalCandidates[j];
                let ix = Math.max(c.bbox.x, u.bbox.x);
                let iy = Math.max(c.bbox.y, u.bbox.y);
                let iw = Math.min(c.bbox.x + c.bbox.w, u.bbox.x + u.bbox.w) - ix;
                let ih = Math.min(c.bbox.y + c.bbox.h, u.bbox.y + u.bbox.h) - iy;

                if (iw > 0 && ih > 0) {
                    // Mask must cover the UNION of both polygons, not just the
                    // intersection box — fillPoly is given full polygon point
                    // lists below, and points landing outside the mask bounds
                    // is what causes native "memory access out of bounds".
                    let ux = Math.min(c.bbox.x, u.bbox.x);
                    let uy = Math.min(c.bbox.y, u.bbox.y);
                    let uw = Math.max(c.bbox.x + c.bbox.w, u.bbox.x + u.bbox.w) - ux;
                    let uh = Math.max(c.bbox.y + c.bbox.h, u.bbox.y + u.bbox.h) - uy;

                    let mask1 = cv.Mat.zeros(uh, uw, cv.CV_8U);
                    let mask2 = cv.Mat.zeros(uh, uw, cv.CV_8U);
                    let inter = new cv.Mat();

                    let flat1 = [], flat2 = [];
                    for (let p of c.pixels) flat1.push(p.x - ux, p.y - uy);
                    for (let p of u.pixels) flat2.push(p.x - ux, p.y - uy);

                    let mat1 = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flat1);
                    let pts1 = new cv.MatVector(); pts1.push_back(mat1);
                    cv.fillPoly(mask1, pts1, new cv.Scalar(255));

                    let mat2 = cv.matFromArray(u.pixels.length, 1, cv.CV_32SC2, flat2);
                    let pts2 = new cv.MatVector(); pts2.push_back(mat2);
                    cv.fillPoly(mask2, pts2, new cv.Scalar(255));

                    cv.bitwise_and(mask1, mask2, inter);
                    let overlapArea = cv.countNonZero(inter);

                    mask1.delete(); mask2.delete(); inter.delete();
                    mat1.delete(); pts1.delete(); mat2.delete(); pts2.delete();

                    // If overlap is > 5% of the smaller area, it's a conflict
                    let minArea = Math.min(c.area, u.area);
                    if (overlapArea > minArea * 0.05) {
                        hasConflict = true;
                        logReject('overlap-conflict', c.area, c.bbox, `overlapPct=${(overlapArea / minArea * 100).toFixed(1)}% conflictsWithIdx=${j}`);
                        break;
                    }
                }
            }

            if (!hasConflict) {
                validFinalCandidates.push(c);
            }
        }

        uniqueCandidates = validFinalCandidates;

        // --- Sequential Numbering (no OCR) ---
        // Number plots 1..N in reading order (top-to-bottom, then left-to-right
        // within a row band) so numbering is stable and predictable rather than
        // depending on contour-detection order. Every candidate gets a number;
        // since it's just an incrementing counter, numbers are guaranteed unique.
        const rowBandHeight = Math.max(1, medianArea > 0 ? Math.sqrt(medianArea) * 0.5 : H * 0.01);
        const readingOrder = [...uniqueCandidates].sort((a, b) => {
            const rowA = Math.floor(a.cy / rowBandHeight);
            const rowB = Math.floor(b.cy / rowBandHeight);
            if (rowA !== rowB) return rowA - rowB;
            return a.cx - b.cx;
        });
        readingOrder.forEach((c, idx) => {
            c.id = String(idx + 1);
        });

        console.log(`=== AutoPlot Summary === ${uniqueCandidates.length} plots numbered 1-${uniqueCandidates.length}`);

        // Output strictly requested JSON format
        let extractedJSON = {
            "Extracted_Plots": uniqueCandidates
                .filter(c => c.id !== null)
                .map(c => ({
                    plot_number: parseInt(c.id, 10),
                    status: "Assigned to boundary"
                }))
        };
        console.log(JSON.stringify(extractedJSON, null, 2));

        // --- Final Projection ---
        // True polygon offset: push each EDGE outward along its own perpendicular
        // normal (not each vertex radially from centroid — that under-offsets long
        // edges on non-square rectangles). Recompute corners as intersections of
        // adjacent offset edges. Closes the Canny stroke-midpoint inset gap uniformly
        // on all sides regardless of plot aspect ratio.
        // Fix: a single offset can't center on two different line thicknesses. In this
        // dataset horizontal dividers are roads (a wide dark band) while vertical
        // dividers are thin property-line strokes — that's why vertical edges land
        // near-centered but horizontal edges undershoot by a visible margin. Using two
        // constants, chosen by edge orientation, keeps the same symmetric/uniform
        // design that was working (every plot still uses the SAME value as its
        // neighbor for a shared edge — nothing became per-plot or asymmetric).
        //
        // HOW TO TUNE: zoom into a screenshot at 100% (native pixels, not the browser
        // zoom), measure the black band's width in pixels for a vertical property line
        // and separately for a horizontal road, then set each constant to HALF of what
        // you measure.
        const OUTWARD_OFFSET_PX_VERTICAL = 1.2;   // thin plot-to-plot boundary lines
        const OUTWARD_OFFSET_PX_HORIZONTAL = 3.0; // wider road band — increase further if still short of center
        function offsetForCandidate(c) {
            return OUTWARD_OFFSET_PX_VERTICAL; // unused now, kept only so nothing else breaks if referenced elsewhere
        }

        function offsetPolygonOutward(pixels) {
            const n = pixels.length;
            if (n < 3) return pixels;

            let ccx = 0, ccy = 0;
            for (const p of pixels) { ccx += p.x; ccy += p.y; }
            ccx /= n; ccy /= n;

            const offsetLines = [];
            for (let i = 0; i < n; i++) {
                const p1 = pixels[i], p2 = pixels[(i + 1) % n];
                const dx = p2.x - p1.x, dy = p2.y - p1.y;
                const len = Math.hypot(dx, dy);
                if (len === 0) { offsetLines.push({ p1, p2 }); continue; }
                let nx = -dy / len, ny = dx / len;
                const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
                const toMidX = midX - ccx, toMidY = midY - ccy;
                if (nx * toMidX + ny * toMidY < 0) { nx = -nx; ny = -ny; }
                // Fix: pick the offset by this edge's own orientation (near-horizontal
                // edges are roads, near-vertical are plot lines) — same constant used
                // by every plot for that orientation, so shared edges still agree.
                const offsetPx = Math.abs(dx) > Math.abs(dy)
                    ? OUTWARD_OFFSET_PX_HORIZONTAL
                    : OUTWARD_OFFSET_PX_VERTICAL;
                const offP1 = { x: p1.x + nx * offsetPx, y: p1.y + ny * offsetPx };
                const offP2 = { x: p2.x + nx * offsetPx, y: p2.y + ny * offsetPx };
                offsetLines.push({ p1: offP1, p2: offP2 });
            }

            // Recompute corners as line-line intersections of consecutive offset edges
            function lineIntersect(a1, a2, b1, b2) {
                const d1x = a2.x - a1.x, d1y = a2.y - a1.y;
                const d2x = b2.x - b1.x, d2y = b2.y - b1.y;
                const denom = d1x * d2y - d1y * d2x;
                if (Math.abs(denom) < 1e-9) return a2; // parallel — fallback
                const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom;
                return { x: a1.x + t * d1x, y: a1.y + t * d1y };
            }

            const newPixels = [];
            for (let i = 0; i < n; i++) {
                const prevLine = offsetLines[(i - 1 + n) % n];
                const currLine = offsetLines[i];
                newPixels.push(lineIntersect(prevLine.p1, prevLine.p2, currLine.p1, currLine.p2));
            }
            return newPixels;
        }

        // Step 1: offset every candidate's polygon independently first
        const offsetResults = uniqueCandidates.map(c => ({
            c,
            pixels: offsetPolygonOutward(c.pixels)
        }));

        const SNAP_TOLERANCE_PX = Math.max(OUTWARD_OFFSET_PX_HORIZONTAL, OUTWARD_OFFSET_PX_VERTICAL) * 2;

        const allVerts = [];
        offsetResults.forEach((res, ci) => {
            res.pixels.forEach((p, vi) => allVerts.push({ ci, vi, x: p.x, y: p.y }));
        });

        const clusters = [];
        const assigned = new Array(allVerts.length).fill(-1);
        for (let i = 0; i < allVerts.length; i++) {
            if (assigned[i] !== -1) continue;
            const cluster = [i];
            assigned[i] = clusters.length;
            for (let j = i + 1; j < allVerts.length; j++) {
                if (assigned[j] !== -1) continue;
                const dist = Math.hypot(allVerts[i].x - allVerts[j].x, allVerts[i].y - allVerts[j].y);
                if (dist < SNAP_TOLERANCE_PX) {
                    cluster.push(j);
                    assigned[j] = clusters.length;
                }
            }
            clusters.push(cluster);
        }

        for (const cluster of clusters) {
            if (cluster.length < 2) continue;
            let sx = 0, sy = 0;
            for (const idx of cluster) { sx += allVerts[idx].x; sy += allVerts[idx].y; }
            const avgX = sx / cluster.length, avgY = sy / cluster.length;
            for (const idx of cluster) {
                const { ci, vi } = allVerts[idx];
                offsetResults[ci].pixels[vi] = { x: avgX, y: avgY };
            }
        }

        // Step 3: project snapped pixels
        let detectedPaths = [];
        for (const { c, pixels } of offsetResults) {
            let latLngs = floorPlanManager.projectPixelsToLatLngs(floorPlanId, pixels, W, H);
            if (latLngs && latLngs.length > 0) {
                detectedPaths.push({ path: latLngs, id: c.id, sqyd: c.sqyd, length: c.length, width: c.width });
            }
        }

        return detectedPaths;

    } finally {
        for (let mat of matsToDelete) {
            if (mat) {
                try { mat.delete(); } catch (e) { }
            }
        }
    }
}