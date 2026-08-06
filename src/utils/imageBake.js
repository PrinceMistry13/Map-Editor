import { solveHomography } from './homography';

/**
 * Bakes the floorplan image based on its transformation state.
 * @param {HTMLImageElement} img - The source image
 * @param {Object} fp - The floorplan object from getExportProject()
 * @returns {Promise<Blob>} - The baked image as a blob
 */
export async function bakeFloorplanImage(img, fp) {
  return new Promise((resolve) => {
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const isDistorted = !!fp.distortedCorners;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!isDistorted) {
      // Rigid mode (rotated)
      // Find bounding box of the rotated rectangle to size the canvas
      const cx = W / 2;
      const cy = H / 2;
      const rad = ((fp.rotation || 0) * Math.PI) / 180;
      
      const corners = [
        { x: -cx, y: -cy },
        { x: cx, y: -cy },
        { x: cx, y: cy },
        { x: -cx, y: cy }
      ].map(p => ({
        x: p.x * Math.cos(rad) - p.y * Math.sin(rad),
        y: p.x * Math.sin(rad) + p.y * Math.cos(rad)
      }));

      const minX = Math.min(...corners.map(c => c.x));
      const maxX = Math.max(...corners.map(c => c.x));
      const minY = Math.min(...corners.map(c => c.y));
      const maxY = Math.max(...corners.map(c => c.y));

      canvas.width = Math.ceil(maxX - minX);
      canvas.height = Math.ceil(maxY - minY);

      ctx.save();
      if (fp.opacity !== undefined) {
        ctx.globalAlpha = fp.opacity;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -cx, -cy, W, H);
      ctx.restore();

      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch (e) {
        console.error("Canvas toBlob failed (likely tainted):", e);
        resolve(null);
      }
    } else {
      // Distort mode: per-triangle canvas warp
      const { nw, ne, se, sw } = fp.distortedCorners;
      
      // We need a projection from LatLng to local pixels.
      const lat0 = nw.lat;
      const lng0 = nw.lng;
      const metersPerLat = 111320;
      const metersPerLng = 40075000 * Math.cos(lat0 * Math.PI / 180) / 360;
      
      const toLocal = (pt) => ({
        x: (pt.lng - lng0) * metersPerLng,
        y: -(pt.lat - lat0) * metersPerLat 
      });

      const pts = [toLocal(nw), toLocal(ne), toLocal(se), toLocal(sw)];
      
      const minX = Math.min(...pts.map(p => p.x));
      const maxX = Math.max(...pts.map(p => p.x));
      const minY = Math.min(...pts.map(p => p.y));
      const maxY = Math.max(...pts.map(p => p.y));

      // Scale to roughly match the original image resolution
      const localWidth = maxX - minX;
      const localHeight = maxY - minY;
      const scale = Math.max(W / localWidth, H / localHeight);

      const targetQuad = [
        { x: (pts[0].x - minX) * scale, y: (pts[0].y - minY) * scale }, // nw
        { x: (pts[1].x - minX) * scale, y: (pts[1].y - minY) * scale }, // ne
        { x: (pts[2].x - minX) * scale, y: (pts[2].y - minY) * scale }, // se
        { x: (pts[3].x - minX) * scale, y: (pts[3].y - minY) * scale }  // sw
      ];

      const outW = Math.ceil((maxX - minX) * scale);
      const outH = Math.ceil((maxY - minY) * scale);

      canvas.width = outW;
      canvas.height = outH;

      if (fp.opacity !== undefined) {
        ctx.globalAlpha = fp.opacity;
      }

      const srcQuad = [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: H },
        { x: 0, y: H }
      ];

      const H_mat = solveHomography(srcQuad, targetQuad);

      // Homography mapping function
      // solveHomography returns a 16-element column-major CSS matrix3d array
      const project = (x, y) => {
        const u = H_mat[0] * x + H_mat[4] * y + H_mat[12];
        const v = H_mat[1] * x + H_mat[5] * y + H_mat[13];
        const w = H_mat[3] * x + H_mat[7] * y + H_mat[15];
        return { x: u / w, y: v / w };
      };

      const GRID_SIZE = 20; 
      const dx = W / GRID_SIZE;
      const dy = H / GRID_SIZE;

      for (let i = 0; i < GRID_SIZE; i++) {
        for (let j = 0; j < GRID_SIZE; j++) {
          const sx = i * dx;
          const sy = j * dy;

          const p00 = project(sx, sy);
          const p10 = project(sx + dx, sy);
          const p01 = project(sx, sy + dy);
          const p11 = project(sx + dx, sy + dy);

          drawTriangle(ctx, img, p00.x, p00.y, p10.x, p10.y, p01.x, p01.y, sx, sy, sx + dx, sy, sx, sy + dy);
          drawTriangle(ctx, img, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y, sx + dx, sy, sx + dx, sy + dy, sx, sy + dy);
        }
      }

      try {
        canvas.toBlob((blob) => resolve(blob), 'image/png');
      } catch (e) {
        console.error("Canvas toBlob failed (likely tainted):", e);
        resolve(null);
      }
    }
  });
}

function drawTriangle(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
  ctx.save();
  
  // Expand the clipping path slightly outwards to fix anti-aliasing seams
  const cx = (x0 + x1 + x2) / 3;
  const cy = (y0 + y1 + y2) / 3;
  const expand = 0.5; // 0.5 pixel expansion overlaps adjacent triangles
  const padNode = (px, py) => {
    const len = Math.hypot(px - cx, py - cy);
    if (len === 0) return { x: px, y: py };
    return { 
      x: px + ((px - cx) / len) * expand, 
      y: py + ((py - cy) / len) * expand 
    };
  };
  
  const p0 = padNode(x0, y0);
  const p1 = padNode(x1, y1);
  const p2 = padNode(x2, y2);

  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.clip();

  const d_uv = (u0 - u2) * (v1 - v2) - (u1 - u2) * (v0 - v2);
  if (Math.abs(d_uv) < 1e-6) {
    ctx.restore();
    return;
  }
  
  const m11 = ((x0 - x2) * (v1 - v2) - (x1 - x2) * (v0 - v2)) / d_uv;
  const m21 = ((x1 - x2) * (u0 - u2) - (x0 - x2) * (u1 - u2)) / d_uv;
  const dx = x0 - m11 * u0 - m21 * v0;

  const m12 = ((y0 - y2) * (v1 - v2) - (y1 - y2) * (v0 - v2)) / d_uv;
  const m22 = ((y1 - y2) * (u0 - u2) - (y0 - y2) * (u1 - u2)) / d_uv;
  const dy = y0 - m12 * u0 - m22 * v0;

  ctx.transform(m11, m12, m21, m22, dx, dy);
  
  const pad = 0.5;
  const minU = Math.min(u0, u1, u2);
  const minV = Math.min(v0, v1, v2);
  const maxU = Math.max(u0, u1, u2);
  const maxV = Math.max(v0, v1, v2);

  ctx.drawImage(
    img, 
    minU - pad, minV - pad, 
    maxU - minU + pad*2, maxV - minV + pad*2,
    minU - pad, minV - pad, 
    maxU - minU + pad*2, maxV - minV + pad*2
  );

  ctx.restore();
}
