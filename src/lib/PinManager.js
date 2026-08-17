import { nextId } from '../context/WorkspaceContext';

export default class PinManager {
    constructor(map, callbacks = {}) {
        this.map = map;
        this.callbacks = callbacks; // { onSelect(entry, latLng), onEditToggle, onChange(), pushHistory({undo,redo}) }
        this.pins = new Map(); // id -> { id, name, color, styleMode, imageDataUrl, category, landmarkType, marker }
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
            this.createPin(id, `Pin ${this.pins.size + 1}`, this._defaultColor, position, 'default', null, this._layerId, this._metadata, 'project', null);
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => this.deletePin(id, true),
                redo: () => this.createPin(id, `Pin ${this.pins.size + 1}`, this._defaultColor, position, 'default', null, this._layerId, this._metadata, 'project', null),
            });
            this.callbacks.onChange && this.callbacks.onChange();
            this.select(id, position);
            this.callbacks.onPinPlaced && this.callbacks.onPinPlaced();
        });
    }

    disarmPlacement() {
        if (!this.armed) return;
        this.armed = false;
        this.map.setOptions({ draggableCursor: null });
        if (this._clickListener) window.google.maps.event.removeListener(this._clickListener);
    }

    // ---------------------------------------------------------------- lifecycle
    createPin(id, name, color, position, styleMode = 'default', imageDataUrl = null, layerId = 'layer-1', metadata = {}, category = 'project', landmarkType = null) {
        const marker = new window.google.maps.Marker({
            position, 
            map: this.map, 
            draggable: true,
            zIndex: 100,
            icon: pinSvgIcon(color, styleMode === 'custom' ? imageDataUrl : null, category, landmarkType),
        });
        const entry = { id, name, color, position, styleMode, imageDataUrl, layerId, category, landmarkType, marker, itemVisible: true, metadata };
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
            entry.position = after;
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => { marker.setPosition(dragBefore); entry.position = dragBefore; if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, dragBefore); },
                redo: () => { marker.setPosition(after); entry.position = after; if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, after); },
            });
            this.callbacks.onChange && this.callbacks.onChange();
            // Reposition popup to the new spot AND refresh coords readout.
            if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }, after);
        });

        return entry;
    }

    loadPin(data) {
        if (!data.id) data.id = nextId('pin');
        const entry = this.createPin(data.id, data.name, data.color, data.position, data.styleMode, data.imageDataUrl, data.layerId || 'layer-1', data.metadata || {}, data.category || 'project', data.landmarkType || null);
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
        entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));
        this.callbacks.pushHistory && this.callbacks.pushHistory({
            undo: () => { entry.color = before; entry.marker.setIcon(pinSvgIcon(before, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType)); this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
            redo: () => { entry.color = color; entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType)); this.callbacks.onChange && this.callbacks.onChange(); if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry }); },
        });
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    setUniformColor(id, color) {
        const entry = this.pins.get(id);
        if (!entry) return;
        if (!entry.originalColor) entry.originalColor = entry.color;
        entry.color = color;
        entry.marker.setIcon(pinSvgIcon(color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));
        this.callbacks.onChange && this.callbacks.onChange();
        if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
    }

    restoreOriginalColor(id) {
        const entry = this.pins.get(id);
        if (!entry || !entry.originalColor) return;
        entry.color = entry.originalColor;
        entry.marker.setIcon(pinSvgIcon(entry.color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));
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
        
        const updateIcon = (mode, img) => entry.marker.setIcon(pinSvgIcon(entry.color, mode === 'custom' ? img : null, entry.category, entry.landmarkType));
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

    setCategory(id, category, landmarkType, newLayerId) {
        const entry = this.pins.get(id);
        if (!entry) return;
        const beforeCat = entry.category;
        const beforeType = entry.landmarkType;
        const beforeLayer = entry.layerId;
        
        entry.category = category;
        if (landmarkType !== undefined) entry.landmarkType = landmarkType;
        if (newLayerId !== undefined) entry.layerId = newLayerId;

        entry.marker.setIcon(pinSvgIcon(entry.color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));

        this.callbacks.pushHistory && this.callbacks.pushHistory({
            undo: () => {
                entry.category = beforeCat;
                entry.landmarkType = beforeType;
                entry.layerId = beforeLayer;
                entry.marker.setIcon(pinSvgIcon(entry.color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));
                this.callbacks.onChange && this.callbacks.onChange();
                if (this.selectedId === id) this.callbacks.onSelect && this.callbacks.onSelect({ ...entry });
            },
            redo: () => {
                entry.category = category;
                if (landmarkType !== undefined) entry.landmarkType = landmarkType;
                if (newLayerId !== undefined) entry.layerId = newLayerId;
                entry.marker.setIcon(pinSvgIcon(entry.color, entry.styleMode === 'custom' ? entry.imageDataUrl : null, entry.category, entry.landmarkType));
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
        const { name, color, styleMode, imageDataUrl, layerId, category, landmarkType } = entry;
        entry.marker.setMap(null);
        this.pins.delete(id);
        if (this.selectedId === id) {
            this.selectedId = null;
            this.callbacks.onSelect && this.callbacks.onSelect(null, null);
        }
        if (!skipHistory) {
            this.callbacks.pushHistory && this.callbacks.pushHistory({
                undo: () => this.loadPin({ id, name, color, position, styleMode, imageDataUrl, layerId, metadata: entry.metadata, category, landmarkType }),
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
        if (!p) return '';
        const lat = p.lat.toFixed(5);
        const lng = p.lng.toFixed(5);
        return `${lat}, ${lng}`;
    }

    getState() {
        return Array.from(this.pins.values()).map((entry) => ({
            id: entry.id, name: entry.name, color: entry.color,
            styleMode: entry.styleMode || 'default',
            imageDataUrl: entry.imageDataUrl,
            layerId: entry.layerId || 'layer-1',
            category: entry.category || 'project',
            landmarkType: entry.landmarkType || null,
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

function pinSvgIcon(color, imageDataUrl, category = 'project', landmarkType = null) {
    if (category === 'landmark' && landmarkType) {
        // Simple distinct line-style icons for each landmark type
        const icons = {
            'brts': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M4 16c0 .88.39 1.67 1 2.22V20c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h8v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1.78c.61-.55 1-1.34 1-2.22V6c0-3.5-3.58-4-8-4s-8 .5-8 4v10zm3.5 1c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"/></g>',
            'metro': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><circle cx="15.5" cy="16" r="1"/><circle cx="8.5" cy="16" r="1"/><path d="M7.01 9h10v5h-10zM17.8 2.8C16 2.09 13.86 2 12 2c-1.86 0-4 .09-5.8.8C3.53 3.84 2 6.05 2 8.86V22h20V8.86c0-2.81-1.53-5.02-4.2-6.06zm.2 13.08c0 1.45-1.18 2.62-2.63 2.62l1.13 1.12V20H15l-1.5-1.5h-2.83L9.17 20H7.5v-.38l1.12-1.12C7.18 18.5 6 17.32 6 15.88V9c0-2.63 3-3 6-3 3.32 0 6 .38 6 3v6.88z"/></g>',
            'railway': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></g>',
            'roads': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M20 18v-3h-2v3h-3v2h3v3h2v-3h3v-2zM18 4h2v9h-2zM4 4h2v16H4zm7 0h2v4h-2zm0 6h2v4h-2zm0 6h2v4h-2z"/></g>',
            'bridges': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M6.36 18.78 6.61 21l1.62-1.54 2.77-7.6c-.68-.17-1.28-.51-1.77-.98l-2.87 7.9zm8.41-7.9c-.49.47-1.1.81-1.77.98l2.77 7.6L17.39 21l.26-2.22-2.88-7.9zM15 8c0-1.3-.84-2.4-2-2.82V3h-2v2.18C9.84 5.6 9 6.7 9 8c0 1.66 1.34 3 3 3s3-1.34 3-3zm-3 1c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z"/></g>',
            'circle': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10 10-4.49 10-10S17.51 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-8c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3z"/></g>',
            'school': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3 1 9l11 6 9-4.91V17h2V9L12 3z"/></g>',
            'college': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M4 10h3v7H4zm6.5 0h3v7h-3zM2 19h20v3H2zm15-9h3v7h-3zm-5-9L2 6v2h20V6z"/></g>',
            'hospital': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M19 3H5c-1.1 0-1.99.9-1.99 2L3 19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-1 11h-4v4h-4v-4H6v-4h4V6h4v4h4v4z"/></g>',
            'grocery': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1.003 1.003 0 0 0 20 4H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></g>',
            'garden': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M17 12h2L12 2 5.05 12H7l-3.9 6h6.92v4h3.96v-4H21z"/></g>',
            'lake': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M21.98 14H22h-.02zM5.35 13c1.19 0 1.42 1 3.33 1 1.95 0 2.09-1 3.33-1 1.19 0 1.42 1 3.33 1 1.95 0 2.09-1 3.33-1 1.19 0 1.4.98 3.31 1v-2c-1.19 0-1.42-1-3.33-1-1.95 0-2.09 1-3.33 1-1.19 0-1.42-1-3.33-1-1.95 0-2.09 1-3.33 1-1.19 0-1.42-1-3.33-1-1.95 0-2.09 1-3.33 1v2c1.9 0 2.17-1 3.35-1zm13.32 2c-1.95 0-2.09 1-3.33 1-1.19 0-1.42-1-3.33-1-1.95 0-2.1 1-3.34 1-1.24 0-1.38-1-3.33-1-1.95 0-2.1 1-3.34 1v2c1.95 0 2.11-1 3.34-1 1.24 0 1.38 1 3.33 1 1.95 0 2.1-1 3.34-1 1.19 0 1.42 1 3.33 1 1.94 0 2.09-1 3.33-1 1.19 0 1.42 1 3.33 1v-2c-1.24 0-1.38-1-3.33-1zM5.35 9c1.19 0 1.42 1 3.33 1 1.95 0 2.09-1 3.33-1 1.19 0 1.42 1 3.33 1 1.95 0 2.09-1 3.33-1 1.19 0 1.4.98 3.31 1V8c-1.19 0-1.42-1-3.33-1-1.95 0-2.09 1-3.33 1-1.19 0-1.42-1-3.33-1-1.95 0-2.09 1-3.33 1-1.19 0-1.42-1-3.33-1C3.38 7 3.24 8 2 8v2c1.9 0 2.17-1 3.35-1z"/></g>',
            'temple': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M6.6 11h10.8l-.9-3h-9zM20 11v2H4v-2H2v11h8v-5h4v5h8V11zm-4.1-5L15 3V1h-2v2h-2.03V1h-2v2.12L8.1 6z"/></g>',
            'multiplex': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M18 3v2h-2V3H8v2H6V3H4v18h2v-2h2v2h8v-2h2v2h2V3h-2zM8 17H6v-2h2v2zm0-4H6v-2h2v2zm0-4H6V7h2v2zm10 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V7h2v2z"/></g>',
            'police': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm2.5 11.59.9 3.88-3.4-2.05-3.4 2.05.9-3.87-3-2.59 3.96-.34L12 6.02l1.54 3.64 3.96.34-3 2.59z"/></g>',
            'textile': '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M21.6 18.2 13 11.75v-.91a3.496 3.496 0 0 0-.18-6.75A3.51 3.51 0 0 0 8.5 7.5h2c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5c0 .84-.69 1.52-1.53 1.5-.54-.01-.97.45-.97.99v1.76L2.4 18.2c-.77.58-.36 1.8.6 1.8h18c.96 0 1.37-1.22.6-1.8zM6 18l6-4.5 6 4.5H6z"/></g>'
        };
        const defaultIcon = '<g transform="translate(4.8, 3.8) scale(0.6)" fill="currentColor"><path d="M12 2C6.49 2 2 6.49 2 12s4.49 10 10 10 10-4.49 10-10S17.51 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3-8c0 1.66-1.34 3-3 3s-3-1.34-3-3 1.34-3 3-3 3 1.34 3 3z"/></g>';
        const innerIcon = icons[landmarkType] || defaultIcon;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="38" viewBox="0 0 24 30">
    <path d="M12 0C6 0 1 5 1 11c0 8 11 19 11 19s11-11 11-19C23 5 18 0 12 0z" fill="${color}" stroke="#0a0e13" stroke-width="1.2"/>
    <g transform="translate(0, 0)" color="#0a0e13">
      ${innerIcon}
    </g>
  </svg>`;
        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new window.google.maps.Size(30, 38),
            anchor: new window.google.maps.Point(15, 36),
        };
    } else if (imageDataUrl) {
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