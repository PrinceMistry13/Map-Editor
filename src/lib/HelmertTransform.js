// Helmert (2D similarity) transform solver
// Fits uniform scale, rotation, and translation between two point sets.

const R = 6378137; // Earth radius in meters

// Spherical Mercator projections
export function latLngToMercator(lat, lng) {
  const x = (lng * Math.PI * R) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x, y };
}

export function mercatorToLatLng(x, y) {
  const lng = (x * 180) / (Math.PI * R);
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2);
  return { lat, lng };
}

/**
 * Computes a 2D similarity transform from source (pixels) to dest (lat, lng).
 * @param {Array<{x, y}>} sourcePoints - Image pixel coordinates
 * @param {Array<{lat, lng}>} destPoints - Map coordinates
 * @returns {Object} { scale, rotationDeg, centerLatLng, rmse, perPointErrors }
 */
export function computeGCPTransform(sourcePoints, destPoints, imageWidth, imageHeight) {
  if (sourcePoints.length < 2 || sourcePoints.length !== destPoints.length) {
    throw new Error('At least 2 point pairs are required.');
  }

  const N = sourcePoints.length;

  // Convert dest points (lat, lng) to Mercator meters for uniform scaling
  // CRITICAL: We invert Y to create a left-handed coordinate system (Y down),
  // which matches the image's pixel coordinate system (Y down).
  const destMeters = destPoints.map(pt => {
    const m = latLngToMercator(pt.lat, pt.lng);
    return { x: m.x, y: -m.y };
  });

  // Compute centroids
  let sumSrcX = 0, sumSrcY = 0, sumDstX = 0, sumDstY = 0;
  for (let i = 0; i < N; i++) {
    sumSrcX += sourcePoints[i].x;
    sumSrcY += sourcePoints[i].y;
    sumDstX += destMeters[i].x;
    sumDstY += destMeters[i].y;
  }
  
  const meanSrcX = sumSrcX / N;
  const meanSrcY = sumSrcY / N;
  const meanDstX = sumDstX / N;
  const meanDstY = sumDstY / N;

  // Centered coordinates
  let numA = 0, numB = 0, den = 0;
  
  for (let i = 0; i < N; i++) {
    const srcX = sourcePoints[i].x - meanSrcX;
    const srcY = sourcePoints[i].y - meanSrcY;
    const dstX = destMeters[i].x - meanDstX;
    const dstY = destMeters[i].y - meanDstY;

    // We fit:
    // dstX = a * srcX - b * srcY
    // dstY = b * srcX + a * srcY
    numA += (dstX * srcX + dstY * srcY);
    numB += (dstY * srcX - dstX * srcY);
    den += (srcX * srcX + srcY * srcY);
  }

  if (den === 0) throw new Error('Source points are collinear or identical.');

  const a = numA / den;
  const b = numB / den;

  const scale = Math.sqrt(a * a + b * b);
  const rotationRad = Math.atan2(b, a);
  const rotationDeg = (rotationRad * 180) / Math.PI;

  const tx = meanDstX - (a * meanSrcX - b * meanSrcY);
  const ty = meanDstY - (b * meanSrcX + a * meanSrcY);

  // Helper to apply transform to a pixel coordinate -> returns Left-Handed Mercator {x, y}
  const applyTransform = (px, py) => {
    const mx = a * px - b * py + tx;
    const my = b * px + a * py + ty;
    return { x: mx, y: my };
  };

  // Compute errors (in meters)
  let sumSqErr = 0;
  const perPointErrors = [];
  
  for (let i = 0; i < N; i++) {
    const predictedMetersLH = applyTransform(sourcePoints[i].x, sourcePoints[i].y);
    const actualMetersLH = destMeters[i];
    const dx = predictedMetersLH.x - actualMetersLH.x;
    const dy = predictedMetersLH.y - actualMetersLH.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    perPointErrors.push(dist);
    sumSqErr += dist * dist;
  }
  
  const rmse = Math.sqrt(sumSqErr / N);

  // Compute the center of the image in lat/lng
  const imageCenterX = imageWidth / 2;
  const imageCenterY = imageHeight / 2;
  const centerMetersLH = applyTransform(imageCenterX, imageCenterY);
  // Revert the Y-inversion to get back to standard right-handed Mercator for LatLng conversion
  const centerLatLng = mercatorToLatLng(centerMetersLH.x, -centerMetersLH.y);

  // We also want to compute the bounds based on the natural bounding box (unrotated image but scaled)
  // Or rather, the state of the overlay. The OverlayView requires width and height in meters.
  // The image's native width/height in pixels * scale = dimensions in meters.
  const widthMeters = imageWidth * scale;
  const heightMeters = imageHeight * scale;

  return {
    scale, // Meters per pixel
    rotationDeg,
    centerLatLng,
    widthMeters,
    heightMeters,
    rmse,
    perPointErrors
  };
}
