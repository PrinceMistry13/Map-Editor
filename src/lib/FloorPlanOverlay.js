import { solveHomography } from '../utils/homography';

export function createFloorPlanOverlayClass() {
  if (window.FloorPlanOverlayClass) return window.FloorPlanOverlayClass;

  class FloorPlanOverlay extends window.google.maps.OverlayView {
    constructor(opts) {
      super();
      this.id = opts.id;
      this.url = opts.url;
      this.center = opts.center; // { lat, lng }
      this.widthMeters = opts.widthMeters;
      this.heightMeters = opts.heightMeters;
      this.rotationDeg = opts.rotationDeg || 0;
      this.opacity = opts.opacity ?? 1;
      this.isLocked = opts.isLocked || false;
      this.isAspectLocked = opts.isAspectLocked ?? true;
      this.mode = opts.mode || 'manual';
      this.distortedCorners = opts.distortedCorners || null;
      this.manager = opts.manager;
      
      this.div = null;
      this.eventDiv = null;
      this.img = null;
      
      this.onInteractStart = this.onInteractStart.bind(this);
      this.onInteractMove = this.onInteractMove.bind(this);
      this.onInteractEnd = this.onInteractEnd.bind(this);
      
      this.interactState = null; // { type: 'drag'|'resize'|'rotate', startX, startY, origCenter, origWidth, origHeight, origRot, mapOptionsBackup }
      
      if (opts.map) {
        this.setMap(opts.map);
      }
    }

    onAdd() {
      // Visual Div (Layered correctly with polygons)
      this.div = document.createElement('div');
      this.div.className = 'fp-overlay-visual';
      this.div.style.position = 'absolute';
      this.div.style.zIndex = '1';
      this.div.style.pointerEvents = 'none'; // Visual only
      this.div.style.transformOrigin = 'center center';
      
      this.img = document.createElement('img');
      this.img.src = this.url;
      this.img.style.width = '100%';
      this.img.style.height = '100%';
      this.img.style.pointerEvents = 'none';
      this.div.appendChild(this.img);

      // Event Div (Catches mouse events in the top pane)
      this.eventDiv = document.createElement('div');
      this.eventDiv.className = 'fp-overlay-container';
      this.eventDiv.style.position = 'absolute';
      this.eventDiv.style.zIndex = '100';
      this.eventDiv.style.cursor = this.isLocked ? 'default' : 'move';
      this.eventDiv.style.transformOrigin = 'center center';
      this.eventDiv.style.pointerEvents = this.isLocked ? 'none' : 'auto';
      
      if (this.isLocked) {
        this.eventDiv.classList.add('fp-locked');
      }

      // Handles
      // Create handles unconditionally, we will hide them with CSS when locked
      const createHandle = (type, cursor, cls) => {
        const h = document.createElement('div');
        h.className = `fp-handle fp-handle-${cls}`;
        h.dataset.type = type;
        h.dataset.cls = cls;
        h.style.cursor = cursor;
        h.style.position = 'absolute';
        this.eventDiv.appendChild(h);
      };
      createHandle('resize', 'nwse-resize', 'nw');
      createHandle('resize', 'nesw-resize', 'ne');
      createHandle('resize', 'nwse-resize', 'se');
      createHandle('resize', 'nesw-resize', 'sw');
      createHandle('resize', 'ns-resize', 'n');
      createHandle('resize', 'ns-resize', 's');
      createHandle('resize', 'ew-resize', 'e');
      createHandle('resize', 'ew-resize', 'w');
      createHandle('rotate', 'crosshair', 'rotate');
      createHandle('drag', 'move', 'center');

      this.eventDiv.addEventListener('mousedown', this.onInteractStart);
      this.eventDiv.addEventListener('touchstart', this.onInteractStart, { passive: false });
      
      const panes = this.getPanes();
      panes.overlayLayer.appendChild(this.div);
      panes.overlayMouseTarget.appendChild(this.eventDiv);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      if (!projection) return;
      
      if (this.distortedCorners) {
        this.div.style.left = '0px';
        this.div.style.top = '0px';
        this.div.style.width = '0px';
        this.div.style.height = '0px';
        this.div.style.transform = 'none';
        this.div.style.opacity = this.opacity;

        this.eventDiv.style.left = '0px';
        this.eventDiv.style.top = '0px';
        this.eventDiv.style.width = '0px';
        this.eventDiv.style.height = '0px';
        this.eventDiv.style.transform = 'none';

        const w = 1000, h = 1000;
        const src = [
          {x: 0, y: 0},
          {x: w, y: 0},
          {x: w, y: h},
          {x: 0, y: h}
        ];

        const dc = this.distortedCorners;
        const pNW = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(dc.nw.lat, dc.nw.lng));
        const pNE = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(dc.ne.lat, dc.ne.lng));
        const pSE = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(dc.se.lat, dc.se.lng));
        const pSW = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(dc.sw.lat, dc.sw.lng));
        
        const dst = [
          {x: pNW.x, y: pNW.y},
          {x: pNE.x, y: pNE.y},
          {x: pSE.x, y: pSE.y},
          {x: pSW.x, y: pSW.y}
        ];

        const handles = this.eventDiv.querySelectorAll('.fp-handle');
        handles.forEach(handle => {
          const cls = handle.dataset.cls;
          if (this.mode === 'distort' && ['nw', 'ne', 'se', 'sw'].includes(cls)) {
            handle.style.display = 'block';
            const pt = dst[['nw', 'ne', 'se', 'sw'].indexOf(cls)];
            handle.style.left = (pt.x - 6) + 'px';
            handle.style.top = (pt.y - 6) + 'px';
            handle.style.right = '';
            handle.style.bottom = '';
          } else {
            handle.style.display = 'none';
          }
        });

        const H = solveHomography(src, dst);
        this.img.style.position = 'absolute';
        this.img.style.left = '0px';
        this.img.style.top = '0px';
        this.img.style.width = w + 'px';
        this.img.style.height = h + 'px';
        this.img.style.transformOrigin = '0 0';
        this.img.style.transform = `matrix3d(${H.join(',')})`;

      } else {
        const centerPx = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(this.center.lat, this.center.lng));
        
        const R = 6378137;
        const cx = (this.center.lng * Math.PI * R) / 180;
        const cy = R * Math.log(Math.tan(Math.PI / 4 + (this.center.lat * Math.PI) / 360));
        
        const eLng = ((cx + this.widthMeters / 2) * 180) / (Math.PI * R);
        const nLat = (180 / Math.PI) * (2 * Math.atan(Math.exp((cy + this.heightMeters / 2) / R)) - Math.PI / 2);
        
        const eastPx = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(this.center.lat, eLng));
        const northPx = projection.fromLatLngToDivPixel(new window.google.maps.LatLng(nLat, this.center.lng));
        
        const widthPx = Math.abs(eastPx.x - centerPx.x) * 2;
        const heightPx = Math.abs(northPx.y - centerPx.y) * 2;
        
        this.div.style.left = (centerPx.x - widthPx / 2) + 'px';
        this.div.style.top = (centerPx.y - heightPx / 2) + 'px';
        this.div.style.width = widthPx + 'px';
        this.div.style.height = heightPx + 'px';
        this.div.style.transform = `rotate(${this.rotationDeg}deg)`;
        this.div.style.opacity = this.opacity;

        this.eventDiv.style.left = (centerPx.x - widthPx / 2) + 'px';
        this.eventDiv.style.top = (centerPx.y - heightPx / 2) + 'px';
        this.eventDiv.style.width = widthPx + 'px';
        this.eventDiv.style.height = heightPx + 'px';
        this.eventDiv.style.transform = `rotate(${this.rotationDeg}deg)`;

        this.img.style.position = '';
        this.img.style.left = '';
        this.img.style.top = '';
        this.img.style.width = '100%';
        this.img.style.height = '100%';
        this.img.style.transformOrigin = '';
        this.img.style.transform = '';

        const handles = this.eventDiv.querySelectorAll('.fp-handle');
        handles.forEach(handle => {
          handle.style.display = '';
          handle.style.left = '';
          handle.style.top = '';
          handle.style.right = '';
          handle.style.bottom = '';
        });
      }
    }

    onRemove() {
      if (this.div) {
        if (this.div.parentNode) this.div.parentNode.removeChild(this.div);
        this.div = null;
      }
      if (this.eventDiv) {
        this.eventDiv.removeEventListener('mousedown', this.onInteractStart);
        this.eventDiv.removeEventListener('touchstart', this.onInteractStart);
        if (this.eventDiv.parentNode) this.eventDiv.parentNode.removeChild(this.eventDiv);
        this.eventDiv = null;
      }
    }

    update(opts) {
      if (opts.center !== undefined) this.center = opts.center;
      if (opts.widthMeters !== undefined) this.widthMeters = opts.widthMeters;
      if (opts.heightMeters !== undefined) this.heightMeters = opts.heightMeters;
      if (opts.rotationDeg !== undefined) this.rotationDeg = opts.rotationDeg;
      if (opts.opacity !== undefined) {
        this.opacity = opts.opacity;
        if (this.div) this.div.style.opacity = this.opacity;
      }
      if (opts.isLocked !== undefined) {
        this.isLocked = opts.isLocked;
      }
      if (opts.isClickable !== undefined) {
        this.isClickable = opts.isClickable;
      }
      if (this.eventDiv) {
        this.eventDiv.style.cursor = this.isLocked ? 'default' : 'move';
        
        // Disable pointer events if it's explicitly locked, OR if clickability is globally disabled (tool active)
        const effectivelyLocked = this.isLocked || (this.isClickable === false);
        this.eventDiv.style.pointerEvents = effectivelyLocked ? 'none' : 'auto';
        
        if (this.isLocked) {
          this.eventDiv.classList.add('fp-locked');
        } else {
          this.eventDiv.classList.remove('fp-locked');
        }
      }
      if (opts.isAspectLocked !== undefined) {
        this.isAspectLocked = opts.isAspectLocked;
      }
      if (opts.mode !== undefined) {
        if (opts.mode === 'distort' && this.mode !== 'distort') {
          if (!this.distortedCorners) {
            this.distortedCorners = this.manager.computeCorners(this);
          }
        }
        this.mode = opts.mode;
      }
      if (opts.distortedCorners !== undefined) {
        this.distortedCorners = opts.distortedCorners;
      }
      this.draw();
    }

    onInteractStart(e) {
      if (this.manager.callbacks.getActiveTool && this.manager.callbacks.getActiveTool() !== null) return;
      if (this.isLocked) {
        this.manager.onSelect(this.id);
        return;
      }
      e.stopPropagation();
      e.preventDefault();
      
      const target = e.target;
      const type = target.dataset.type || 'drag';
      const handleClass = target.dataset.cls;
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;

      const map = this.getMap();
      const proj = this.getProjection();

      if (this.mode === 'distort' && ['nw', 'ne', 'se', 'sw'].includes(handleClass)) {
        const cornerLatLng = this.distortedCorners[handleClass];
        const cornerPx = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(cornerLatLng.lat, cornerLatLng.lng));
        this.interactState = {
          type: 'distort',
          handle: handleClass,
          startX: clientX,
          startY: clientY,
          origCornerPx: cornerPx,
          origDistortedCorners: { ...this.distortedCorners }
        };
        map.setOptions({ draggable: false, gestureHandling: "none", scrollwheel: false, disableDoubleClickZoom: true });
        document.addEventListener('mousemove', this.onInteractMove);
        document.addEventListener('mouseup', this.onInteractEnd);
        document.addEventListener('touchmove', this.onInteractMove, { passive: false });
        document.addEventListener('touchend', this.onInteractEnd);
        this.manager.onSelect(this.id);
        return;
      }

      const origCenterPx = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(this.center.lat, this.center.lng));
      const zoom = map.getZoom();
      const metersPerPx = (156543.03392 * Math.cos(this.center.lat * Math.PI / 180)) / Math.pow(2, zoom);

      // Determine local signs for the dragged handle
      const dragSignX = handleClass && handleClass.includes('e') ? 1 : (handleClass && handleClass.includes('w') ? -1 : 0);
      const dragSignY = handleClass && handleClass.includes('s') ? 1 : (handleClass && handleClass.includes('n') ? -1 : 0);

      // Opposite corner/edge center in unrotated local coords
      const oppLocalX = -dragSignX * (this.widthMeters / metersPerPx / 2);
      const oppLocalY = -dragSignY * (this.heightMeters / metersPerPx / 2);

      const rotatePt = (x, y, deg) => {
        const rad = deg * Math.PI / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        return { x: x * cos - y * sin, y: x * sin + y * cos };
      };

      const oppScreenRel = rotatePt(oppLocalX, oppLocalY, this.rotationDeg);
      const oppScreenPx = new window.google.maps.Point(origCenterPx.x + oppScreenRel.x, origCenterPx.y + oppScreenRel.y);
      const oppLatLng = proj.fromDivPixelToLatLng(oppScreenPx);

      this.interactState = {
        type,
        handle: handleClass,
        startX: clientX,
        startY: clientY,
        origCenter: { ...this.center },
        origCenterPx,
        origWidthPx: this.widthMeters / metersPerPx,
        origHeightPx: this.heightMeters / metersPerPx,
        origWidth: this.widthMeters,
        origHeight: this.heightMeters,
        origRot: this.rotationDeg,
        origAspect: this.widthMeters / this.heightMeters,
        metersPerPx,
        dragSignX,
        dragSignY,
        oppLatLng: { lat: oppLatLng.lat(), lng: oppLatLng.lng() }
      };

      // Zero map jitter: suspend all gestures
      map.setOptions({ draggable: false, gestureHandling: "none", scrollwheel: false, disableDoubleClickZoom: true });

      document.addEventListener('mousemove', this.onInteractMove);
      document.addEventListener('mouseup', this.onInteractEnd);
      document.addEventListener('touchmove', this.onInteractMove, { passive: false });
      document.addEventListener('touchend', this.onInteractEnd);
      
      this.manager.onSelect(this.id);
    }

    onInteractMove(e) {
      if (!this.interactState) return;
      e.preventDefault();
      
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      
      const dx = clientX - this.interactState.startX;
      const dy = clientY - this.interactState.startY;
      
      const map = this.getMap();
      const zoom = map.getZoom();
      const metersPerPx = (156543.03392 * Math.cos(this.center.lat * Math.PI / 180)) / Math.pow(2, zoom);
      
      if (this.interactState.type === 'distort') {
        const proj = this.getProjection();
        const newCornerPx = new window.google.maps.Point(
          this.interactState.origCornerPx.x + dx, 
          this.interactState.origCornerPx.y + dy
        );
        const newCornerLatLng = proj.fromDivPixelToLatLng(newCornerPx);
        this.distortedCorners = {
          ...this.distortedCorners,
          [this.interactState.handle]: { lat: newCornerLatLng.lat(), lng: newCornerLatLng.lng() }
        };
      } else if (this.interactState.type === 'drag') {
        const proj = this.getProjection();
        const newCenterPx = new window.google.maps.Point(this.interactState.origCenterPx.x + dx, this.interactState.origCenterPx.y + dy);
        const newCenterLatLng = proj.fromDivPixelToLatLng(newCenterPx);
        this.center = { lat: newCenterLatLng.lat(), lng: newCenterLatLng.lng() };
      } else if (this.interactState.type === 'resize') {
        const proj = this.getProjection();
        const { dragSignX, dragSignY, oppLatLng, origRot, origWidthPx, origHeightPx, origCenterPx, origCenter } = this.interactState;
        
        const oppScreen = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(oppLatLng.lat, oppLatLng.lng));
        
        const dragLocalX = dragSignX * (origWidthPx / 2);
        const dragLocalY = dragSignY * (origHeightPx / 2);
        
        const rotatePt = (x, y, deg) => {
          const rad = deg * Math.PI / 180;
          return { x: x * Math.cos(rad) - y * Math.sin(rad), y: x * Math.sin(rad) + y * Math.cos(rad) };
        };
        
        // Find original dragged corner screen coordinate relative to original center
        const dragScreenRel = rotatePt(dragLocalX, dragLocalY, origRot);
        
        // Recalculate origCenterPx just in case map projection changed slightly, though we try to keep it stable
        const currentOrigCenterPx = proj.fromLatLngToDivPixel(new window.google.maps.LatLng(origCenter.lat, origCenter.lng));
        const origDragScreen = {
          x: currentOrigCenterPx.x + dragScreenRel.x,
          y: currentOrigCenterPx.y + dragScreenRel.y
        };
        
        // New screen coordinate of dragged corner based on mouse delta
        const newDragScreen = {
          x: origDragScreen.x + dx,
          y: origDragScreen.y + dy
        };
        
        // Vector from opposite point to new dragged point in screen space
        const newDiagScreen = {
          x: newDragScreen.x - oppScreen.x,
          y: newDragScreen.y - oppScreen.y
        };
        
        // Unrotate into local space
        const newDiagLocal = rotatePt(newDiagScreen.x, newDiagScreen.y, -origRot);
        
        let newWidthPx = origWidthPx;
        let newHeightPx = origHeightPx;
        
        if (dragSignX !== 0) {
          newWidthPx = dragSignX * newDiagLocal.x; 
        }
        if (dragSignY !== 0) {
          newHeightPx = dragSignY * newDiagLocal.y;
        }
        
        newWidthPx = Math.max(10, newWidthPx);
        newHeightPx = Math.max(10, newHeightPx);
        
        if (this.isAspectLocked) {
          const scaleX = newWidthPx / origWidthPx;
          const scaleY = newHeightPx / origHeightPx;
          
          let scale = 1;
          if (dragSignX !== 0 && dragSignY !== 0) {
            scale = Math.max(scaleX, scaleY);
          } else if (dragSignX !== 0) {
            scale = scaleX;
          } else if (dragSignY !== 0) {
            scale = scaleY;
          }
          
          newWidthPx = origWidthPx * scale;
          newHeightPx = origHeightPx * scale;
        }
        
        // Center in local space relative to the opposite point anchor
        const centerLocalRelOpp = {
          x: dragSignX * (newWidthPx / 2),
          y: dragSignY * (newHeightPx / 2)
        };
        
        const centerScreenRelOpp = rotatePt(centerLocalRelOpp.x, centerLocalRelOpp.y, origRot);
        
        const newCenterPx = new window.google.maps.Point(
          oppScreen.x + centerScreenRelOpp.x,
          oppScreen.y + centerScreenRelOpp.y
        );
        
        const newCenterLatLng = proj.fromDivPixelToLatLng(newCenterPx);
        this.center = { lat: newCenterLatLng.lat(), lng: newCenterLatLng.lng() };
        this.widthMeters = newWidthPx * this.interactState.metersPerPx;
        this.heightMeters = newHeightPx * this.interactState.metersPerPx;
      } else if (this.interactState.type === 'rotate') {
        // Compute angle relative to center
        const rect = this.eventDiv.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(clientY - centerY, clientX - centerX);
        // The rotate handle is at the top, which is -PI/2.
        const deg = (angle * 180 / Math.PI) + 90;
        this.rotationDeg = deg;
      }
      
      this.draw();
      this.manager.onChange(this.id);
    }

    onInteractEnd() {
      if (!this.interactState) return;
      document.removeEventListener('mousemove', this.onInteractMove);
      document.removeEventListener('mouseup', this.onInteractEnd);
      document.removeEventListener('touchmove', this.onInteractMove);
      document.removeEventListener('touchend', this.onInteractEnd);
      
      const map = this.getMap();
      // Restore map options
      map.setOptions({ draggable: true, gestureHandling: "greedy", scrollwheel: true, disableDoubleClickZoom: false });
      
      const finalState = {
        center: this.center,
        widthMeters: this.widthMeters,
        heightMeters: this.heightMeters,
        rotationDeg: this.rotationDeg,
        distortedCorners: this.distortedCorners ? { ...this.distortedCorners } : null
      };
      
      this.manager.commitChange(this.id, this.interactState, finalState);
      this.interactState = null;
    }
  }

  window.FloorPlanOverlayClass = FloorPlanOverlay;
  return FloorPlanOverlay;
}
