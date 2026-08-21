import { polygonArea, polygonPerimeter } from '../utils/polygonMetrics';

/**
 * PolygonManager — owns the lifecycle of drawn boundary polygons as native
 * google.maps.Polygon overlays. Point-by-point drawing itself happens in
 * MapWorkspace (map click/mousemove listeners); this class only ever
 * receives a finished path via createPolygon(). Selection only shows the
 * popup; it never auto-enters edit mode. Edit mode is only entered via the
 * explicit "Edit Geometry" button, and a freshly created polygon is always
 * non-editable until the user asks to edit it.
 */
export default class PolygonManager {
  constructor(map, callbacks = {}) {
    this.map = map;
    this.callbacks = callbacks; // { onSelect(entry, latLng), onEditToggle, onChange(), pushHistory({undo, redo}) }
    this.polygons = new Map(); // id -> { id, name, category, gPolygon }
    this.zCounter = 0;
    this.selectedId = null;
    this.isEditing = false;
    this.hoveredVertexIndex = null;
    this.lastMouseLatLng = null;
  }

  getBaseZIndex(category) {
    if (category === 'project') return 10000;
    if (category === 'landmark') return 20000;
    if (category === 'road' || category === 'bridge') return 25000;
    if (category === 'unit') return 30000;
    if (category === 'pending-unit') return 40000;
    return 10000;
  }

  // ---------------------------------------------------------------- lifecycle
  createPolygon(id, name, path, category = 'project', layerId = 'layer-1', color = null, metadata = {}, entryData = {}) {
    let defaultColor = '#00d4ff';
    if (category === 'unit' || category === 'pending-unit') defaultColor = '#ff6b6b';
    else if (category === 'landmark') defaultColor = '#8B5CF6';

    const finalColor = color || defaultColor;
    const isLine = category === 'road' || category === 'bridge';
    const GClass = isLine ? window.google.maps.Polyline : window.google.maps.Polygon;

    const gPolygon = new GClass({
      map: this.map,
      [isLine ? 'path' : 'paths']: path,
      strokeColor: finalColor,
      strokeWeight: entryData.strokeWeight ?? (isLine ? 3 : 2),
      ...(isLine ? {} : {
        fillColor: finalColor,
        fillOpacity: entryData.fillOpacity ?? 0.12,
        strokePosition: window.google.maps.StrokePosition.INSIDE,
      }),
      editable: false,
      clickable: true,
      zIndex: this.getBaseZIndex(category) + (++this.zCounter),
    });
    const entry = { id, name, category, layerId, color: finalColor, fillOpacity: entryData.fillOpacity ?? 0.12, strokeWeight: entryData.strokeWeight ?? 2, gPolygon, metadata, itemVisible: entryData.visible !== false };
    this.polygons.set(id, entry);

    let pathSnapshotBefore = null;
    const pathObj = gPolygon.getPath();

    entry.takeSnapshot = () => {
      pathSnapshotBefore = pathObj.getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
    };

    const captureChange = () => {
      const before = pathSnapshotBefore;
      const after = pathObj.getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
      if (before) {
        this.callbacks.pushHistory && this.callbacks.pushHistory({
          undo: () => { gPolygon.setPath(before); },
          redo: () => { gPolygon.setPath(after); },
        });
      }
      this.callbacks.onChange && this.callbacks.onChange();
      // Pass a shallow clone so React sees a new reference and re-renders
      // the live area/perimeter readout while the user drags a vertex.
      if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    };
    ['set_at', 'insert_at', 'remove_at'].forEach((evtName) => {
      pathObj.addListener(evtName, () => captureChange());
    });
    gPolygon.addListener('mousedown', () => {
      entry.takeSnapshot();
    });

    // Clicking an already-placed (non-editable) polygon re-selects it and
    // brings back its properties popup, so the user can re-enter edit mode.
    gPolygon.addListener('click', (e) => {
      if (this.callbacks.getActiveTool && this.callbacks.getActiveTool() !== null) {
        window.google.maps.event.trigger(this.map, 'click', e);
        return;
      }
      e.domEvent && e.domEvent.stopPropagation();

      // If we are already editing this very polygon/road, do not exit edit mode on click
      // (e.g. clicking the stroke to add a vertex should not abort the edit session).
      if (this.isEditing && this.selectedId === id) {
        return;
      }

      const currentCategory = this.polygons.get(id)?.category || 'project';
      gPolygon.setOptions({ zIndex: this.getBaseZIndex(currentCategory) + (++this.zCounter) });
      this.select(id, e.latLng ? e.latLng.toJSON() : null);
    });

    const trackHover = (e) => {
      if (e.latLng) {
        this.lastMouseLatLng = e.latLng;
      }

      if (!this.isEditing || this.selectedId !== id) return;
      if (!e.latLng || !window.google?.maps?.geometry?.spherical) return;

      const path = gPolygon.getPath();
      let minDist = Infinity;
      let closestIdx = null;

      const zoom = this.map.getZoom();
      const lat = e.latLng.lat();
      const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
      const isLine = category === 'road' || category === 'bridge';
      const thresholdMeters = (isLine ? 50 : 25) * metersPerPx;

      path.forEach((latLng, i) => {
        const distMeters = window.google.maps.geometry.spherical.computeDistanceBetween(e.latLng, latLng);
        if (distMeters < thresholdMeters && distMeters < minDist) {
          minDist = distMeters;
          closestIdx = i;
        }
      });
      this.hoveredVertexIndex = closestIdx;
    };

    gPolygon.addListener('mousemove', (e) => {
      if (this.callbacks.getActiveTool && this.callbacks.getActiveTool() !== null) {
        window.google.maps.event.trigger(this.map, 'mousemove', e);
      }
      trackHover(e);
    });

    // Native right-click to delete vertex (highly reliable fallback/standard method)
    gPolygon.addListener('rightclick', (e) => {
      if (this.isEditing && this.selectedId === id && e.vertex != null) {
        const pObj = gPolygon.getPath();
        const currentCat = this.polygons.get(id)?.category || 'project';
        const isRoad = currentCat === 'road' || currentCat === 'bridge';

        if (isRoad && pObj.getLength() <= 2) {
          alert('A road needs at least 2 points.');
          return;
        } else if (!isRoad && pObj.getLength() <= 3) {
          alert('A polygon must have at least 3 vertices.');
          return;
        }

        if (entry.takeSnapshot) entry.takeSnapshot();
        pObj.removeAt(e.vertex);
      }
    });

    this.map.addListener('mousemove', trackHover);

    return entry;
  }

  loadPolygon(data) {
    const rawPath = data.path || data.points || [];
    const path = rawPath.map((p) => new window.google.maps.LatLng(p.lat, p.lng));
    const color = data.color || data.lineColor;
    const weight = data.strokeWeight || data.lineWidth;
    this.createPolygon(data.id, data.name, path, data.category || 'project', data.layerId || 'layer-1', color, data.metadata || {}, { fillOpacity: data.fillOpacity, strokeWeight: weight, visible: data.visible });
  }

  // Bulk-restore from a saved project payload (replaces current polygons)
  loadAll(polygonsData = []) {
    this.clearAll();
    polygonsData.forEach((data) => this.loadPolygon(data));
  }

  select(id, latLng = null) {
    // Selection ONLY highlights/shows the popup — never auto-enters edit mode.
    this.exitEditMode();
    this.selectedId = id;
    const entry = this.polygons.get(id);
    if (entry) {
      const popupPos = latLng || entry.gPolygon.getPath().getAt(0)?.toJSON() || { lat: 0, lng: 0 };
      this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, popupPos);
    }
  }

  deselect() {
    this.exitEditMode();
    this.selectedId = null;
    this.callbacks.onSelect && this.callbacks.onSelect(null, null);
  }

  enterEditMode(id) {
    const entry = this.polygons.get(id);
    if (entry) {
      entry.gPolygon.setEditable(true);
      if (entry.category !== 'road' && entry.category !== 'bridge') {
        entry.gPolygon.setOptions({ strokeColor: '#ffb020', fillColor: '#ffb020' });
      } else {
        entry.gPolygon.setOptions({ strokeColor: '#ffb020' });
      }
      this.isEditing = true;
      this.callbacks.onEditToggle && this.callbacks.onEditToggle(entry, true);
    }
  }

  exitEditMode() {
    if (this.selectedId) {
      const entry = this.polygons.get(this.selectedId);
      if (entry) {
        entry.gPolygon.setEditable(false);
        if (entry.category !== 'road' && entry.category !== 'bridge') {
          entry.gPolygon.setOptions({ strokeColor: entry.color, fillColor: entry.color });
        } else {
          entry.gPolygon.setOptions({ strokeColor: entry.color });
        }
      }
    }
    this.isEditing = false;
    this.hoveredVertexIndex = null;
    this.callbacks.onEditToggle && this.callbacks.onEditToggle(null, false);
  }

  handleDeleteKey(e) {
    if (!this.isEditing) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const entry = this.polygons.get(this.selectedId);
    if (!entry) return;

    const path = entry.gPolygon.getPath();
    let targetIndex = this.hoveredVertexIndex;

    // Fallback: If we lost the hover index due to mouse events stopping on vertex handles,
    // recalculate it using the absolute last known mouse position on the map.
    if (targetIndex === null && this.lastMouseLatLng && window.google?.maps?.geometry?.spherical) {
      let minDist = Infinity;
      const zoom = this.map.getZoom();
      const lat = this.lastMouseLatLng.lat();
      const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
      const isLine = entry.category === 'road' || entry.category === 'bridge';
      const thresholdMeters = (isLine ? 50 : 25) * metersPerPx;

      path.forEach((latLng, i) => {
        const distMeters = window.google.maps.geometry.spherical.computeDistanceBetween(this.lastMouseLatLng, latLng);
        if (distMeters < thresholdMeters && distMeters < minDist) {
          minDist = distMeters;
          targetIndex = i;
        }
      });
    }

    if (targetIndex === null) return;

    // Check minimum vertices based on type
    if (entry.category === 'road' || entry.category === 'bridge') {
      if (path.getLength() <= 2) {
        alert('A road needs at least 2 points.');
        return;
      }
    } else {
      if (path.getLength() <= 3) {
        alert('A polygon must have at least 3 vertices.');
        return;
      }
    }

    // Take snapshot manually before keyboard deletion so undo/redo has the correct 'before' state
    if (entry.takeSnapshot) entry.takeSnapshot();

    path.removeAt(targetIndex);
    this.hoveredVertexIndex = null; // reset after delete
  }

  rename(id, name) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    const before = entry.name;
    entry.name = name;
    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        entry.name = before;
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
      redo: () => {
        entry.name = name;
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
    });
    this.callbacks.onChange && this.callbacks.onChange();
    // IMPORTANT: no latLng arg here. Passing one was wiping the popup
    // position on every keystroke, making the rename box "pop off" while typing.
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  // 'landmark' | 'project' — lets the user classify a boundary after the fact,
  // same as the naming popup asks when the polygon is first closed.
  setCategory(id, category) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    const beforeCat = entry.category;
    const beforeName = entry.name;
    const beforeColor = entry.color;
    entry.category = category;

    const applyColorAndName = (cat, name, colorOverride) => {
      let color = colorOverride;
      if (!color) {
        color = '#00d4ff';
        if (cat === 'landmark') color = '#8B5CF6';
        else if (cat === 'unit' || cat === 'pending-unit') color = '#ff6b6b';
      }
      const baseZ = this.getBaseZIndex(cat);
      entry.gPolygon.setOptions({
        strokeColor: color,
        fillColor: color,
        zIndex: baseZ + (++this.zCounter)
      });
      entry.color = color;
      entry.name = name;
    };

    // Auto-generated names (from creation, or a prior category toggle) keep
    // following the category as it's toggled — same as the live preview
    // shown in the naming popup before creation. A custom name the user
    // typed themselves is left alone.
    const isAutoGeneratedName = (name) => {
      const trimmed = (name || '').trim();
      return /^Boundary \d+$/.test(trimmed) || /^Landmark \d+$/.test(trimmed) || /^Unit \d+$/.test(trimmed) || /^\d+$/.test(trimmed) || trimmed === '';
    };

    let newName = beforeName;
    if (category !== beforeCat && isAutoGeneratedName(beforeName)) {
      if (category === 'unit' || category === 'pending-unit') {
        // Number continues from this polygon's own floorplan's Plots folder,
        // so each floorplan keeps its own independent 1, 2, 3... sequence.
        // Units with no floorplan (global) keep the old "Unit N" naming.
        const floorPlanId = entry.metadata?.floorPlanId;
        const samePlotFloorPlan = Array.from(this.polygons.values()).filter(p =>
          p.id !== id &&
          (p.category === 'unit' || p.category === 'pending-unit') &&
          (p.metadata?.floorPlanId || null) === (floorPlanId || null)
        );
        const highestPlotNo = samePlotFloorPlan.reduce((max, p) => {
          const n = parseInt(p.name, 10);
          const isPlainNumber = !isNaN(n) && n.toString() === (p.name || '').trim();
          return isPlainNumber && n > max ? n : max;
        }, 0);
        const nextNo = highestPlotNo > 0 || samePlotFloorPlan.length === 0
          ? highestPlotNo + 1
          : samePlotFloorPlan.length + 1;
        newName = floorPlanId ? `${nextNo}` : `Unit ${nextNo}`;
      } else if (category === 'landmark') {
        const count = Array.from(this.polygons.values()).filter(p => p.id !== id && p.category === 'landmark').length + 1;
        newName = `Landmark ${count}`;
      } else if (category === 'project') {
        const count = Array.from(this.polygons.values()).filter(p =>
          p.id !== id && p.category !== 'landmark' && p.category !== 'unit' && p.category !== 'pending-unit'
        ).length + 1;
        newName = `Boundary ${count}`;
      }
    }

    applyColorAndName(category, newName, null);

    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        entry.category = beforeCat;
        applyColorAndName(beforeCat, beforeName, beforeColor);
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
      redo: () => {
        entry.category = category;
        applyColorAndName(category, newName, null);
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
    });
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  setColor(id, color) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    const before = entry.color;
    entry.color = color;
    entry.gPolygon.setOptions({ strokeColor: color, fillColor: color });

    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        entry.color = before;
        entry.gPolygon.setOptions({ strokeColor: before, fillColor: before });
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
        this.callbacks.onChange && this.callbacks.onChange();
      },
      redo: () => this.setColor(id, color)
    });
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    this.callbacks.onChange && this.callbacks.onChange();
  }

  setUniformColor(id, color) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    if (!entry.originalColor) entry.originalColor = entry.color;
    entry.color = color;
    entry.gPolygon.setOptions({ strokeColor: color, fillColor: color });
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  restoreOriginalColor(id) {
    const entry = this.polygons.get(id);
    if (!entry || !entry.originalColor) return;
    entry.color = entry.originalColor;
    entry.gPolygon.setOptions({ strokeColor: entry.color, fillColor: entry.color });
    entry.originalColor = null;
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  setStyleField(id, field, value) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    entry[field] = value;
    if (field === 'fillOpacity') {
      entry.gPolygon.setOptions({ fillOpacity: value });
    } else if (field === 'strokeWeight') {
      entry.gPolygon.setOptions({ strokeWeight: value });
    }
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  commitStyleChange(id, field, before, after) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        this.setStyleField(id, field, before);
      },
      redo: () => {
        this.setStyleField(id, field, after);
      }
    });
  }

  toggleVisibility(id) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    entry.itemVisible = entry.itemVisible === false ? true : false;
    this.callbacks.onChange && this.callbacks.onChange();
  }

  setMetadata(id, key, value) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    const before = entry.metadata[key];
    entry.metadata[key] = value;

    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        entry.metadata[key] = before;
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
      redo: () => {
        entry.metadata[key] = value;
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
    });
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  deletePolygon(id, skipHistory) {
    const entry = this.polygons.get(id);
    if (!entry) return;

    // Save map order for undo to ensure array indices stay synced
    const mapKeys = Array.from(this.polygons.keys());

    const path = entry.gPolygon.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
    const { name, category } = entry;
    entry.gPolygon.setMap(null);
    this.polygons.delete(id);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.callbacks.onSelect && this.callbacks.onSelect(null, null);
    }



    if (!skipHistory) {
      this.callbacks.pushHistory && this.callbacks.pushHistory({
        undo: () => {
          // 1. restore the deleted polygon
          this.loadPolygon({ id, name, category, path, layerId: entry.layerId, color: entry.color, fillOpacity: entry.fillOpacity, strokeWeight: entry.strokeWeight, metadata: entry.metadata });


          // 3. restore original Map insertion order
          const restoredMap = new Map();
          for (const k of mapKeys) {
            if (this.polygons.has(k)) {
              restoredMap.set(k, this.polygons.get(k));
            }
          }
          this.polygons = restoredMap;

          this.callbacks.onChange && this.callbacks.onChange();
          if (this.selectedId) {
            const sel = this.polygons.get(this.selectedId);
            if (sel) this.callbacks.onSelect && this.callbacks.onSelect({ ...sel });
          }
        },
        redo: () => {
          this.deletePolygon(id, true);
        },
      });
    }
    this.callbacks.onChange && this.callbacks.onChange();
    if (this.selectedId) {
      const sel = this.polygons.get(this.selectedId);
      if (sel) this.callbacks.onSelect && this.callbacks.onSelect({ ...sel });
    }
  }

  metrics(id) {
    const entry = this.polygons.get(id);
    if (!entry) return null;
    const path = entry.gPolygon.getPath().getArray();
    return { area: polygonArea(path), perimeter: polygonPerimeter(path) };
  }

  reorder(draggedId, targetId) {
    if (draggedId === targetId) return;
    const draggedEntry = this.polygons.get(draggedId);
    const targetEntry = this.polygons.get(targetId);
    if (!draggedEntry || !targetEntry) return;

    const sameLayer = draggedEntry.layerId === targetEntry.layerId;
    const bothLandmarks = draggedEntry.category === 'landmark' && targetEntry.category === 'landmark';

    if (!sameLayer && !bothLandmarks) return;

    const keys = Array.from(this.polygons.keys());
    const draggedIdx = keys.indexOf(draggedId);
    const targetIdx = keys.indexOf(targetId);

    if (draggedIdx === -1 || targetIdx === -1) return;

    keys.splice(draggedIdx, 1);
    const newTargetIdx = keys.indexOf(targetId);

    // Insert after the target if dragging down, before if dragging up
    if (draggedIdx < targetIdx) {
      keys.splice(newTargetIdx + 1, 0, draggedId);
    } else {
      keys.splice(newTargetIdx, 0, draggedId);
    }

    const newMap = new Map();
    for (const key of keys) {
      newMap.set(key, this.polygons.get(key));
    }
    this.polygons = newMap;

    // Adjust zIndex to reflect new order
    // Reverse iterate so top items get higher z-indexes
    let zIdxCounter = 0;
    for (const entry of this.polygons.values()) {
      const base = this.getBaseZIndex(entry.category);
      entry.gPolygon.setOptions({ zIndex: base + (++zIdxCounter) });
    }
    this.zCounter = Math.max(this.zCounter, zIdxCounter);

    this.callbacks.onChange && this.callbacks.onChange();
  }

  // Real, exact geo-coordinates of every vertex actually plotted — straight
  // off the live google.maps.Polygon path, not derived/estimated.
  getCoords(id) {
    const entry = this.polygons.get(id);
    if (!entry) return [];
    return entry.gPolygon.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  }

  // Formats vertices as a named key/value pair — "<Polygon Name>": [ {lat,lng}, ... ],
  // matching the plain-JS-literal convention used across other map projects.
  getCoordsText(id) {
    const entry = this.polygons.get(id);
    const coords = this.getCoords(id);
    const lines = coords.map((p) => `    { lat: ${p.lat}, lng: ${p.lng} },`);
    const key = JSON.stringify(entry?.name ?? 'polygon');
    return `${key}: [\n${lines.join('\n')}\n  ],`;
  }

  getState() {
    const all = Array.from(this.polygons.values()).map((entry) => ({
      id: entry.id,
      name: entry.name,
      category: entry.category || 'project',
      layerId: entry.layerId || 'layer-1',
      color: entry.color,
      fillOpacity: entry.fillOpacity,
      strokeWeight: entry.strokeWeight,
      path: entry.gPolygon.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
      metadata: entry.metadata || {},
      visible: entry.itemVisible !== false
    }));
    return {
      polygons: all.filter(p => p.category !== 'road' && p.category !== 'bridge'),
      roads: all.filter(p => p.category === 'road' || p.category === 'bridge').map(r => ({
        ...r,
        points: r.path,
        lineColor: r.color,
        lineWidth: r.strokeWeight
      })).map(({ path, color, strokeWeight, ...rest }) => rest)
    };
  }

  clearAll() {
    this.polygons.forEach((entry) => entry.gPolygon.setMap(null));
    this.polygons.clear();
    this.deselect();
  }
}
