export async function detectUnitsFromImage(floorPlanManager, floorPlanId) {
  const entry = floorPlanManager.overlays.get(floorPlanId);
  if (!entry) throw new Error('Floor plan not found');
  
  const { url, originalWidth: W, originalHeight: H } = entry;
  
  // Ensure OpenCV is loaded
  if (typeof cv === 'undefined') {
    throw new Error('OpenCV is not loaded yet. Please wait a moment and try again.');
  }

  // Fetch image and draw to canvas
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

  // Convert to cv.Mat
  const src = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  
  try {
    // 1. Grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);
    
    // Blur to reduce noise
    cv.GaussianBlur(gray, gray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    
    // 2. Canny Edge Detection
    cv.Canny(gray, edges, 50, 150, 3, false);
    
    // Morphological closing to connect broken lines (prevents missing plots)
    const M = cv.Mat.ones(3, 3, cv.CV_8U);
    cv.dilate(edges, edges, M, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    cv.erode(edges, edges, M, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
    M.delete();
    
    // 3. Find Contours
    // Use RETR_LIST to find all contours (plots) inside the floor plan
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    
    const detectedPaths = [];
    const minArea = (W * H) * 0.0005; // reject tiny noise (< 0.05% of image)
    const maxArea = (W * H) * 0.8;    // reject huge outer boundary (> 80% of image)

    const acceptedCentroids = [];

    for (let i = 0; i < contours.size(); ++i) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      
      if (area > minArea && area < maxArea) {
        // Calculate convex hull FIRST. 
        // This acts like a rubber band around the plot, instantly bridging over 
        // any deep jagged "canyons" caused by text numbers touching the walls!
        const hull = new cv.Mat();
        cv.convexHull(contour, hull, false, true);
        
        const hullArea = cv.contourArea(hull);
        const solidity = hullArea > 0 ? area / hullArea : 0;

        // Require solidity > 0.5 to reject stringy/garbage contours
        if (solidity > 0.5) {
          const approx = new cv.Mat();
          // Apply polygon approximation on the HULL. 
          // 2% of the hull's perimeter will smooth out small outward text bumps
          // while preserving the true corners of trapezoids/5-sided plots.
          const epsilon = 0.02 * cv.arcLength(hull, true);
          cv.approxPolyDP(hull, approx, epsilon, true);
          
          // Allow 3 to 10 vertices
          if (approx.rows >= 3 && approx.rows <= 10) {
            // Compute centroid to deduplicate
            const M_moments = cv.moments(hull);
            const cx = M_moments.m10 / M_moments.m00;
            const cy = M_moments.m01 / M_moments.m00;
            
            let isDuplicate = false;
            for (const c of acceptedCentroids) {
              const dist = Math.hypot(c.cx - cx, c.cy - cy);
              if (dist < W * 0.02) {
                isDuplicate = true;
                break;
              }
            }
            
            if (!isDuplicate) {
              acceptedCentroids.push({ cx, cy });
              const pixels = [];
              
              // Extract the exact vertices of the approximated hull
              for (let j = 0; j < approx.rows; j++) {
                pixels.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] });
              }
              
              const latLngs = floorPlanManager.projectPixelsToLatLngs(floorPlanId, pixels, W, H);
              if (latLngs) {
                detectedPaths.push(latLngs);
              }
            }
          }
          approx.delete();
        }
        hull.delete();
      }
    }
    
    return detectedPaths;
  } finally {
    // Clean up WASM memory
    src.delete();
    gray.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
  }
}
