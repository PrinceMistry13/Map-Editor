/**
 * Solves for the 3x3 perspective homography matrix that maps 4 source points to 4 destination points.
 * Returns a 16-element array suitable for CSS `matrix3d()`.
 * @param {Array<{x: number, y: number}>} src - 4 source points [nw, ne, se, sw]
 * @param {Array<{x: number, y: number}>} dst - 4 destination points [nw, ne, se, sw]
 * @returns {number[]} 16 values for CSS matrix3d
 */
export function solveHomography(src, dst) {
  const A = [];
  const B = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x;
    const sy = src[i].y;
    const dx = dst[i].x;
    const dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    B.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    B.push(dy);
  }

  // Gaussian elimination for A * h = B
  for (let i = 0; i < 8; i++) {
    let max = i;
    for (let j = i + 1; j < 8; j++) {
      if (Math.abs(A[j][i]) > Math.abs(A[max][i])) max = j;
    }

    const tempA = A[i];
    A[i] = A[max];
    A[max] = tempA;

    const tempB = B[i];
    B[i] = B[max];
    B[max] = tempB;

    if (Math.abs(A[i][i]) < 1e-10) {
      console.warn("solveHomography: singular matrix");
      return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // fallback to identity
    }

    for (let j = i + 1; j < 8; j++) {
      const f = A[j][i] / A[i][i];
      for (let k = i; k < 8; k++) A[j][k] -= f * A[i][k];
      B[j] -= f * B[i];
    }
  }

  const h = new Array(8);
  for (let i = 7; i >= 0; i--) {
    let sum = 0;
    for (let j = i + 1; j < 8; j++) sum += A[i][j] * h[j];
    h[i] = (B[i] - sum) / A[i][i];
  }

  // Map to CSS matrix3d (column-major 4x4 matrix)
  // [ h[0] h[1]   0 h[2] ]
  // [ h[3] h[4]   0 h[5] ]
  // [   0    0    1   0  ]
  // [ h[6] h[7]   0   1  ]
  return [
    h[0], h[3], 0, h[6],
    h[1], h[4], 0, h[7],
    0,    0,    1, 0,
    h[2], h[5], 0, 1
  ];
}

/**
 * Maps a 2D point using the 16-element CSS matrix3d array from solveHomography.
 */
export function mapPoint(x, y, H) {
  const h0 = H[0];
  const h1 = H[4];
  const h2 = H[12];
  
  const h3 = H[1];
  const h4 = H[5];
  const h5 = H[13];
  
  const h6 = H[3];
  const h7 = H[7];

  const w = h6 * x + h7 * y + 1;
  return {
    x: (h0 * x + h1 * y + h2) / w,
    y: (h3 * x + h4 * y + h5) / w
  };
}
