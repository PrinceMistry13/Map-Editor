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
    this.zCounter = 10;
    this.selectedId = null;
    this.isEditing = false;
  }

  // ---------------------------------------------------------------- lifecycle
  createPolygon(id, name, path, category = 'project', layerId = 'layer-1', color = null) {
    const defaultColor = category === 'landmark' ? '#a855f7' : '#00d4ff';
    const finalColor = color || defaultColor;
    const gPolygon = new window.google.maps.Polygon({
      map: this.map,
      paths: path,
      strokeColor: finalColor,
      strokeWeight: 2,
      fillColor: finalColor,
      fillOpacity: 0.12,
      editable: false,
      clickable: true,
      zIndex: ++this.zCounter,
    });
    const entry = { id, name, category, layerId, color: finalColor, gPolygon };
    this.polygons.set(id, entry);

    let pathSnapshotBefore = null;
    const pathObj = gPolygon.getPath();
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
      pathSnapshotBefore = pathObj.getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
    });

    // Clicking an already-placed (non-editable) polygon re-selects it and
    // brings back its properties popup, so the user can re-enter edit mode.
    gPolygon.addListener('click', (e) => {
      e.domEvent && e.domEvent.stopPropagation();
      gPolygon.setOptions({ zIndex: ++this.zCounter });
      this.select(id, e.latLng ? e.latLng.toJSON() : null);
    });
    return entry;
  }

  loadPolygon(data) {
    const path = data.path.map((p) => new window.google.maps.LatLng(p.lat, p.lng));
    this.createPolygon(data.id, data.name, path, data.category || 'project', data.layerId || 'layer-1', data.color);
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
    this.callbacks.onEditToggle && this.callbacks.onEditToggle(null, false);
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
        this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
      redo: () => {
        entry.name = name;
        this.callbacks.onChange && this.callbacks.onChange();
        this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
    });
    this.callbacks.onChange && this.callbacks.onChange();
    // IMPORTANT: no latLng arg here. Passing one was wiping the popup
    // position on every keystroke, making the rename box "pop off" while typing.
    this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  // 'landmark' | 'project' — lets the user classify a boundary after the fact,
  // same as the naming popup asks when the polygon is first closed.
  setCategory(id, category) {
    const entry = this.polygons.get(id);
    if (!entry) return;
    const before = entry.category;
    entry.category = category;

    const applyColor = (cat) => {
      const color = cat === 'landmark' ? '#a855f7' : '#00d4ff';
      entry.gPolygon.setOptions({ strokeColor: color, fillColor: color });
    };
    applyColor(category);

    this.callbacks.pushHistory && this.callbacks.pushHistory({
      undo: () => {
        entry.category = before;
        applyColor(before);
        this.callbacks.onChange && this.callbacks.onChange();
        this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
      redo: () => {
        entry.category = category;
        applyColor(category);
        this.callbacks.onChange && this.callbacks.onChange();
        this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
      },
    });
    this.callbacks.onChange && this.callbacks.onChange();
    this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
  }

  deletePolygon(id, skipHistory) {
    const entry = this.polygons.get(id);
    if (!entry) return;
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
        undo: () => { this.loadPolygon({ id, name, category, path, layerId: entry.layerId, color: entry.color }); },
        redo: () => { this.deletePolygon(id, true); },
      });
    }
    this.callbacks.onChange && this.callbacks.onChange();
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
      path: entry.gPolygon.getPath().getArray().map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
    }));
  }

  clearAll() {
    this.polygons.forEach((entry) => entry.gPolygon.setMap(null));
    this.polygons.clear();
    this.deselect();
  }
}
