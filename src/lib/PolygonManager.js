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
  }

  getBaseZIndex(category) {
    if (category === 'project') return 10000;
    if (category === 'landmark') return 20000;
    if (category === 'unit') return 30000;
    if (category === 'pending-unit') return 40000;
    return 10000;
  }

  // ---------------------------------------------------------------- lifecycle
  createPolygon(id, name, path, category = 'project', layerId = 'layer-1', color = null, metadata = {}, entryData = {}) {
    let defaultColor = '#00d4ff';
    if (category === 'unit' || category === 'pending-unit') defaultColor = '#ff6b6b';
    else if (category === 'landmark') defaultColor = '#00CED1';

    const finalColor = color || defaultColor;
    const gPolygon = new window.google.maps.Polygon({
      map: this.map,
      paths: path,
      strokeColor: finalColor,
      strokeWeight: entryData.strokeWeight ?? 2,
      fillColor: finalColor,
      fillOpacity: entryData.fillOpacity ?? 0.12,
      strokePosition: window.google.maps.StrokePosition.INSIDE,
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
      const currentCategory = this.polygons.get(id)?.category || 'project';
      gPolygon.setOptions({ zIndex: this.getBaseZIndex(currentCategory) + (++this.zCounter) });
      this.select(id, e.latLng ? e.latLng.toJSON() : null);
    });

    const trackHover = (e) => {
      if (!this.isEditing || this.selectedId !== id) return;
      const path = gPolygon.getPath();
      let minDist = Infinity;
      let closestIdx = null;

      if (e.latLng && window.google?.maps?.geometry?.spherical) {
        const zoom = this.map.getZoom();
        const lat = e.latLng.lat();
        // Meters per pixel at current latitude and zoom
        const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
        // We want a threshold of ~25 pixels
        const thresholdMeters = 25 * metersPerPx;

        path.forEach((latLng, i) => {
          const distMeters = window.google.maps.geometry.spherical.computeDistanceBetween(e.latLng, latLng);
          if (distMeters < thresholdMeters && distMeters < minDist) {
            minDist = distMeters;
            closestIdx = i;
          }
        });
      }
      this.hoveredVertexIndex = closestIdx;
    };

    gPolygon.addListener('mousemove', (e) => {
      if (this.callbacks.getActiveTool && this.callbacks.getActiveTool() !== null) {
        window.google.maps.event.trigger(this.map, 'mousemove', e);
      }
      trackHover(e);
    });

    this.map.addListener('mousemove', trackHover);

    return entry;
  }

  loadPolygon(data) {
    const path = data.path.map((p) => new window.google.maps.LatLng(p.lat, p.lng));
    this.createPolygon(data.id, data.name, path, data.category || 'project', data.layerId || 'layer-1', data.color, data.metadata || {}, { fillOpacity: data.fillOpacity, strokeWeight: data.strokeWeight, visible: data.visible });
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
      entry.gPolygon.setOptions({ strokeColor: '#ffb020', fillColor: '#ffb020' });
      this.isEditing = true;
      this.callbacks.onEditToggle && this.callbacks.onEditToggle(entry, true);
    }
  }

  exitEditMode() {
    if (this.selectedId) {
      const entry = this.polygons.get(this.selectedId);
      if (entry) {
        entry.gPolygon.setEditable(false);
        entry.gPolygon.setOptions({ strokeColor: entry.color, fillColor: entry.color });
      }
    }
    this.isEditing = false;
    this.hoveredVertexIndex = null;
    this.callbacks.onEditToggle && this.callbacks.onEditToggle(null, false);
  }

  handleDeleteKey(e) {
    if (!this.isEditing || this.hoveredVertexIndex === null) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const entry = this.polygons.get(this.selectedId);
    if (!entry) return;

    const path = entry.gPolygon.getPath();
    if (path.getLength() <= 3) {
      alert('A polygon must have at least 3 vertices.');
      return;
    }

    // Take snapshot manually before keyboard deletion so undo/redo has the correct 'before' state
    if (entry.takeSnapshot) entry.takeSnapshot();

    path.removeAt(this.hoveredVertexIndex);
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
        if (cat === 'landmark') color = '#00CED1';
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

    let newName = beforeName;
    if (category === 'unit' && beforeCat !== 'unit') {
      const unitCount = Array.from(this.polygons.values()).filter(p => p.category === 'unit' || p.category === 'pending-unit').length;
      newName = `Unit ${unitCount + 1}`;
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
    return Array.from(this.polygons.values()).map((entry) => ({
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
  }

  clearAll() {
    this.polygons.forEach((entry) => entry.gPolygon.setMap(null));
    this.polygons.clear();
    this.deselect();
  }
}
