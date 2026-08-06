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
          if (m) { try { m.delete(); } catch(e) {} }
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
    let allCandidates = [];

    // Helper function to process contours and extract valid polygons
    function processContours(contours) {
        for (let i = 0; i < contours.size(); i++) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);
            let hull = new cv.Mat();
            cv.convexHull(contour, hull, false, true);
            let hullArea = cv.contourArea(hull);
            
            // Relaxed shape constraint: rely purely on solidity (rotation invariant)
            let solidity = hullArea > 0 ? area / hullArea : 0;
            
            if (solidity > 0.6) {
                let rect = cv.boundingRect(contour);
                let approx = new cv.Mat();
                let minDim = Math.min(rect.width, rect.height);
                let epsilon = Math.max(1.5, 0.05 * minDim);
                cv.approxPolyDP(contour, approx, epsilon, true);
                
                let approxPixels = [];
                for (let j = 0; j < approx.rows; j++) {
                    approxPixels.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
                }
                
                // Keep base structural shapes with 4 to 12 vertices
                if (approxPixels.length >= 4 && approxPixels.length <= 12) {
                    let origPixels = [];
                    for (let j = 0; j < contour.rows; j++) {
                        origPixels.push({ x: contour.data32S[j*2], y: contour.data32S[j*2+1] });
                    }
                    
                    let approxIndices = [];
                    let searchIdx = 0;
                    for (let p of approxPixels) {
                        let found = false;
                        for (let i = 0; i < origPixels.length; i++) {
                            let idx = (searchIdx + i) % origPixels.length;
                            if (origPixels[idx].x === p.x && origPixels[idx].y === p.y) {
                                approxIndices.push(idx);
                                searchIdx = idx;
                                found = true;
                                break;
                            }
                        }
                        if (!found) approxIndices.push(-1);
                    }
                    
                    let finalPixels = [];
                    function pointLineDist(P, A, B) {
                        let num = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y));
                        let den = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
                        return den === 0 ? 0 : num / den;
                    }
                    
                    for (let i = 0; i < approxPixels.length; i++) {
                        let p1 = approxPixels[i];
                        let idx1 = approxIndices[i];
                        finalPixels.push(p1);
                        
                        if (idx1 === -1) continue;
                        
                        let nextI = (i + 1) % approxPixels.length;
                        let p2 = approxPixels[nextI];
                        let idx2 = approxIndices[nextI];
                        
                        if (idx2 === -1) continue;
                        
                        let segment = [];
                        if (idx2 > idx1) {
                            segment = origPixels.slice(idx1 + 1, idx2);
                        } else if (idx2 < idx1) {
                            segment = origPixels.slice(idx1 + 1).concat(origPixels.slice(0, idx2));
                        }
                        
                        if (segment.length > 8) {
                            let maxDist = 0;
                            for (let pt of segment) {
                                let dist = pointLineDist(pt, p1, p2);
                                if (dist > maxDist) maxDist = dist;
                            }
                            // Reinsert points to faithfully trace the curve if it deviates from the straight edge
                            if (maxDist > 2.0) {
                                let step = Math.floor(segment.length / 5);
                                if (step > 0) {
                                    finalPixels.push(segment[step]);
                                    finalPixels.push(segment[step * 2]);
                                    finalPixels.push(segment[step * 3]);
                                    finalPixels.push(segment[step * 4]);
                                }
                            }
                        }
                    }
                    
                    let cx = rect.x + rect.width / 2;
                    let cy = rect.y + rect.height / 2;
                    allCandidates.push({ area, pixels: finalPixels, cx, cy });
                }
                approx.delete();
            }
            hull.delete();
        }
    }

    // --- PASS A: Edge-Based Detection (Canny) ---
    let meanStd = new cv.Mat(), meanMat = new cv.Mat();
    cv.meanStdDev(gray, meanMat, meanStd);
    let mean = meanMat.data64F[0];
    meanMat.delete(); meanStd.delete();
    
    let parameterSets = [
      { canny: [10, 50], dilate: 0 }, 
      { canny: [Math.max(0, 0.5 * mean), Math.min(255, 1.0 * mean)], dilate: 0 },
      { canny: [Math.max(0, 0.66 * mean), Math.min(255, 1.33 * mean)], dilate: 0 },
      { canny: [10, 50], dilate: 1, kernelSize: 2 }, 
      { canny: [Math.max(0, 0.66 * mean), Math.min(255, 1.33 * mean)], dilate: 1, kernelSize: 2 },
      { canny: [Math.max(0, 0.5 * mean), Math.min(255, 1.5 * mean)], dilate: 2, kernelSize: 3 }
    ];

    for (let params of parameterSets) {
        let edges = new cv.Mat();
        matsToDelete.push(edges);
        cv.Canny(gray, edges, params.canny[0], params.canny[1], 3, false);
        
        if (params.dilate > 0) {
            let ks = params.kernelSize || (params.dilate * 2 + 1);
            let kernel = cv.Mat.ones(ks, ks, cv.CV_8U);
            cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
            cv.erode(edges, edges, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
            kernel.delete();
        }

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        matsToDelete.push(contours, hierarchy);
        
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        processContours(contours);
    }

    // --- PASS B: Fill-Based Detection (Color Region Segmentation) ---
    // Plots have bright fills, while lines and text are dark.
    let fillBin = new cv.Mat();
    matsToDelete.push(fillBin);
    // Use OTSU to dynamically separate bright colored fills from dark lines
    cv.threshold(gray, fillBin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

    // Erode the white fills slightly to thicken the black dividing lines, ensuring adjacent plots disconnect
    let fillErodeKernel = cv.Mat.ones(3, 3, cv.CV_8U);
    matsToDelete.push(fillErodeKernel);
    cv.erode(fillBin, fillBin, fillErodeKernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    let fillContours = new cv.MatVector();
    let fillHierarchy = new cv.Mat();
    matsToDelete.push(fillContours, fillHierarchy);
    
    // RETR_EXTERNAL traces the outside of the white fills, natively ignoring the dark text/numbers inside
    cv.findContours(fillBin, fillContours, fillHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    processContours(fillContours);

    if (allCandidates.length === 0) return [];

    // --- Pre-filter Absolute Outliers ---
    let minPlotArea = imageArea * 0.0002; 
    let maxPlotArea = imageArea * 0.20;
    
    let validCandidates = allCandidates.filter(c => c.area >= minPlotArea && c.area <= maxPlotArea);
    if (validCandidates.length === 0) return [];

    // --- Area Clustering (Local Filtering) ---
    // Sort by area to group similar sized plots together
    validCandidates.sort((a, b) => a.area - b.area);
    let clusters = [];
    let currentCluster = [validCandidates[0]];
    
    for (let i = 1; i < validCandidates.length; i++) {
        // Break into a new cluster if the area jumps by more than 2x
        if (validCandidates[i].area > currentCluster[currentCluster.length - 1].area * 2.0) {
            clusters.push(currentCluster);
            currentCluster = [validCandidates[i]];
        } else {
            currentCluster.push(validCandidates[i]);
        }
    }
    clusters.push(currentCluster);

    let filteredCandidates = [];
    let globalMedianArea = validCandidates[Math.floor(validCandidates.length / 2)].area;

    for (let cluster of clusters) {
        let clusterMedian = cluster[Math.floor(cluster.length / 2)].area;
        for (let c of cluster) {
            // Filter relative to the LOCAL cluster median (allowing tiny and large plots to coexist)
            if (c.area >= clusterMedian * 0.4 && c.area <= clusterMedian * 3.0) {
                filteredCandidates.push(c);
            }
        }
    }

    // --- Deduplication ---
    // Shrink the centroid-distance threshold relative to the global median size
    let dedupDistSq = Math.pow(Math.max(5, Math.sqrt(globalMedianArea) * 0.1), 2);
    let uniqueCandidates = [];

    for (let c of filteredCandidates) {
        let isDuplicate = false;
        for (let i = 0; i < uniqueCandidates.length; i++) {
            let u = uniqueCandidates[i];
            let distSq = (c.cx - u.cx) ** 2 + (c.cy - u.cy) ** 2;
            if (distSq < dedupDistSq) {
                isDuplicate = true;
                // Double-line/multi-pass dedup: keep the slightly larger outer contour
                if (c.area > u.area) {
                    uniqueCandidates[i] = c;
                }
                break;
            }
        }
        if (!isDuplicate) {
            uniqueCandidates.push(c);
        }
    }

    // --- PASS C: Gap Filling Pass ---
    let successMask = cv.Mat.zeros(H, W, cv.CV_8U);
    matsToDelete.push(successMask);
    for (let c of uniqueCandidates) {
        let flatPts = [];
        for (let p of c.pixels) { flatPts.push(p.x, p.y); }
        let mat = cv.matFromArray(c.pixels.length, 1, cv.CV_32SC2, flatPts);
        let pts = new cv.MatVector();
        pts.push_back(mat);
        cv.fillPoly(successMask, pts, new cv.Scalar(255));
        mat.delete();
        pts.delete();
    }
    let gapDilate = cv.Mat.ones(5, 5, cv.CV_8U);
    matsToDelete.push(gapDilate);
    cv.dilate(successMask, successMask, gapDilate, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());

    let remainingFills = new cv.Mat();
    matsToDelete.push(remainingFills);
    cv.bitwise_not(successMask, successMask); 
    cv.bitwise_and(fillBin, successMask, remainingFills);

    let gapContours = new cv.MatVector();
    let gapHierarchy = new cv.Mat();
    matsToDelete.push(gapContours, gapHierarchy);
    cv.findContours(remainingFills, gapContours, gapHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    
    for (let i = 0; i < gapContours.size(); i++) {
        let contour = gapContours.get(i);
        let area = cv.contourArea(contour);
        if (area < minPlotArea * 0.5 || area > maxPlotArea * 2) continue;
        
        let hull = new cv.Mat();
        cv.convexHull(contour, hull, false, true);
        let hullArea = cv.contourArea(hull);
        let solidity = hullArea > 0 ? area / hullArea : 0;
        hull.delete();
        
        if (solidity > 0.4) {
            let rect = cv.boundingRect(contour);
            let approx = new cv.Mat();
            let minDim = Math.min(rect.width, rect.height);
            let epsilon = Math.max(1.0, 0.03 * minDim); 
            cv.approxPolyDP(contour, approx, epsilon, true);
            
            let approxPixels = [];
            for (let j = 0; j < approx.rows; j++) {
                approxPixels.push({ x: approx.data32S[j*2], y: approx.data32S[j*2+1] });
            }
            
            if (approxPixels.length >= 3 && approxPixels.length <= 16) {
                let origPixels = [];
                for (let j = 0; j < contour.rows; j++) {
                    origPixels.push({ x: contour.data32S[j*2], y: contour.data32S[j*2+1] });
                }
                let approxIndices = [];
                let searchIdx = 0;
                for (let p of approxPixels) {
                    let found = false;
                    for (let k = 0; k < origPixels.length; k++) {
                        let idx = (searchIdx + k) % origPixels.length;
                        if (origPixels[idx].x === p.x && origPixels[idx].y === p.y) {
                            approxIndices.push(idx);
                            searchIdx = idx;
                            found = true;
                            break;
                        }
                    }
                    if (!found) approxIndices.push(-1);
                }
                
                let finalPixels = [];
                function pointLineDistGap(P, A, B) {
                    let num = Math.abs((B.x - A.x) * (A.y - P.y) - (A.x - P.x) * (B.y - A.y));
                    let den = Math.sqrt(Math.pow(B.x - A.x, 2) + Math.pow(B.y - A.y, 2));
                    return den === 0 ? 0 : num / den;
                }
                
                for (let k = 0; k < approxPixels.length; k++) {
                    let p1 = approxPixels[k];
                    let idx1 = approxIndices[k];
                    finalPixels.push(p1);
                    if (idx1 === -1) continue;
                    let nextK = (k + 1) % approxPixels.length;
                    let p2 = approxPixels[nextK];
                    let idx2 = approxIndices[nextK];
                    if (idx2 === -1) continue;
                    
                    let segment = [];
                    if (idx2 > idx1) {
                        segment = origPixels.slice(idx1 + 1, idx2);
                    } else if (idx2 < idx1) {
                        segment = origPixels.slice(idx1 + 1).concat(origPixels.slice(0, idx2));
                    }
                    if (segment.length > 8) {
                        let maxDist = 0;
                        for (let pt of segment) {
                            let dist = pointLineDistGap(pt, p1, p2);
                            if (dist > maxDist) maxDist = dist;
                        }
                        if (maxDist > 2.0) {
                            let step = Math.floor(segment.length / 5);
                            if (step > 0) {
                                finalPixels.push(segment[step]);
                                finalPixels.push(segment[step * 2]);
                                finalPixels.push(segment[step * 3]);
                                finalPixels.push(segment[step * 4]);
                            }
                        }
                    }
                }
                let cx = rect.x + rect.width / 2;
                let cy = rect.y + rect.height / 2;
                uniqueCandidates.push({ area, pixels: finalPixels, cx, cy });
            }
            approx.delete();
        }
    }

    // --- Assign Plot Numbers from OCR ---
    function getOverlapScore(lbl, pixels) {
        let pts = [
            {x: lbl.x0, y: lbl.y0}, {x: lbl.x, y: lbl.y0}, {x: lbl.x0 + lbl.width, y: lbl.y0},
            {x: lbl.x0, y: lbl.y}, {x: lbl.x, y: lbl.y}, {x: lbl.x0 + lbl.width, y: lbl.y},
            {x: lbl.x0, y: lbl.y0 + lbl.height}, {x: lbl.x, y: lbl.y0 + lbl.height}, {x: lbl.x0 + lbl.width, y: lbl.y0 + lbl.height}
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
          try { mat.delete(); } catch(e) {}
       }
    }
  }
}
