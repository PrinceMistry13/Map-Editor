// ── Image boundary tracing ───────────────────────────────────────────────
// Given a floorplan raster, extracts the actual outline of its content
// (not just the rectangular image bounds) as a simplified pixel polygon.
// Used when locking a floorplan so the auto-plotted boundary follows the
// real drawn shape instead of the bounding box.

// 1. Foreground mask — true PNG transparency if present, else background
// color sampled from the image corners (flood-fill-by-distance).
export function extractForegroundMask(imageData, width, height) {
    const data = imageData.data;
    const mask = new Uint8Array(width * height);

    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4 * 97) {
        if (data[i] < 250) { hasAlpha = true; break; }
    }

    if (hasAlpha) {
        for (let p = 0, i = 3; p < width * height; p++, i += 4) {
            mask[p] = data[i] > 20 ? 1 : 0;
        }
        return mask;
    }

    // No usable alpha channel — infer background color from the 4 corners.
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    let br = 0, bg = 0, bb = 0;
    corners.forEach(([x, y]) => {
        const i = (y * width + x) * 4;
        br += data[i]; bg += data[i + 1]; bb += data[i + 2];
    });
    br /= 4; bg /= 4; bb /= 4;

    const tol = 18;
    for (let p = 0, i = 0; p < width * height; p++, i += 4) {
        const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb;
        mask[p] = Math.sqrt(dr * dr + dg * dg + db * db) > tol ? 1 : 0;
    }
    return mask;
}

// 2. Moore-neighbor boundary trace — walks the outer edge of the largest
// foreground blob clockwise, pixel by pixel, starting from the first
// foreground pixel found scanning top-to-bottom, left-to-right.
export function traceContour(mask, width, height) {
    const isFg = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

    let start = null;
    outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (isFg(x, y)) { start = { x, y }; break outer; }
        }
    }
    if (!start) return [];

    // Clockwise 8-neighborhood starting west.
    const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
    const dirIndexOf = (dx, dy) => dirs.findIndex((d) => d[0] === dx && d[1] === dy);

    let curr = start;
    let backtrack = { x: start.x - 1, y: start.y };
    let dirIdx = dirIndexOf(backtrack.x - curr.x, backtrack.y - curr.y);
    if (dirIdx === -1) dirIdx = 0;

    const points = [start];
    const maxIter = width * height * 4;

    for (let iter = 0; iter < maxIter; iter++) {
        let found = false;
        for (let i = 0; i < 8; i++) {
            const d = dirs[(dirIdx + i) % 8];
            const nx = curr.x + d[0], ny = curr.y + d[1];
            if (isFg(nx, ny)) {
                const prevDir = dirs[(dirIdx + i - 1 + 8) % 8];
                backtrack = { x: curr.x + prevDir[0], y: curr.y + prevDir[1] };
                curr = { x: nx, y: ny };
                dirIdx = dirIndexOf(backtrack.x - curr.x, backtrack.y - curr.y);
                if (dirIdx === -1) dirIdx = 0;
                found = true;
                break;
            }
        }
        if (!found) break; // isolated single pixel
        if (curr.x === start.x && curr.y === start.y) break; // back to start
        points.push(curr);
    }
    return points;
}

// 3. Douglas-Peucker simplification — collapses the (potentially huge)
// pixel-by-pixel trace down to the handful of vertices that actually
// define the shape's corners.
function perpendicularDistance(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (mag * mag);
    const cx = a.x + u * dx, cy = a.y + u * dy;
    return Math.hypot(p.x - cx, p.y - cy);
}

export function simplifyPolygon(points, epsilon) {
    if (points.length < 3) return points;
    let dmax = 0, index = 0;
    const end = points.length - 1;
    for (let i = 1; i < end; i++) {
        const d = perpendicularDistance(points[i], points[0], points[end]);
        if (d > dmax) { dmax = d; index = i; }
    }
    if (dmax > epsilon) {
        const left = simplifyPolygon(points.slice(0, index + 1), epsilon);
        const right = simplifyPolygon(points.slice(index), epsilon);
        return left.slice(0, -1).concat(right);
    }
    return [points[0], points[end]];
}