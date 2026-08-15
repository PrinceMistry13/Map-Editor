import { createFloorPlanOverlayClass } from './FloorPlanOverlay';
import { extractForegroundMask, traceContour, simplifyPolygon } from '../utils/imageBoundary';
import { solveHomography, mapPoint } from '../utils/homography';

export default class FloorPlanManager {
  constructor(map, callbacks = {}) {
    this.map = map;
    this.callbacks = callbacks;
    this.overlays = new Map();
    this.selectedId = null;
    this.FloorPlanOverlay = createFloorPlanOverlayClass();
    this.currentMode = 'manual';
  }

  setMode(mode) {
    this.currentMode = mode;
    this.overlays.forEach(entry => {
      entry.overlay.update({ mode });
    });
  }

  // Preloads the image to get natural dimensions
  async addFloorPlan(id, url, center, scale = 1, rotationDeg = 0, opacity = 1, timestamp = null, layerId = 'layer-1', distortedCorners = null, name = 'Floor Plan') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        let effectiveScale = scale;
        // If scale is exactly 1 (default for new uploads) and the image is very large, cap width to 60m
        if (scale === 1 && img.naturalWidth > 60) {
          effectiveScale = 60 / img.naturalWidth;
        }
        const widthMeters = img.naturalWidth * effectiveScale;
        const heightMeters = img.naturalHeight * effectiveScale;
        // Update the scale in the entry so it saves correctly
        scale = effectiveScale;

        const overlay = new this.FloorPlanOverlay({
          id, url, center, widthMeters, heightMeters, rotationDeg, opacity,
          distortedCorners, mode: this.currentMode,
          map: this.map,
          manager: this
        });

        this.overlays.set(id, {
          id, name, url, scale, originalWidth: img.naturalWidth, originalHeight: img.naturalHeight, overlay, timestamp, layerId, imgEl: img, itemVisible: true
        });

        this.callbacks.onChange && this.callbacks.onChange();
        resolve(id);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  loadFloorPlan(id, data) {
    const center = {
      lat: (data.bounds.sw.lat + data.bounds.ne.lat) / 2,
      lng: (data.bounds.sw.lng + data.bounds.ne.lng) / 2
    };
    this.addFloorPlan(id, data.floorplan, center, data.scale, data.rotation, data.opacity, data.timestamp, data.layerId || 'layer-1', data.distortedCorners || null, data.name || 'Floor Plan').then(() => {
      if (data.visible === false) {
        const entry = this.overlays.get(id);
        if (entry) entry.itemVisible = false;
      }
    });
  }

  // Generate the axis-aligned bounding box from the rotated corners
  // (Helper for saving format)
  computeBounds(overlay) {
    const { center, widthMeters, heightMeters, rotationDeg } = overlay;

    // Project center to mercator
    const R = 6378137;
    const cx = (center.lng * Math.PI * R) / 180;
    const cy = R * Math.log(Math.tan(Math.PI / 4 + (center.lat * Math.PI) / 360));

    // 4 corners relative to center in meters
    const hw = widthMeters / 2;
    const hh = heightMeters / 2;
    const corners = [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh }
    ];

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    corners.forEach(c => {
      const rx = cx + c.x * cos + c.y * sin;   // (or dx/dy in pointToLatLng)
      const ry = cy - c.x * sin + c.y * cos;

      const lng = (rx * 180) / (Math.PI * R);
      const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(ry / R)) - Math.PI / 2);

      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    });

    return {
      sw: { lat: minLat, lng: minLng },
      ne: { lat: maxLat, lng: maxLng }
    };
  }

  computeCorners(overlay) {
    const { center, widthMeters, heightMeters, rotationDeg } = overlay;

    // Project center to mercator
    const R = 6378137;
    const cx = (center.lng * Math.PI * R) / 180;
    const cy = R * Math.log(Math.tan(Math.PI / 4 + (center.lat * Math.PI) / 360));

    const hw = widthMeters / 2;
    const hh = heightMeters / 2;

    const cornerDefs = {
      sw: { x: -hw, y: -hh },
      se: { x: hw, y: -hh },
      ne: { x: hw, y: hh },
      nw: { x: -hw, y: hh }
    };

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const result = { rotationDeg };

    for (const [key, c] of Object.entries(cornerDefs)) {
      const rx = cx + c.x * cos + c.y * sin;   // (or dx/dy in pointToLatLng)
      const ry = cy - c.x * sin + c.y * cos;

      const lng = (rx * 180) / (Math.PI * R);
      const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(ry / R)) - Math.PI / 2);

      result[key] = { lat, lng };
    }

    return result;
  }

  // Projects a single (dx, dy) meter-offset from the overlay's center —
  // already rotated into overlay space — into lat/lng. Same math
  // computeCorners uses for its 4 fixed corners, generalized to any point.
  pointToLatLng(overlay, dx, dy) {
    const { center, rotationDeg } = overlay;
    const R = 6378137;
    const cx = (center.lng * Math.PI * R) / 180;
    const cy = R * Math.log(Math.tan(Math.PI / 4 + (center.lat * Math.PI) / 360));

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const rx = cx + dx * cos + dy * sin;
    const ry = cy - dx * sin + dy * cos;

    const lng = (rx * 180) / (Math.PI * R);
    const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(ry / R)) - Math.PI / 2);
    return { lat, lng };
  }

  // Traces the *actual* shape drawn in the floorplan raster (its
  // transparent/background-colored margin excluded) and returns it as an
  // array of {lat, lng} — the real outline, not the bounding rectangle.
  // Returns null if tracing isn't possible, so callers can fall back to
  // computeCorners().
  async computeImageBoundary(id, opts = {}) {
    const entry = this.overlays.get(id);
    if (!entry) return null;
    const { overlay, url, originalWidth: W, originalHeight: H } = entry;

    try {
      // Fetch as a blob and draw via createImageBitmap instead of reusing
      // the shared <img> element. A blob-sourced draw can never taint the
      // canvas, regardless of the image host's CORS headers or whether
      // `crossOrigin` was honored — this is what was silently throwing
      // SecurityError on getImageData and forcing the rectangle fallback.
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const blob = await res.blob();
      const bitmap = await createImageBitmap(blob);

      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0, W, H);
      const imageData = ctx.getImageData(0, 0, W, H);

      const mask = extractForegroundMask(imageData, W, H);
      let contourPx = traceContour(mask, W, H);
      if (!contourPx || contourPx.length < 3) return null;

      const epsilon = Math.max(W, H) * (opts.simplifyTolerance ?? 0.0015);
      contourPx = simplifyPolygon(contourPx, epsilon);

      const scaleX = overlay.widthMeters / W;
      const scaleY = overlay.heightMeters / H;

      let H_matrix = null;
      if (overlay.distortedCorners) {
        const dc = overlay.distortedCorners;
        const src = [
          {x: 0, y: 0},
          {x: W, y: 0},
          {x: W, y: H},
          {x: 0, y: H}
        ];
        const dst = [
          {x: dc.nw.lng, y: dc.nw.lat},
          {x: dc.ne.lng, y: dc.ne.lat},
          {x: dc.se.lng, y: dc.se.lat},
          {x: dc.sw.lng, y: dc.sw.lat}
        ];
        H_matrix = solveHomography(src, dst);
      }

      return contourPx.map((p) => {
        if (H_matrix) {
          const pt = mapPoint(p.x, p.y, H_matrix);
          return { lat: pt.y, lng: pt.x };
        } else {
          // Pixel (0,0) is the image's top-left → north-west corner, so flip Y.
          const dx = (p.x - W / 2) * scaleX;
          const dy = (H / 2 - p.y) * scaleY;
          return this.pointToLatLng(overlay, dx, dy);
        }
      });
    } catch (err) {
      console.warn('Floorplan boundary trace failed, falling back to rectangle:', err);
      return null;
    }
  }

  // Generalized pixel to lat/lng projection for arbitrary pixel coordinates in the image
  projectPixelsToLatLngs(id, pixels, W, H) {
    const entry = this.overlays.get(id);
    if (!entry) return null;
    const { overlay } = entry;

    const scaleX = overlay.widthMeters / W;
    const scaleY = overlay.heightMeters / H;

    let H_matrix = null;
    if (overlay.distortedCorners) {
      const dc = overlay.distortedCorners;
      const src = [
        {x: 0, y: 0},
        {x: W, y: 0},
        {x: W, y: H},
        {x: 0, y: H}
      ];
      const dst = [
        {x: dc.nw.lng, y: dc.nw.lat},
        {x: dc.ne.lng, y: dc.ne.lat},
        {x: dc.se.lng, y: dc.se.lat},
        {x: dc.sw.lng, y: dc.sw.lat}
      ];
      H_matrix = solveHomography(src, dst);
    }

    return pixels.map((p) => {
      if (H_matrix) {
        const pt = mapPoint(p.x, p.y, H_matrix);
        return { lat: pt.y, lng: pt.x };
      } else {
        const dx = (p.x - W / 2) * scaleX;
        const dy = (H / 2 - p.y) * scaleY;
        return this.pointToLatLng(overlay, dx, dy);
      }
    });
  }

  // Inverse of pointToLatLng
  latLngToPoint(overlay, lat, lng) {
    const { center, rotationDeg } = overlay;
    const R = 6378137;
    const cx = (center.lng * Math.PI * R) / 180;
    const cy = R * Math.log(Math.tan(Math.PI / 4 + (center.lat * Math.PI) / 360));

    const rx = (lng * Math.PI * R) / 180;
    const ry = R * Math.log(Math.tan((lat * Math.PI) / 180 / 2 + Math.PI / 4));

    const rad = (rotationDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // We have:
    // rx = cx + dx*cos + dy*sin
    // ry = cy - dx*sin + dy*cos
    // Let ux = rx - cx, uy = ry - cy
    // ux = dx*cos + dy*sin
    // uy = -dx*sin + dy*cos
    // Multiply by rotation matrix inverse:
    // dx = ux*cos - uy*sin
    // dy = ux*sin + uy*cos

    const ux = rx - cx;
    const uy = ry - cy;

    const dx = ux * cos - uy * sin;
    const dy = ux * sin + uy * cos;

    return { dx, dy };
  }

  // Generalized lat/lng to pixel projection
  projectLatLngsToPixels(id, latLngs, W, H) {
    const entry = this.overlays.get(id);
    if (!entry) return null;
    const { overlay } = entry;

    const scaleX = overlay.widthMeters / W;
    const scaleY = overlay.heightMeters / H;

    let H_inv_matrix = null;
    if (overlay.distortedCorners) {
      const dc = overlay.distortedCorners;
      const src = [
        {x: 0, y: 0},
        {x: W, y: 0},
        {x: W, y: H},
        {x: 0, y: H}
      ];
      const dst = [
        {x: dc.nw.lng, y: dc.nw.lat},
        {x: dc.ne.lng, y: dc.ne.lat},
        {x: dc.se.lng, y: dc.se.lat},
        {x: dc.sw.lng, y: dc.sw.lat}
      ];
      // Swap src and dst to solve for the inverse homography
      H_inv_matrix = solveHomography(dst, src);
    }

    return latLngs.map((ll) => {
      const lat = typeof ll.lat === 'function' ? ll.lat() : ll.lat;
      const lng = typeof ll.lng === 'function' ? ll.lng() : ll.lng;

      if (H_inv_matrix) {
        const pt = mapPoint(lng, lat, H_inv_matrix);
        return { x: pt.x, y: pt.y };
      } else {
        const { dx, dy } = this.latLngToPoint(overlay, lat, lng);
        const px = (dx / scaleX) + (W / 2);
        const py = (H / 2) - (dy / scaleY);
        return { x: px, y: py };
      }
    });
  }

  // Returns array of objects formatted exactly as requested
  getState() {
    return Array.from(this.overlays.values()).map(entry => {
      const bounds = this.computeBounds(entry.overlay);
      const cornersObj = this.computeCorners(entry.overlay);
      const scale = entry.overlay.widthMeters / entry.originalWidth; // update scale from current width
      return {
        id: entry.id,
        name: entry.name || 'Floor Plan',
        floorplan: entry.url,
        bounds,
        corners: cornersObj,
        distortedCorners: entry.overlay.distortedCorners,
        rotation: entry.overlay.rotationDeg,
        scale,
        opacity: entry.overlay.opacity,
        layerId: entry.layerId || 'layer-1',
        timestamp: entry.timestamp || new Date().toISOString(),
        visible: entry.itemVisible !== false
      };
    });
  }

  updateOpacity(id, opacity) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    const oldOp = entry.overlay.opacity;
    entry.overlay.update({ opacity });
    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => { entry.overlay.update({ opacity: oldOp }); },
      redo: () => { entry.overlay.update({ opacity }); }
    });
    this.callbacks.onChange && this.callbacks.onChange();
  }

  onSelect(id) {
    this.selectedId = id;
    this.callbacks.onSelect && this.callbacks.onSelect(id);
  }

  onChange(id) {
    this.callbacks.onChange && this.callbacks.onChange(id);
  }

  toggleVisibility(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    entry.itemVisible = entry.itemVisible === false ? true : false;
    this.callbacks.onChange && this.callbacks.onChange();
  }

  setAllPointerEvents(isClickable) {
    this.isClickable = isClickable;
    this.overlays.forEach(entry => {
      if (entry.overlay) entry.overlay.update({ isClickable });
    });
  }

  commitChange(id, startState, endState) {
    const entry = this.overlays.get(id);
    if (!entry) return;

    const { overlay } = entry;
    // Push undo/redo
    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        overlay.update({
          center: startState.origCenter,
          widthMeters: startState.origWidth,
          heightMeters: startState.origHeight,
          rotationDeg: startState.origRot,
          distortedCorners: startState.origDistortedCorners ? { ...startState.origDistortedCorners } : null
        });
        this.callbacks.onChange && this.callbacks.onChange(id);
      },
      redo: () => {
        overlay.update(endState);
        this.callbacks.onChange && this.callbacks.onChange(id);
      }
    });
    this.callbacks.onChange && this.callbacks.onChange(id);
  }

  delete(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;

    if (this.callbacks.pushHistory) {
      this.callbacks.pushHistory({
        undo: () => {
          entry.overlay.setMap(this.map);
          this.overlays.set(id, entry);
          this.callbacks.onChange && this.callbacks.onChange();
        },
        redo: () => {
          entry.overlay.setMap(null);
          this.overlays.delete(id);
          if (this.selectedId === id) this.selectedId = null;
          this.callbacks.onDelete && this.callbacks.onDelete(id);
          this.callbacks.onChange && this.callbacks.onChange();
        }
      });
    }

    entry.overlay.setMap(null);
    this.overlays.delete(id);
    if (this.selectedId === id) this.selectedId = null;
    this.callbacks.onDelete && this.callbacks.onDelete(id);
    this.callbacks.onChange && this.callbacks.onChange();
  }

  reorder(draggedId, targetId) {
    if (draggedId === targetId) return;
    const draggedEntry = this.overlays.get(draggedId);
    const targetEntry = this.overlays.get(targetId);
    if (!draggedEntry || !targetEntry) return;

    if (draggedEntry.layerId !== targetEntry.layerId) return;

    const keys = Array.from(this.overlays.keys());
    const draggedIdx = keys.indexOf(draggedId);
    const targetIdx = keys.indexOf(targetId);

    if (draggedIdx === -1 || targetIdx === -1) return;

    keys.splice(draggedIdx, 1);
    const newTargetIdx = keys.indexOf(targetId);
    
    if (draggedIdx < targetIdx) {
      keys.splice(newTargetIdx + 1, 0, draggedId);
    } else {
      keys.splice(newTargetIdx, 0, draggedId);
    }

    const newMap = new Map();
    for (const key of keys) {
      newMap.set(key, this.overlays.get(key));
    }
    this.overlays = newMap;
    
    // Reverse iterate so top items get higher z-indexes
    let zIdxCounter = 0;
    for (const entry of this.overlays.values()) {
        entry.overlay.update({ zIndex: ++zIdxCounter });
    }

    this.callbacks.onChange && this.callbacks.onChange();
  }

  applyGCPTransform(id, transformResult) {
    const entry = this.overlays.get(id);
    if (!entry) return;

    const startState = {
      origCenter: { ...entry.overlay.center },
      origWidth: entry.overlay.widthMeters,
      origHeight: entry.overlay.heightMeters,
      origRot: entry.overlay.rotationDeg
    };

    const endState = {
      center: transformResult.centerLatLng,
      widthMeters: transformResult.widthMeters,
      heightMeters: transformResult.heightMeters,
      rotationDeg: transformResult.rotationDeg
    };

    entry.overlay.update(endState);
    this.commitChange(id, startState, endState);
  }

  reset(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    const startState = {
      origCenter: { ...entry.overlay.center },
      origWidth: entry.overlay.widthMeters,
      origHeight: entry.overlay.heightMeters,
      origRot: entry.overlay.rotationDeg
    };
    const endState = {
      rotationDeg: 0,
      widthMeters: entry.originalWidth, // scale = 1
      heightMeters: entry.originalHeight
    };
    entry.overlay.update(endState);
    this.commitChange(id, startState, endState);
  }

  async toggleLock(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    const isLocked = !entry.overlay.isLocked;
    entry.overlay.update({ isLocked });
    // On lock (not unlock), hand the exact rotated-rectangle corners to
    // whoever wants to auto-plot the boundary polygon.
    if (isLocked) {
      let path = await this.computeImageBoundary(id);
      if (!path) {
        if (entry.overlay.distortedCorners) {
          const dc = entry.overlay.distortedCorners;
          path = [dc.nw, dc.ne, dc.se, dc.sw];
        } else {
          const c = this.computeCorners(entry.overlay);
          path = [c.nw, c.ne, c.se, c.sw];
        }
      }
      this.callbacks.onLock && this.callbacks.onLock(id, path, entry);
    }
    this.callbacks.onChange && this.callbacks.onChange();
  }

  toggleAspectLock(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    const isAspectLocked = !entry.overlay.isAspectLocked;
    entry.overlay.update({ isAspectLocked });
    this.callbacks.onChange && this.callbacks.onChange();
  }

  downloadSave(id) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    const bounds = this.computeBounds(entry.overlay);
    const scale = entry.overlay.widthMeters / entry.originalWidth;
    const data = {
      floorplan: entry.url,
      bounds,
      rotation: entry.overlay.rotationDeg,
      scale,
      opacity: entry.overlay.opacity,
      distortedCorners: entry.overlay.distortedCorners,
      timestamp: entry.timestamp || new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `floorplan-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  rename(id, name) {
    const entry = this.overlays.get(id);
    if (!entry) return;
    entry.name = name;
    this.callbacks.onChange && this.callbacks.onChange();
  }

  async replaceImage(id, newUrl) {
    return new Promise((resolve, reject) => {
      const entry = this.overlays.get(id);
      if (!entry) return reject(new Error('Floor plan not found'));

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        entry.url = newUrl;
        entry.imgEl = img;
        
        if (entry.overlay && entry.overlay.img) {
          entry.overlay.url = newUrl;
          entry.overlay.img.src = newUrl;
        }

        this.callbacks.onChange && this.callbacks.onChange();
        resolve(id);
      };
      img.onerror = reject;
      img.src = newUrl;
    });
  }
}