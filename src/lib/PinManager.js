import { nextId } from '../context/WorkspaceContext';

export default class PinManager {
    constructor(map, callbacks = {}) {
        this.map = map;
        this.callbacks = callbacks; // { onSelect(entry, latLng), onEditToggle, onChange(), pushHistory({undo,redo}) }
        this.pins = new Map(); // id -> { id, name, color, styleMode, imageDataUrl, marker }
        this.armed = false;
        this.selectedId = null;
        this.isEditing = false;
        this._clickListener = null;
    }

    // ---------------------------------------------------------------- placement
    armPlacement(defaultColor = '#00CED1', layerId = 'layer-1', metadata = {}) {
        if (this.armed) return;
        this.armed = true;
        this._defaultColor = defaultColor;
        this._layerId = layerId;
        this._metadata = metadata;
        this.map.setOptions({ draggableCursor: 'copy' });
        this._clickListener = this.map.addListener('click', (e) => {
            const id = nextId('pin');
            const position = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            this.createPin(id, `Pin ${this.pins.size + 1}`, this._defaultColor, position, 'default', null, this._layerId, this._metadata);
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => this.deletePin(id, true),
                redo: () => this.createPin(id, `Pin ${this.pins.size + 1}`, this._defaultColor, position, 'default', null, this._layerId),
            });
            this.callbacks.onChange && this.callbacks.onChange();
            this.select(id, position);
        });
    }

    disarmPlacement() {
        if (!this.armed) return;
        this.armed = false;
        this.map.setOptions({ draggableCursor: null });
        if (this._clickListener) window.google.maps.event.removeListener(this._clickListener);
    }

    // ---------------------------------------------------------------- lifecycle
    createPin(id, name, color, position, styleMode = 'default', imageDataUrl = null, layerId = 'layer-1', metadata = {}) {
        const marker = new window.google.maps.Marker({
            position, 
            map: this.map, 
            draggable: true,
            zIndex: 100,
            icon: pinSvgIcon(color, styleMode === 'custom' ? imageDataUrl : null),
        });
        const entry = { id, name, color, position, styleMode, imageDataUrl, layerId, marker, itemVisible: true, metadata };
        this.pins.set(id, entry);

        marker.addListener('click', (e) => {
            if (this.callbacks.getActiveTool && this.callbacks.getActiveTool() !== null) {
                window.google.maps.event.trigger(this.map, 'click', e);
                return;
            }
            e.domEvent && e.domEvent.stopPropagation();
            this.exitEditMode();
            this.select(id, marker.getPosition().toJSON());
        });

        let dragBefore = null;
        marker.addListener('dragstart', () => { dragBefore = marker.getPosition().toJSON(); });
        marker.addListener('dragend', () => {
            // Exact geo-coord fetched straight off the marker after drop.
            const after = marker.getPosition().toJSON();
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => { marker.setPosition(dragBefore); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, dragBefore); },
                redo: () => { marker.setPosition(after); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, after); },
            });
            this.callbacks.onChange && this.callbacks.onChange();
            // Reposition popup to the new spot AND refresh coords readout.
            if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, after);
        });

        return entry;
    }

    loadPin(data) {
        if (!data.id) data.id = nextId('pin');
        const entry = this.createPin(data.id, data.name, data.color, data.position, data.styleMode, data.imageDataUrl, data.layerId || 'layer-1', data.metadata || {});
        if (data.visible === false) {
            entry.itemVisible = false;
        }
    }

    loadAll(pinsData = []) {
        this.clearAll();
        pinsData.forEach((data) => this.loadPin(data));
    }

    select(id, latLng = null) {
        this.selectedId = id;
        const entry = this.pins.get(id);
        if (entry) {
            const popupPos = latLng || entry.marker.getPosition().toJSON();
            this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, popupPos);
        }
    }

    deselect() {
        this.exitEditMode();
        this.selectedId = null;
        this.callbacks.onSelect && this.callbacks.onSelect(null, null);
    }

    enterEditMode(id) {
        const entry = this.pins.get(id);
        if (entry) {
            entry.marker.setDraggable(true);
            this.isEditing = true;
            this.callbacks.onEditToggle && this.callbacks.onEditToggle(entry, true);
        }
    }

    exitEditMode() {
        if (this.selectedId) {
            const entry = this.pins.get(this.selectedId);
            if (entry) entry.marker.setDraggable(false);
        }
        this.isEditing = false;
        this.callbacks.onEditToggle && this.callbacks.onEditToggle(null, false);
    }

    rename(id, name) {
        const entry = this.pins.get(id);
        if (!entry) return;
        const before = entry.name;
        entry.name = name;
        this.callbacks.pushHistory && this.callbacks.pushHistory({
            undo: () => { entry.name = before; this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
            redo: () => { entry.name = name; this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
        });
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    setColor(id, color) {
        const entry = this.pins.get(id);
        if (!entry) return;
        const before = entry.color;
        entry.color = color;
        entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null));
        this.callbacks.pushHistory && this.callbacks.pushHistory({
            undo: () => { entry.color = before; entry.marker.setIcon(pinSvgIcon(before, entry.styleMode === 'custom' ? entry.imageDataUrl : null)); this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
            redo: () => { entry.color = color; entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null)); this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
        });
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    setUniformColor(id, color) {
        const entry = this.pins.get(id);
        if (!entry) return;
        if (!entry.originalColor) entry.originalColor = entry.color;
        entry.color = color;
        entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null));
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    restoreOriginalColor(id) {
        const entry = this.pins.get(id);
        if (!entry || !entry.originalColor) return;
        entry.color = entry.originalColor;
        entry.marker.setIcon(pinSvgIcon(entry.color, entry.styleMode === 'custom' ? entry.imageDataUrl : null));
        entry.originalColor = null;
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    setStyle(id, styleMode, imageDataUrl) {
        const entry = this.pins.get(id);
        if (!entry) return;
        const beforeStyle = entry.styleMode;
        const beforeImg = entry.imageDataUrl;
        
        entry.styleMode = styleMode;
        if (imageDataUrl !== undefined) entry.imageDataUrl = imageDataUrl;
        
        const updateIcon = (mode, img) => entry.marker.setIcon(pinSvgIcon(entry.color, mode === 'custom' ? img : null));
        updateIcon(styleMode, entry.imageDataUrl);

        this.callbacks.pushHistory && this.callbacks.pushHistory({
            undo: () => {
                entry.styleMode = beforeStyle;
                entry.imageDataUrl = beforeImg;
                updateIcon(beforeStyle, beforeImg);
                this.callbacks.onChange && this.callbacks.onChange();
                if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
            },
            redo: () => {
                entry.styleMode = styleMode;
                if (imageDataUrl !== undefined) entry.imageDataUrl = imageDataUrl;
                updateIcon(styleMode, entry.imageDataUrl);
                this.callbacks.onChange && this.callbacks.onChange();
                if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
            },
        });
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    deletePin(id, skipHistory) {
        const entry = this.pins.get(id);
        if (!entry) return;
        const position = entry.marker.getPosition().toJSON();
        const { name, color, styleMode, imageDataUrl, layerId } = entry;
        entry.marker.setMap(null);
        this.pins.delete(id);
        if (this.selectedId === id) {
            this.selectedId = null;
            this.callbacks.onSelect && this.callbacks.onSelect(null, null);
        }
        if (!skipHistory) {
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => this.loadPin({ id, name, color, position, styleMode, imageDataUrl, layerId, metadata: entry.metadata }),
                redo: () => this.deletePin(id, true),
            });
        }
        this.callbacks.onChange && this.callbacks.onChange();
    }

    toggleVisibility(id) {
        const entry = this.pins.get(id);
        if (!entry) return;
        entry.itemVisible = entry.itemVisible === false ? true : false;
        this.callbacks.onChange && this.callbacks.onChange();
    }

    reorder(draggedId, targetId) {
        if (draggedId === targetId) return;
        const draggedEntry = this.pins.get(draggedId);
        const targetEntry = this.pins.get(targetId);
        if (!draggedEntry || !targetEntry) return;

        if (draggedEntry.layerId !== targetEntry.layerId) return;

        const keys = Array.from(this.pins.keys());
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
            newMap.set(key, this.pins.get(key));
        }
        this.pins = newMap;
        
        let zIdxCounter = 100;
        for (const entry of this.pins.values()) {
            entry.marker.setOptions({ zIndex: ++zIdxCounter });
        }

        this.callbacks.onChange && this.callbacks.onChange();
    }

    // Real, exact geo-coord straight off the live marker — not derived/estimated.
    getCoords(id) {
        const entry = this.pins.get(id);
        return entry ? entry.marker.getPosition().toJSON() : null;
    }

    getCoordsText(id) {
        const p = this.getCoords(id);
        return p ? `{ lat: ${p.lat}, lng: ${p.lng} }` : '{}';
    }

    getState() {
        return Array.from(this.pins.values()).map((entry) => ({
            id: entry.id, name: entry.name, color: entry.color,
            styleMode: entry.styleMode || 'default',
            imageDataUrl: entry.imageDataUrl,
            layerId: entry.layerId || 'layer-1',
            position: entry.marker.getPosition().toJSON(),
            metadata: entry.metadata || {},
            visible: entry.itemVisible !== false
        }));
    }

    clearAll() {
        this.pins.forEach((entry) => entry.marker.setMap(null));
        this.pins.clear();
        this.deselect();
    }
}

function pinSvgIcon(color, imageDataUrl) {
    if (imageDataUrl) {
        const clipId = 'cp-' + Math.random().toString(36).substr(2, 6);
        const customPath = "M 8 0 H 52 A 8 8 0 0 1 60 8 V 32 A 8 8 0 0 1 52 40 H 35 L 30 50 L 25 40 H 8 A 8 8 0 0 1 0 32 V 8 A 8 8 0 0 1 8 0 Z";
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="66" height="56" viewBox="-3 -3 66 56">
    <defs>
      <clipPath id="${clipId}">
        <path d="${customPath}" />
      </clipPath>
    </defs>
    <path d="${customPath}" fill="#ffffff" />
    <image x="0" y="0" width="60" height="50" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})" href="${imageDataUrl}" />
    <path d="${customPath}" fill="none" stroke="${color}" stroke-width="4"/>
  </svg>`;
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(66, 56),
            anchor: new window.google.maps.Point(33, 53),
        };
    } else {
        const defaultPath = "M12 0C6 0 1 5 1 11c0 8 11 19 11 19s11-11 11-19C23 5 18 0 12 0z";
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 24 30">
    <path d="${defaultPath}" fill="${color}" stroke="#0a0e13" stroke-width="1.2"/>
    <circle cx="12" cy="11" r="4.2" fill="#0a0e13"/>
  </svg>`;
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(30, 38),
            anchor: new window.google.maps.Point(15, 36),
        };
    }
}