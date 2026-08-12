// import Tesseract from 'tesseract.js';

// export async function detectUnitsFromImage(floorPlanManager, floorPlanId) {
//   const entry = floorPlanManager.overlays.get(floorPlanId);
//   if (!entry) throw new Error('Floor plan not found');

//   const { url, originalWidth: W, originalHeight: H } = entry;
//   if (typeof cv === 'undefined') throw new Error('OpenCV is not loaded yet.');

//   const res = await fetch(url);
//   if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
//   const blob = await res.blob();
//   const bitmap = await createImageBitmap(blob);

//   const canvas = document.createElement('canvas');
//   canvas.width = W;
//   canvas.height = H;
//   const ctx = canvas.getContext('2d', { willReadFrequently: true });
//   ctx.drawImage(bitmap, 0, 0, W, H);
//   const imageData = ctx.getImageData(0, 0, W, H);

//   // --- OCR PREPROCESSING ---
//   let cvMatsToClean = [];
//   let ocrCanvas = document.createElement('canvas');
//   try {
//       let srcOcr = cv.matFromImageData(imageData);
//       cvMatsToClean.push(srcOcr);

//       let ocrScaled = new cv.Mat();
//       cvMatsToClean.push(ocrScaled);
//       cv.resize(srcOcr, ocrScaled, new cv.Size(), 2.0, 2.0, cv.INTER_CUBIC);

//       let ocrGray = new cv.Mat();
//       cvMatsToClean.push(ocrGray);
//       cv.cvtColor(ocrScaled, ocrGray, cv.COLOR_RGBA2GRAY, 0);

//       let ocrThresh = new cv.Mat();
//       cvMatsToClean.push(ocrThresh);
//       // Adaptive Threshold (from user spec: cv2.THRESH_BINARY, 25, 10)
//       cv.adaptiveThreshold(ocrGray, ocrThresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 10);

//       let ocrRgba = new cv.Mat();
//       cvMatsToClean.push(ocrRgba);
//       cv.cvtColor(ocrThresh, ocrRgba, cv.COLOR_GRAY2RGBA, 0);

//       let ocrImgData = new ImageData(new Uint8ClampedArray(ocrRgba.data), ocrRgba.cols, ocrRgba.rows);
//       ocrCanvas.width = ocrRgba.cols;
//       ocrCanvas.height = ocrRgba.rows;
//       ocrCanvas.getContext('2d').putImageData(ocrImgData, 0, 0);
//   } finally {
//       for (let m of cvMatsToClean) {
//           if (m) { try { m.delete(); } catch(e) {} }
//       }
//   }

//   // --- OCR PASS ---
//   const worker = await Tesseract.createWorker('eng');
//   await worker.setParameters({ 
//       tessedit_char_whitelist: '0123456789\'"- ./',
//       tessedit_pageseg_mode: '11' // SPARSE_TEXT
//   });
//   const tesseractResult = await worker.recognize(ocrCanvas, {}, { tsv: true });
//   await worker.terminate();

//   let ocrLabels = [];
//   if (tesseractResult.data.tsv) {
//       const tsvLines = tesseractResult.data.tsv.split('\n');
//       for (let i = 1; i < tsvLines.length; i++) {
//           let parts = tsvLines[i].split('\t');
//           if (parts.length >= 12) {
//               let level = parseInt(parts[0]);
//               let conf = parseFloat(parts[10]);
//               let text = parts.slice(11).join('\t').trim();

//               // Apply confidence gate > 25 (relaxed)
//               if (level === 5 && text && conf >= 25) { 
//                   // Divide coords by 2 because we upscaled 2x
//                   let left = parseInt(parts[6]) / 2.0;
//                   let top = parseInt(parts[7]) / 2.0;
//                   let width = parseInt(parts[8]) / 2.0;
//                   let height = parseInt(parts[9]) / 2.0;
//                   let cx = left + width / 2;
//                   let cy = top + height / 2;
//                   ocrLabels.push({ text: text, x: cx, y: cy, height: height, x0: left, y0: top, width: width, conf: conf });
//               }
//           }
//       }
//   }

//   function ptInPolygon(pt, pixels) {
//       let inside = false;
//       for (let i = 0, j = pixels.length - 1; i < pixels.length; j = i++) {
//           let xi = pixels[i].x, yi = pixels[i].y;
//           let xj = pixels[j].x, yj = pixels[j].y;
//           let intersect = ((yi > pt.y) !== (yj > pt.y))
//               && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
//           if (intersect) inside = !inside;
//       }
//       return inside;
//   }

//   let matsToDelete = [];
//   try {
//     let src = cv.matFromImageData(imageData);
//     matsToDelete.push(src);

//     let gray = new cv.Mat();
//     matsToDelete.push(gray);
//     cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
//     cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

//     let imageArea = W * H;
//     let allCandidates = [];

//     // Helper function to process contours and extract valid polygons
//     function processContours(contours) {
//         for (let i = 0; i < contours.size(); i++) {
//             let contour = contours.get(i);
//             let area = cv.contourArea(contour);
//             let hull = new cv.Mat();
//             cv.convexHull(contour, hull, false, true);
//             let hullArea = cv.contourArea(hull);

//             // Strict shape constraint: rely purely on solidity (rotation invariant)
//             // Increased to 0.70 to reject highly irregular/scattered shapes like trees/bushes while preserving L-shaped plots
//             let solidity = hullArea > 0 ? area / hullArea : 0;

//             if (solidity > 0.70) {
//                 let rect = cv.boundingRect(contour);

//                 // 1. Text Masking: reject small contours mostly inside OCR text bounding boxes (e.g., text loops like '8', '0')
//                 let isText = false;
//                 for (let lbl of ocrLabels) {
//                     let intersectX = Math.max(0, Math.min(rect.x + rect.width, lbl.x0 + lbl.width) - Math.max(rect.x, lbl.x0));
//                     let intersectY = Math.max(0, Math.min(rect.y + rect.height, lbl.y0 + lbl.height) - Math.max(rect.y, lbl.y0));
//                     if (intersectX > 0 && intersectY > 0) {
//                         let intersectArea = intersectX * intersectY;
//                         let rectArea = rect.width * rect.height;
//                         // Prevent accidentally dropping valid plots by ensuring the contour is small enough to be text
//                         if (intersectArea > rectArea * 0.6 && rectArea < imageArea * 0.01) {
//                             isText = true; break;
//                         }
//                     }
//                 }
//                 if (isText) {
//                     hull.delete();
//                     continue;
//                 }

//                 let approx = new cv.Mat();
//                 let minDim = Math.min(rect.width, rect.height);
//                 let epsilon = Math.max(1.5, 0.05 * minDim);
//                 cv.approxPolyDP(contour, approx, epsilon, true);

//                 let approxPixels = [];
//                 for (let j = 0; j < approx.rows; j++) {
//                     approxPixels.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
//                 }

//                 // Keep base structural shapes with 4 to 12 vertices
//                 if (approxPixels.length >= 4 && approxPixels.length <= 12) {
//                     let origPixels = [];
//                     for (let j = 0; j < contour.rows; j++) {
//                         origPixels.push({ x: contour.data32S[j*2], y: contour.data32S[j*2+1] });
//                     }

//                     let approxIndices = [];
//                     let searchIdx = 0;
//                     for (let p of approxPixels) {
//                         let found = false;
//                         for (let i = 0; i < origPixels.length; i++) {
//                             let idx = (searchIdx + i) % origPixels.length;
//                             if (origPixels[idx].x === p.x && origPixels[idx].y === p.y) {
//                                 approxIndices.push(idx);
//                                 searchIdx = idx;
//                                 found = true;
//                                 break;
//                             }
//                         }
//                         if (!found) approxIndices.push(-1);
//                     }

//                     let finalPixels = [];
//                     function pointLineDist(P, A, B) {
//                         let num = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y));
//                         let den = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
//                         return den === 0 ? 0 : num / den;
//                     }

//                     let hasGenuineCurves = false;

//                     for (let i = 0; i < approxPixels.length; i++) {
//                         let p1 = approxPixels[i];
//                         let idx1 = approxIndices[i];
//                         finalPixels.push(p1);

//                         if (idx1 === -1) continue;

//                         let nextI = (i + 1) % approxPixels.length;
//                         let p2 = approxPixels[nextI];
//                         let idx2 = approxIndices[nextI];

//                         if (idx2 === -1) continue;

//                         let segment = [];
//                         if (idx2 > idx1) {
//                             segment = origPixels.slice(idx1 + 1, idx2);
//                         } else if (idx2 < idx1) {
//                             segment = origPixels.slice(idx1 + 1).concat(origPixels.slice(0, idx2));
//                         }

//                         if (segment.length > 8) {
//                             let maxDist = 0;
//                             for (let pt of segment) {
//                                 let dist = pointLineDist(pt, p1, p2);
//                                 if (dist > maxDist) maxDist = dist;
//                             }
//                             // Reinsert points to faithfully trace the curve if it deviates from the straight edge
//                             // Increased threshold from 2.0 to ignore small pixel-level jerks/wobbles on straight lines
//                             if (maxDist > Math.max(6.0, minDim * 0.01)) {
//                                 hasGenuineCurves = true;
//                                 let step = Math.floor(segment.length / 5);
//                                 if (step > 0) {
//                                     finalPixels.push(segment[step]);
//                                     finalPixels.push(segment[step * 2]);
//                                     finalPixels.push(segment[step * 3]);
//                                     finalPixels.push(segment[step * 4]);
//                                 }
//                             }
//                         }
//                     }

//                     // Default to 4-point polygons. If it's more than 4 points and has no curves, aggressively smooth it.
//                     if (!hasGenuineCurves && finalPixels.length > 4) {
//                         let aggressiveApprox = new cv.Mat();
//                         cv.approxPolyDP(contour, aggressiveApprox, epsilon * 2.0, true);

//                         let aggressivePixels = [];
//                         for (let j = 0; j < aggressiveApprox.rows; j++) {
//                             aggressivePixels.push({ x: aggressiveApprox.data32S[j*2], y: aggressiveApprox.data32S[j*2+1] });
//                         }
//                         aggressiveApprox.delete();

//                         // If it STILL needs more than 6 points after aggressive smoothing, it's a jagged noisy blob (e.g. trees), reject it.
//                         if (aggressivePixels.length > 6) {
//                             continue; // Reject this candidate
//                         }

//                         finalPixels = aggressivePixels;
//                     }

//                     let cx = rect.x + rect.width / 2;
//                     let cy = rect.y + rect.height / 2;
//                     allCandidates.push({ area, pixels: finalPixels, cx, cy });
//                 }
//                 approx.delete();
//             }
//             hull.delete();
//         }
//     }

//     // --- PASS A: Edge-Based Detection (Canny on Black Lines) ---
//     // Threshold to isolate ONLY genuine black/dark plot-boundary strokes (< 140)
//     let blackMask = new cv.Mat();
//     matsToDelete.push(blackMask);
//     cv.threshold(gray, blackMask, 140, 255, cv.THRESH_BINARY);

//     let parameterSets = [
//       { dilate: 0 }, 
//       { dilate: 1, kernelSize: 2 }, 
//       { dilate: 2, kernelSize: 3 }
//     ];

//     for (let params of parameterSets) {
//         let edges = new cv.Mat();
//         matsToDelete.push(edges);
//         // Canny on a binary mask only needs basic thresholds since edges are purely 0 to 255
//         cv.Canny(blackMask, edges, 10, 50, 3, false);

//         if (params.dilate > 0) {
//             let ks = params.kernelSize || (params.dilate * 2 + 1);
//             let kernel = cv.Mat.ones(ks, ks, cv.CV_8U);
//             cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
//             cv.erode(edges, edges, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
//             kernel.delete();
//         }

//         let contours = new cv.MatVector();
//         let hierarchy = new cv.Mat();
//         matsToDelete.push(contours, hierarchy);

//         cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
//         processContours(contours);
//     }

//     // --- PASS B: Fill-Based Detection (Color Region Segmentation) ---
//     // Plots have bright fills, while lines and text are dark.
//     let fillBin = new cv.Mat();
//     matsToDelete.push(fillBin);
//     // Use OTSU to dynamically separate bright colored fills from dark lines
//     cv.threshold(gray, fillBin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

//     // Erode the white fills slightly to thicken the black dividing lines, ensuring adjacent plots disconnect
//     let fillErodeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
//     matsToDelete.push(fillErodeKernel);
//     cv.erode(fillBin, fillBin, fillErodeKernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

//     let fillContours = new cv.MatVector();
//     let fillHierarchy = new cv.Mat();
//     matsToDelete.push(fillContours, fillHierarchy);

//     // RETR_EXTERNAL traces the outside of the white fills, natively ignoring the dark text/numbers inside
//     cv.findContours(fillBin, fillContours, fillHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
//     processContours(fillContours);

//     if (allCandidates.length === 0) return [];

//     // --- Pre-filter Absolute Outliers ---
//     // Baseline minimum area (0.02%) to ensure even extremely narrow townhome plots are included
//     let minPlotArea = imageArea * 0.0002; 
//     let maxPlotArea = imageArea * 0.20;

//     let validCandidates = allCandidates.filter(c => c.area >= minPlotArea && c.area <= maxPlotArea);
//     if (validCandidates.length === 0) return [];

//     // --- Area Clustering (Local Filtering) ---
//     // Sort by area to group similar sized plots together
//     validCandidates.sort((a, b) => a.area - b.area);
//     let clusters = [];
//     let currentCluster = [validCandidates[0]];

//     for (let i = 1; i < validCandidates.length; i++) {
//         // Break into a new cluster if the area jumps by more than 2x
//         if (validCandidates[i].area > currentCluster[currentCluster.length - 1].area * 2.0) {
//             clusters.push(currentCluster);
//             currentCluster = [validCandidates[i]];
//         } else {
//             currentCluster.push(validCandidates[i]);
//         }
//     }
//     clusters.push(currentCluster);

//     // Find the typical size of a REAL plot by looking at candidates larger than 0.05% of the image
//     let likelyPlots = validCandidates.filter(c => c.area > imageArea * 0.0005);
//     let medianPlotArea = minPlotArea;
//     if (likelyPlots.length > 0) {
//         medianPlotArea = likelyPlots[Math.floor(likelyPlots.length / 2)].area;
//     } else if (validCandidates.length > 0) {
//         medianPlotArea = validCandidates[Math.floor(validCandidates.length / 2)].area;
//     }

//     // A genuine plot is almost never smaller than 10% of the median plot size in a subdivision
//     let dynamicMinArea = Math.max(minPlotArea, medianPlotArea * 0.10);

//     let filteredCandidates = [];
//     for (let cluster of clusters) {
//         for (let c of cluster) {
//             // Strictly reject tiny shapes (text loops, labels) using dynamic minimum
//             if (c.area >= dynamicMinArea) {
//                 filteredCandidates.push(c);
//             }
//         }
//     }

//     // --- Deduplication (IoU) ---
//     function getBBox(pixels) {
//         let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
//         for (let p of pixels) {
//             if (p.x < minX) minX = p.x;
//             if (p.x > maxX) maxX = p.x;
//             if (p.y < minY) minY = p.y;
//             if (p.y > maxY) maxY = p.y;
//         }
//         return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
//     }

//     for (let c of filteredCandidates) c.bbox = getBBox(c.pixels);

//     let uniqueCandidates = [];

//     for (let c of filteredCandidates) {
//         let isDuplicate = false;
//         for (let i = 0; i < uniqueCandidates.length; i++) {
//             let u = uniqueCandidates[i];

//             // Fast bounding box check
//             let ix = Math.max(c.bbox.x, u.bbox.x);
//             let iy = Math.max(c.bbox.y, u.bbox.y);
//             let iw = Math.min(c.bbox.x + c.bbox.w, u.bbox.x + u.bbox.w) - ix;
//             let ih = Math.min(c.bbox.y + c.bbox.h, u.bbox.y + u.bbox.h) - iy;

//             if (iw > 0 && ih > 0) {
//                 // Precise pixel intersection mask
//                 let mask1 = cv.Mat.zeros(ih, iw, cv.CV_8U);
//                 let mask2 = cv.Mat.zeros(ih, iw, cv.CV_8U);
//                 let inter = new cv.Mat();

//                 let flat1 = [], flat2 = [];
//                 for (let p of c.pixels) flat1.push(p.x - ix, p.y - iy);
//                 for (let p of u.pixels) flat2.push(p.x - ix, p.y - iy);

//                 let mat1 = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flat1);
//                 let pts1 = new cv.MatVector(); pts1.push_back(mat1);
//                 cv.fillPoly(mask1, pts1, new cv.Scalar(255));

//                 let mat2 = cv.matFromArray(u.pixels.length, 1, cv.CV_32SC2, flat2);
//                 let pts2 = new cv.MatVector(); pts2.push_back(mat2);
//                 cv.fillPoly(mask2, pts2, new cv.Scalar(255));

//                 cv.bitwise_and(mask1, mask2, inter);
//                 let overlapArea = cv.countNonZero(inter);

//                 mask1.delete(); mask2.delete(); inter.delete();
//                 mat1.delete(); pts1.delete();
//                 mat2.delete(); pts2.delete();

//                 // If overlap > 50% of the SMALLER polygon, they are the same plot detected by different passes
//                 let minArea = Math.min(c.area, u.area);
//                 if (overlapArea > minArea * 0.50) {
//                     isDuplicate = true;
//                     // Double-line/multi-pass dedup: keep the slightly larger outer contour
//                     if (c.area > u.area) {
//                         uniqueCandidates[i] = c;
//                     }
//                     break;
//                 }
//             }
//         }
//         if (!isDuplicate) {
//             uniqueCandidates.push(c);
//         }
//     }

//     // --- Watershed Overlap Clipping ---
//     if (uniqueCandidates.length > 1) {
//         let unionMask = cv.Mat.zeros(H, W, cv.CV_8U);
//         let markers = cv.Mat.zeros(H, W, cv.CV_32S);

//         let validIndices = [];

//         for (let i = 0; i < uniqueCandidates.length; i++) {
//             let c = uniqueCandidates[i];
//             let cMask = cv.Mat.zeros(H, W, cv.CV_8U);

//             let flat = [];
//             for (let p of c.pixels) flat.push(p.x, p.y);
//             let mat = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flat);
//             let pts = new cv.MatVector(); pts.push_back(mat);

//             cv.fillPoly(cMask, pts, new cv.Scalar(255));
//             cv.bitwise_or(unionMask, cMask, unionMask);

//             let dist = new cv.Mat();
//             cv.distanceTransform(cMask, dist, cv.DIST_L2, 3);
//             let minMax = cv.minMaxLoc(dist);

//             if (minMax.maxVal > 0) {
//                 let seed = new cv.Mat();
//                 cv.threshold(dist, seed, Math.max(2, minMax.maxVal * 0.4), 255, cv.THRESH_BINARY);
//                 seed.convertTo(seed, cv.CV_8U);

//                 let temp32 = new cv.Mat();
//                 seed.convertTo(temp32, cv.CV_32S, (i + 1) / 255.0);
//                 cv.add(markers, temp32, markers, seed);
//                 validIndices.push(i);

//                 seed.delete(); temp32.delete();
//             }

//             cMask.delete(); mat.delete(); pts.delete(); dist.delete();
//         }

//         if (validIndices.length > 0) {
//             let bgMask = new cv.Mat();
//             let dilateKernel = cv.Mat.ones(5, 5, cv.CV_8U);
//             cv.dilate(unionMask, bgMask, dilateKernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
//             cv.bitwise_not(bgMask, bgMask);

//             let bgSeed = new cv.Mat();
//             bgMask.convertTo(bgSeed, cv.CV_32S, 9999 / 255.0);
//             cv.add(markers, bgSeed, markers, bgMask);

//             let srcC3 = new cv.Mat();
//             cv.cvtColor(gray, srcC3, cv.COLOR_GRAY2RGB);

//             cv.watershed(srcC3, markers);

//             for (let i of validIndices) {
//                 let cMask = cv.Mat.zeros(H, W, cv.CV_8U);
//                 let targetId = new cv.Mat(H, W, cv.CV_32S, new cv.Scalar(i + 1));
//                 cv.compare(markers, targetId, cMask, cv.CMP_EQ);

//                 let gapDilate = cv.Mat.ones(3, 3, cv.CV_8U);
//                 cv.dilate(cMask, cMask, gapDilate, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

//                 let contours = new cv.MatVector();
//                 let hierarchy = new cv.Mat();
//                 cv.findContours(cMask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

//                 if (contours.size() > 0) {
//                     let maxCArea = 0;
//                     let bestContourIdx = 0;
//                     for (let j = 0; j < contours.size(); j++) {
//                         let a = cv.contourArea(contours.get(j));
//                         if (a > maxCArea) { maxCArea = a; bestContourIdx = j; }
//                     }

//                     let contour = contours.get(bestContourIdx);
//                     let approx = new cv.Mat();
//                     cv.approxPolyDP(contour, approx, 1.0, true);

//                     let newPixels = [];
//                     for (let j = 0; j < approx.rows; j++) {
//                         newPixels.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
//                     }

//                     if (newPixels.length >= 3) {
//                         uniqueCandidates[i].pixels = newPixels;
//                         uniqueCandidates[i].area = maxCArea;
//                         uniqueCandidates[i].bbox = getBBox(newPixels);
//                     }
//                     approx.delete();
//                 }

//                 cMask.delete(); targetId.delete(); gapDilate.delete(); contours.delete(); hierarchy.delete();
//             }
//             bgMask.delete(); dilateKernel.delete(); bgSeed.delete(); srcC3.delete();
//         }

//         unionMask.delete(); markers.delete();
//     }

//     // --- PASS C: Gap Filling Pass ---
//     let successMask = cv.Mat.zeros(H, W, cv.CV_8U);
//     matsToDelete.push(successMask);
//     for (let c of uniqueCandidates) {
//         let flatPts = [];
//         for (let p of c.pixels) { flatPts.push(p.x, p.y); }
//         let mat = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flatPts);
//         let pts = new cv.MatVector();
//         pts.push_back(mat);
//         cv.fillPoly(successMask, pts, new cv.Scalar(255));
//         mat.delete();
//         pts.delete();
//     }
//     let gapDilate = cv.Mat.ones(5, 5, cv.CV_8U);
//     matsToDelete.push(gapDilate);
//     cv.dilate(successMask, successMask, gapDilate, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

//     let remainingFills = new cv.Mat();
//     matsToDelete.push(remainingFills);
//     cv.bitwise_not(successMask, successMask); 
//     cv.bitwise_and(fillBin, successMask, remainingFills);

//     let gapContours = new cv.MatVector();
//     let gapHierarchy = new cv.Mat();
//     matsToDelete.push(gapContours, gapHierarchy);
//     cv.findContours(remainingFills, gapContours, gapHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

//     for (let i = 0; i < gapContours.size(); i++) {
//         let contour = gapContours.get(i);
//         let area = cv.contourArea(contour);
//         // Do not relax the minimum area for gap fills to prevent text loops from sneaking in
//         if (area < dynamicMinArea || area > maxPlotArea * 2) continue;

//         let hull = new cv.Mat();
//         cv.convexHull(contour, hull, false, true);
//         let hullArea = cv.contourArea(hull);
//         let solidity = hullArea > 0 ? area / hullArea : 0;
//         hull.delete();

//         // Strict solidity threshold to reject messy/organic scattered blobs like tree canopies
//         if (solidity > 0.75) {
//             let rect = cv.boundingRect(contour);

//             // 1. Text Masking
//             let isText = false;
//             for (let lbl of ocrLabels) {
//                 let intersectX = Math.max(0, Math.min(rect.x + rect.width, lbl.x0 + lbl.width) - Math.max(rect.x, lbl.x0));
//                 let intersectY = Math.max(0, Math.min(rect.y + rect.height, lbl.y0 + lbl.height) - Math.max(rect.y, lbl.y0));
//                 if (intersectX > 0 && intersectY > 0) {
//                     let intersectArea = intersectX * intersectY;
//                     let rectArea = rect.width * rect.height;
//                     if (intersectArea > rectArea * 0.6 && rectArea < imageArea * 0.01) {
//                         isText = true; break;
//                     }
//                 }
//             }
//             if (isText) continue;

//             let approx = new cv.Mat();
//             let minDim = Math.min(rect.width, rect.height);
//             let epsilon = Math.max(1.0, 0.03 * minDim); 
//             cv.approxPolyDP(contour, approx, epsilon, true);

//             let approxPixels = [];
//             for (let j = 0; j < approx.rows; j++) {
//                 approxPixels.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
//             }

//             // Reduced max vertices from 16 to 10 to reject highly jagged shapes (e.g. tree clusters)
//             if (approxPixels.length >= 3 && approxPixels.length <= 10) {
//                 let origPixels = [];
//                 for (let j = 0; j < contour.rows; j++) {
//                     origPixels.push({ x: contour.data32S[j*2], y: contour.data32S[j*2+1] });
//                 }
//                 let approxIndices = [];
//                 let searchIdx = 0;
//                 for (let p of approxPixels) {
//                     let found = false;
//                     for (let k = 0; k < origPixels.length; k++) {
//                         let idx = (searchIdx + k) % origPixels.length;
//                         if (origPixels[idx].x === p.x && origPixels[idx].y === p.y) {
//                             approxIndices.push(idx);
//                             searchIdx = idx;
//                             found = true;
//                             break;
//                         }
//                     }
//                     if (!found) approxIndices.push(-1);
//                 }

//                 let finalPixels = [];
//                 function pointLineDistGap(P, A, B) {
//                     let num = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y));
//                     let den = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
//                     return den === 0 ? 0 : num / den;
//                 }

//                 for (let k = 0; k < approxPixels.length; k++) {
//                     let p1 = approxPixels[k];
//                     let idx1 = approxIndices[k];
//                     finalPixels.push(p1);
//                     if (idx1 === -1) continue;
//                     let nextK = (k + 1) % approxPixels.length;
//                     let p2 = approxPixels[nextK];
//                     let idx2 = approxIndices[nextK];
//                     if (idx2 === -1) continue;

//                     let segment = [];
//                     if (idx2 > idx1) {
//                         segment = origPixels.slice(idx1 + 1, idx2);
//                     } else if (idx2 < idx1) {
//                         segment = origPixels.slice(idx1 + 1).concat(origPixels.slice(0, idx2));
//                     }
//                     if (segment.length > 8) {
//                         let maxDist = 0;
//                         for (let pt of segment) {
//                             let dist = pointLineDistGap(pt, p1, p2);
//                             if (dist > maxDist) maxDist = dist;
//                         }
//                         // Increased threshold to ignore small pixel-level jerks/wobbles on straight lines
//                         if (maxDist > Math.max(6.0, minDim * 0.01)) {
//                             let step = Math.floor(segment.length / 5);
//                             if (step > 0) {
//                                 finalPixels.push(segment[step]);
//                                 finalPixels.push(segment[step * 2]);
//                                 finalPixels.push(segment[step * 3]);
//                                 finalPixels.push(segment[step * 4]);
//                             }
//                         }
//                     }
//                 }
//                 let cx = rect.x + rect.width / 2;
//                 let cy = rect.y + rect.height / 2;
//                 uniqueCandidates.push({ area, pixels: finalPixels, cx, cy });
//             }
//             approx.delete();
//         }
//     }



//     // --- Assign Plot Numbers from OCR ---
//     function getOverlapScore(lbl, pixels) {
//         let pts = [
//             {x: lbl.x0, y: lbl.y0}, {x: lbl.x, y: lbl.y0}, {x: lbl.x0 + lbl.width, y: lbl.y0},
//             {x: lbl.x0, y: lbl.y}, {x: lbl.x, y: lbl.y}, {x: lbl.x0 + lbl.width, y: lbl.y},
//             {x: lbl.x0, y: lbl.y0 + lbl.height}, {x: lbl.x, y: lbl.y0 + lbl.height}, {x: lbl.x0 + lbl.width, y: lbl.y0 + lbl.height}
//         ];
//         let count = 0;
//         for (let pt of pts) {
//             if (ptInPolygon(pt, pixels)) count++;
//         }
//         return count;
//     }

//     // Exclusively bind each OCR label to the polygon that contains most of its bbox
//     let cat4Count = 0;
//     for (let lbl of ocrLabels) {
//         let bestPolyIndex = -1;
//         let maxOverlap = 0;
//         for (let i = 0; i < uniqueCandidates.length; i++) {
//             let overlap = getOverlapScore(lbl, uniqueCandidates[i].pixels);
//             if (overlap > maxOverlap) {
//                 maxOverlap = overlap;
//                 bestPolyIndex = i;
//             }
//         }
//         lbl.bestPolyIndex = bestPolyIndex;

//         // Category 4: Binding failed
//         if (bestPolyIndex === -1 && /^[^a-zA-Z]*\d+[^a-zA-Z]*$/.test(lbl.text.trim())) {
//             console.log(`[Diagnostic] Category 4: Binding failed for digit text "${lbl.text}". Bbox: x=${lbl.x0}, y=${lbl.y0}`);
//             cat4Count++;
//         }
//     }

//     for (let i = 0; i < uniqueCandidates.length; i++) {
//         let c = uniqueCandidates[i];
//         let insideLabels = ocrLabels.filter(lbl => lbl.bestPolyIndex === i);

//         // Only allow strings that consist entirely of digits (and optional whitespace)
//         // This strictly excludes dimensions like "40'-0"" or labels with letters/symbols.
//         let idCandidates = insideLabels.filter(lbl => /^\s*\d+\s*$/.test(lbl.text));

//         if (idCandidates.length > 0) {
//             for (let lbl of idCandidates) {
//                 let rx = Math.max(0, lbl.x0);
//                 let ry = Math.max(0, lbl.y0);
//                 let rw = Math.min(W - rx, lbl.width);
//                 let rh = Math.min(H - ry, lbl.height);

//                 if (rw <= 0 || rh <= 0) {
//                     lbl.boldness = 0;
//                     continue;
//                 }

//                 let rect = new cv.Rect(rx, ry, rw, rh);
//                 let roi = gray.roi(rect);
//                 let thresh = new cv.Mat();
//                 cv.threshold(roi, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
//                 let blackPixels = cv.countNonZero(thresh);
//                 lbl.boldness = blackPixels / (rw * rh);
//                 lbl.absScore = lbl.height * lbl.boldness * (lbl.conf / 100.0);
//                 thresh.delete();
//                 roi.delete();
//             }

//             let maxHeight = Math.max(...idCandidates.map(l => l.height));
//             let maxBoldness = Math.max(...idCandidates.map(l => l.boldness));
//             if (maxHeight === 0) maxHeight = 1;
//             if (maxBoldness === 0) maxBoldness = 1;

//             idCandidates.forEach(lbl => {
//                 lbl.score = 0.6 * (lbl.height / maxHeight) + 0.4 * (lbl.boldness / maxBoldness);
//             });

//             idCandidates.sort((a, b) => b.score - a.score);

//             let best = idCandidates[0];
//             let ambiguous = idCandidates.length > 1 && (idCandidates[0].score - idCandidates[1].score < 0.10);

//             if (ambiguous) {
//                 console.log(`[Diagnostic] Plot ${i} missing ID (Category 2): Ambiguous tie between candidates`, idCandidates.map(c => c.text));
//                 c.id = null;
//                 c.failCategory = 2;
//             } else {
//                 c.id = best.text.replace(/[^\d]/g, ''); // Extract just the digits
//                 c.idScore = best.absScore;
//             }
//         } else {
//             if (insideLabels.length === 0) {
//                 console.log(`[Diagnostic] Plot ${i} missing ID (Category 1): No OCR text detected inside polygon.`);
//                 c.failCategory = 1;
//             } else {
//                 console.log(`[Diagnostic] Plot ${i} missing ID (Category 2): Found text but no digits passed filter. Texts:`, insideLabels.map(l => l.text));
//                 c.failCategory = 2;
//             }
//             c.id = null;
//         }

//         // Ignored all other text/dimensions per user constraint
//     }

//     // --- Global Uniqueness Pass ---
//     let idMap = {};
//     for (let i = 0; i < uniqueCandidates.length; i++) {
//         let id = uniqueCandidates[i].id;
//         if (id) {
//             if (!idMap[id]) idMap[id] = [];
//             idMap[id].push(i);
//         }
//     }

//     for (let id in idMap) {
//         if (idMap[id].length > 1) {
//             let indices = idMap[id];
//             // Sort conflicting plots by the absolute score of their winning label
//             indices.sort((a, b) => uniqueCandidates[b].idScore - uniqueCandidates[a].idScore);
//             // The plot with the highest absolute quality keeps the ID, others get null
//             for (let j = 1; j < indices.length; j++) {
//                 console.log(`[Diagnostic] Plot ${indices[j]} missing ID (Category 3): Conflict for ID ${id}. Lost to Plot ${indices[0]}. Scores: Winner=${uniqueCandidates[indices[0]].idScore}, Loser=${uniqueCandidates[indices[j]].idScore}`);
//                 uniqueCandidates[indices[j]].id = null;
//                 uniqueCandidates[indices[j]].failCategory = 3;
//             }
//         }
//     }



//     // --- Final Invariant Check: Zero Overlap Guarantee ---
//     // Ensure no two plots overlap by more than a small sliver (e.g. 5% area).
//     let validFinalCandidates = [];
//     for (let i = 0; i < uniqueCandidates.length; i++) {
//         let c = uniqueCandidates[i];
//         if (!c.bbox) c.bbox = getBBox(c.pixels); // Ensure gap-fill candidates have bbox
//         let hasConflict = false;

//         for (let j = 0; j < validFinalCandidates.length; j++) {
//             let u = validFinalCandidates[j];
//             let ix = Math.max(c.bbox.x, u.bbox.x);
//             let iy = Math.max(c.bbox.y, u.bbox.y);
//             let iw = Math.min(c.bbox.x + c.bbox.w, u.bbox.x + u.bbox.w) - ix;
//             let ih = Math.min(c.bbox.y + c.bbox.h, u.bbox.y + u.bbox.h) - iy;

//             if (iw > 0 && ih > 0) {
//                 let mask1 = cv.Mat.zeros(ih, iw, cv.CV_8U);
//                 let mask2 = cv.Mat.zeros(ih, iw, cv.CV_8U);
//                 let inter = new cv.Mat();

//                 let flat1 = [], flat2 = [];
//                 for (let p of c.pixels) flat1.push(p.x - ix, p.y - iy);
//                 for (let p of u.pixels) flat2.push(p.x - ix, p.y - iy);

//                 let mat1 = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flat1);
//                 let pts1 = new cv.MatVector(); pts1.push_back(mat1);
//                 cv.fillPoly(mask1, pts1, new cv.Scalar(255));

//                 let mat2 = cv.matFromArray(u.pixels.length, 1, cv.CV_32SC2, flat2);
//                 let pts2 = new cv.MatVector(); pts2.push_back(mat2);
//                 cv.fillPoly(mask2, pts2, new cv.Scalar(255));

//                 cv.bitwise_and(mask1, mask2, inter);
//                 let overlapArea = cv.countNonZero(inter);

//                 mask1.delete(); mask2.delete(); inter.delete();
//                 mat1.delete(); pts1.delete(); mat2.delete(); pts2.delete();

//                 // If overlap is > 5% of the smaller area, it's a conflict
//                 let minArea = Math.min(c.area, u.area);
//                 if (overlapArea > minArea * 0.05) {
//                     hasConflict = true;
//                     console.log(`[Diagnostic] Plot rejected due to severe boundary conflict/overlap. IoU check failed.`);
//                     break;
//                 }
//             }
//         }

//         if (!hasConflict) {
//             validFinalCandidates.push(c);
//         }
//     }

//     uniqueCandidates = validFinalCandidates;

//     let summary = { success: 0, cat1_NoOCR: 0, cat2_NoQualifyingDigits: 0, cat3_ConflictLost: 0, cat4_UnboundDigits: cat4Count };
//     uniqueCandidates.forEach(c => {
//         if (c.id) summary.success++;
//         else if (c.failCategory === 1) summary.cat1_NoOCR++;
//         else if (c.failCategory === 2) summary.cat2_NoQualifyingDigits++;
//         else if (c.failCategory === 3) summary.cat3_ConflictLost++;
//     });
//     console.log(`=== AutoPlot Diagnostics Summary ===`, summary);

//     // Output strictly requested JSON format
//     let extractedJSON = {
//         "Extracted_Plots": uniqueCandidates
//             .filter(c => c.id !== null)
//             .map(c => ({
//                 plot_number: parseInt(c.id, 10),
//                 status: "Assigned to boundary"
//             }))
//     };
//     console.log(JSON.stringify(extractedJSON, null, 2));

//     // --- Final Projection ---
//     let detectedPaths = [];
//     for (let c of uniqueCandidates) {
//         let latLngs = floorPlanManager.projectPixelsToLatLngs(floorPlanId, c.pixels, W, H);
//         if (latLngs && latLngs.length > 0) {
//             latLngs.push({ lat: latLngs[0].lat, lng: latLngs[0].lng }); // Close ring
//             detectedPaths.push({ path: latLngs, id: c.id, sqyd: c.sqyd, length: c.length, width: c.width });
//         }
//     }

//     return detectedPaths;

//   } finally {
//     for (let mat of matsToDelete) {
//        if (mat) {
//           try { mat.delete(); } catch(e) {}
//        }
//     }
//   }
// }
import Tesseract from 'tesseract.js';

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

    // --- OCR PREPROCESSING ---
    let cvMatsToClean = [];
    let ocrCanvas = document.createElement('canvas');
    try {
        let srcOcr = cv.matFromImageData(imageData);
        cvMatsToClean.push(srcOcr);

        let ocrScaled = new cv.Mat();
        cvMatsToClean.push(ocrScaled);
        cv.resize(srcOcr, ocrScaled, new cv.Size(), 2.0, 2.0, cv.INTER_CUBIC);

        let ocrGray = new cv.Mat();
        cvMatsToClean.push(ocrGray);
        cv.cvtColor(ocrScaled, ocrGray, cv.COLOR_RGBA2GRAY, 0);

        let ocrThresh = new cv.Mat();
        cvMatsToClean.push(ocrThresh);
        // Adaptive Threshold (from user spec: cv2.THRESH_BINARY, 25, 10)
        cv.adaptiveThreshold(ocrGray, ocrThresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 25, 10);

        let ocrRgba = new cv.Mat();
        cvMatsToClean.push(ocrRgba);
        cv.cvtColor(ocrThresh, ocrRgba, cv.COLOR_GRAY2RGBA, 0);

        let ocrImgData = new ImageData(new Uint8ClampedArray(ocrRgba.data), ocrRgba.cols, ocrRgba.rows);
        ocrCanvas.width = ocrRgba.cols;
        ocrCanvas.height = ocrRgba.rows;
        ocrCanvas.getContext('2d').putImageData(ocrImgData, 0, 0);
    } finally {
        for (let m of cvMatsToClean) {
            if (m) { try { m.delete(); } catch (e) { } }
        }
    }

    // --- OCR PASS ---
    const worker = await Tesseract.createWorker('eng');
    await worker.setParameters({
        tessedit_char_whitelist: '0123456789\'"- ./',
        tessedit_pageseg_mode: '11' // SPARSE_TEXT
    });
    const tesseractResult = await worker.recognize(ocrCanvas, {}, { tsv: true });
    await worker.terminate();

    let ocrLabels = [];
    if (tesseractResult.data.tsv) {
        const tsvLines = tesseractResult.data.tsv.split('\n');
        for (let i = 1; i < tsvLines.length; i++) {
            let parts = tsvLines[i].split('\t');
            if (parts.length >= 12) {
                let level = parseInt(parts[0]);
                let conf = parseFloat(parts[10]);
                let text = parts.slice(11).join('\t').trim();

                // Apply confidence gate > 25 (relaxed)
                if (level === 5 && text && conf >= 25) {
                    // Divide coords by 2 because we upscaled 2x
                    let left = parseInt(parts[6]) / 2.0;
                    let top = parseInt(parts[7]) / 2.0;
                    let width = parseInt(parts[8]) / 2.0;
                    let height = parseInt(parts[9]) / 2.0;
                    let cx = left + width / 2;
                    let cy = top + height / 2;
                    ocrLabels.push({ text: text, x: cx, y: cy, height: height, x0: left, y0: top, width: width, conf: conf });
                }
            }
        }
    }

    function ptInPolygon(pt, pixels) {
        let inside = false;
        for (let i = 0, j = pixels.length - 1; i < pixels.length; j = i++) {
            let xi = pixels[i].x, yi = pixels[i].y;
            let xj = pixels[j].x, yj = pixels[j].y;
            let intersect = ((yi > pt.y) !== (yj > pt.y))
                && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

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
                const area = cv.contourArea(contour);
                if (!(area > minArea && area < maxArea)) continue;

                const hull = new cv.Mat();
                cv.convexHull(contour, hull, false, true);
                const hullArea = cv.contourArea(hull);
                const solidity = hullArea > 0 ? area / hullArea : 0;

                const rect = cv.boundingRect(hull);
                const aspectRatio = Math.max(rect.width / rect.height, rect.height / rect.width);
                const rectangularity = area / (rect.width * rect.height);

                if (solidity > 0.5 && aspectRatio < 5 && rectangularity > 0.3) {
                    // Text Masking (kept from original): reject small contours mostly inside OCR text bounding boxes
                    let isText = false;
                    for (let lbl of ocrLabels) {
                        let intersectX = Math.max(0, Math.min(rect.x + rect.width, lbl.x0 + lbl.width) - Math.max(rect.x, lbl.x0));
                        let intersectY = Math.max(0, Math.min(rect.y + rect.height, lbl.y0 + lbl.height) - Math.max(rect.y, lbl.y0));
                        if (intersectX > 0 && intersectY > 0) {
                            let intersectArea = intersectX * intersectY;
                            let rectArea = rect.width * rect.height;
                            if (intersectArea > rectArea * 0.6 && rectArea < imageArea * 0.01) {
                                isText = true; break;
                            }
                        }
                    }
                    if (isText) { hull.delete(); continue; }

                    const approx = new cv.Mat();
                    // Relaxed relative epsilon (0.8% of hull arc length) smooths text-bump jaggedness
                    const epsilon = 0.008 * cv.arcLength(hull, true);
                    cv.approxPolyDP(hull, approx, epsilon, true);

                    // Allow up to 12 vertices to prevent rejecting slightly noisy plots
                    if (approx.rows >= 4 && approx.rows <= 12) {
                        const M_moments = cv.moments(hull);
                        const cx = M_moments.m10 / M_moments.m00;
                        const cy = M_moments.m01 / M_moments.m00;

                        const pixels = [];
                        for (let j = 0; j < approx.rows; j++) {
                            pixels.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
                        }
                        candidateContours.push({ area, cx, cy, pixels, bbox: getBBox(pixels) });
                    }
                    approx.delete();
                }
                hull.delete();
            }
        }

        if (candidateContours.length === 0) return [];

        // Area-range filtering relative to the detected median plot size
        candidateContours.sort((a, b) => a.area - b.area);
        const medianArea = candidateContours[Math.floor(candidateContours.length / 2)].area;
        const dynamicMinArea = medianArea * 0.1;
        const maxPlotArea = medianArea * 15.0;
        let uniqueCandidates = candidateContours.filter(c => c.area >= dynamicMinArea && c.area <= maxPlotArea);

        // Centroid-distance dedup: process smallest-first so innermost/duplicate double-line contours collapse
        const acceptedForDedup = [];
        const dedupedCandidates = [];
        for (const candidate of uniqueCandidates) {
            let isDuplicate = false;
            for (const accepted of acceptedForDedup) {
                const dist = Math.hypot(accepted.cx - candidate.cx, accepted.cy - candidate.cy);
                if (dist < W * 0.02) { isDuplicate = true; break; }
                const candidateRadius = Math.sqrt(candidate.area / Math.PI);
                if (dist < candidateRadius * 0.8) { isDuplicate = true; break; }
            }
            if (!isDuplicate) {
                acceptedForDedup.push(candidate);
                dedupedCandidates.push(candidate);
            }
        }
        uniqueCandidates = dedupedCandidates;

        // --- Assign Plot Numbers from OCR ---
        function getOverlapScore(lbl, pixels) {
            let pts = [
                { x: lbl.x0, y: lbl.y0 }, { x: lbl.x, y: lbl.y0 }, { x: lbl.x0 + lbl.width, y: lbl.y0 },
                { x: lbl.x0, y: lbl.y }, { x: lbl.x, y: lbl.y }, { x: lbl.x0 + lbl.width, y: lbl.y },
                { x: lbl.x0, y: lbl.y0 + lbl.height }, { x: lbl.x, y: lbl.y0 + lbl.height }, { x: lbl.x0 + lbl.width, y: lbl.y0 + lbl.height }
            ];
            let count = 0;
            for (let pt of pts) {
                if (ptInPolygon(pt, pixels)) count++;
            }
            return count;
        }

        // Exclusively bind each OCR label to the polygon that contains most of its bbox
        let cat4Count = 0;
        for (let lbl of ocrLabels) {
            let bestPolyIndex = -1;
            let maxOverlap = 0;
            for (let i = 0; i < uniqueCandidates.length; i++) {
                let overlap = getOverlapScore(lbl, uniqueCandidates[i].pixels);
                if (overlap > maxOverlap) {
                    maxOverlap = overlap;
                    bestPolyIndex = i;
                }
            }
            lbl.bestPolyIndex = bestPolyIndex;

            // Category 4: Binding failed
            if (bestPolyIndex === -1 && /^[^a-zA-Z]*\d+[^a-zA-Z]*$/.test(lbl.text.trim())) {
                console.log(`[Diagnostic] Category 4: Binding failed for digit text "${lbl.text}". Bbox: x=${lbl.x0}, y=${lbl.y0}`);
                cat4Count++;
            }
        }

        for (let i = 0; i < uniqueCandidates.length; i++) {
            let c = uniqueCandidates[i];
            let insideLabels = ocrLabels.filter(lbl => lbl.bestPolyIndex === i);

            // Only allow strings that consist entirely of digits (and optional whitespace)
            // This strictly excludes dimensions like "40'-0"" or labels with letters/symbols.
            let idCandidates = insideLabels.filter(lbl => /^\s*\d+\s*$/.test(lbl.text));

            if (idCandidates.length > 0) {
                for (let lbl of idCandidates) {
                    let rx = Math.max(0, lbl.x0);
                    let ry = Math.max(0, lbl.y0);
                    let rw = Math.min(W - rx, lbl.width);
                    let rh = Math.min(H - ry, lbl.height);

                    if (rw <= 0 || rh <= 0) {
                        lbl.boldness = 0;
                        continue;
                    }

                    let rect = new cv.Rect(rx, ry, rw, rh);
                    let roi = gray.roi(rect);
                    let thresh = new cv.Mat();
                    cv.threshold(roi, thresh, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
                    let blackPixels = cv.countNonZero(thresh);
                    lbl.boldness = blackPixels / (rw * rh);
                    lbl.absScore = lbl.height * lbl.boldness * (lbl.conf / 100.0);
                    thresh.delete();
                    roi.delete();
                }

                let maxHeight = Math.max(...idCandidates.map(l => l.height));
                let maxBoldness = Math.max(...idCandidates.map(l => l.boldness));
                if (maxHeight === 0) maxHeight = 1;
                if (maxBoldness === 0) maxBoldness = 1;

                idCandidates.forEach(lbl => {
                    lbl.score = 0.6 * (lbl.height / maxHeight) + 0.4 * (lbl.boldness / maxBoldness);
                });

                idCandidates.sort((a, b) => b.score - a.score);

                let best = idCandidates[0];
                let ambiguous = idCandidates.length > 1 && (idCandidates[0].score - idCandidates[1].score < 0.10);

                if (ambiguous) {
                    console.log(`[Diagnostic] Plot ${i} missing ID (Category 2): Ambiguous tie between candidates`, idCandidates.map(c => c.text));
                    c.id = null;
                    c.failCategory = 2;
                } else {
                    c.id = best.text.replace(/[^\d]/g, ''); // Extract just the digits
                    c.idScore = best.absScore;
                }
            } else {
                if (insideLabels.length === 0) {
                    console.log(`[Diagnostic] Plot ${i} missing ID (Category 1): No OCR text detected inside polygon.`);
                    c.failCategory = 1;
                } else {
                    console.log(`[Diagnostic] Plot ${i} missing ID (Category 2): Found text but no digits passed filter. Texts:`, insideLabels.map(l => l.text));
                    c.failCategory = 2;
                }
                c.id = null;
            }

            // Ignored all other text/dimensions per user constraint
        }

        // --- Global Uniqueness Pass ---
        let idMap = {};
        for (let i = 0; i < uniqueCandidates.length; i++) {
            let id = uniqueCandidates[i].id;
            if (id) {
                if (!idMap[id]) idMap[id] = [];
                idMap[id].push(i);
            }
        }

        for (let id in idMap) {
            if (idMap[id].length > 1) {
                let indices = idMap[id];
                // Sort conflicting plots by the absolute score of their winning label
                indices.sort((a, b) => uniqueCandidates[b].idScore - uniqueCandidates[a].idScore);
                // The plot with the highest absolute quality keeps the ID, others get null
                for (let j = 1; j < indices.length; j++) {
                    console.log(`[Diagnostic] Plot ${indices[j]} missing ID (Category 3): Conflict for ID ${id}. Lost to Plot ${indices[0]}. Scores: Winner=${uniqueCandidates[indices[0]].idScore}, Loser=${uniqueCandidates[indices[j]].idScore}`);
                    uniqueCandidates[indices[j]].id = null;
                    uniqueCandidates[indices[j]].failCategory = 3;
                }
            }
        }



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
                    let mask1 = cv.Mat.zeros(ih, iw, cv.CV_8U);
                    let mask2 = cv.Mat.zeros(ih, iw, cv.CV_8U);
                    let inter = new cv.Mat();

                    let flat1 = [], flat2 = [];
                    for (let p of c.pixels) flat1.push(p.x - ix, p.y - iy);
                    for (let p of u.pixels) flat2.push(p.x - ix, p.y - iy);

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
                        console.log(`[Diagnostic] Plot rejected due to severe boundary conflict/overlap. IoU check failed.`);
                        break;
                    }
                }
            }

            if (!hasConflict) {
                validFinalCandidates.push(c);
            }
        }

        uniqueCandidates = validFinalCandidates;

        let summary = { success: 0, cat1_NoOCR: 0, cat2_NoQualifyingDigits: 0, cat3_ConflictLost: 0, cat4_UnboundDigits: cat4Count };
        uniqueCandidates.forEach(c => {
            if (c.id) summary.success++;
            else if (c.failCategory === 1) summary.cat1_NoOCR++;
            else if (c.failCategory === 2) summary.cat2_NoQualifyingDigits++;
            else if (c.failCategory === 3) summary.cat3_ConflictLost++;
        });
        console.log(`=== AutoPlot Diagnostics Summary ===`, summary);

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
        let detectedPaths = [];
        for (let c of uniqueCandidates) {
            let latLngs = floorPlanManager.projectPixelsToLatLngs(floorPlanId, c.pixels, W, H);
            if (latLngs && latLngs.length > 0) {
                latLngs.push({ lat: latLngs[0].lat, lng: latLngs[0].lng }); // Close ring
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