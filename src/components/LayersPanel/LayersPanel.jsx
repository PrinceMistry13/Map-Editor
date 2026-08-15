import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { focusOnBounds } from '../MapWorkspace/MapWorkspace';
import ColorPickerPopover from '../common/ColorPickerPopover';
import './LayersPanel.css';

// Icons
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const PaintBrushIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
    <path d="M10.5 13.5l-4.5 4.5c-2.5 2.5-1 5 1.5 5h1a4 4 0 0 0 4-4v-1.5"></path>
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
);

const PencilIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
  </svg>
);

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="1"></circle>
    <circle cx="12" cy="5" r="1"></circle>
    <circle cx="12" cy="19" r="1"></circle>
  </svg>
);

const GripIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="12" r="1"></circle>
    <circle cx="9" cy="5" r="1"></circle>
    <circle cx="9" cy="19" r="1"></circle>
    <circle cx="15" cy="12" r="1"></circle>
    <circle cx="15" cy="5" r="1"></circle>
    <circle cx="15" cy="19" r="1"></circle>
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

const PolygonIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <polygon points="12 3 20.5 8.5 17.5 19.5 6.5 19.5 3.5 8.5" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2C8.69 2 6 4.69 6 8c0 5 6 12 6 12s6-7 6-12c0-3.31-2.69-6-6-6z" />
    <circle cx="12" cy="8" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

const RoadIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20 C7 16 9 13 12 12 C15 11 17 8 20 4" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const FloorPlanIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="9" x2="9" y2="21" />
  </svg>
);

export default function LayersPanel({ tick = 0 }) {
  const {
    project,
    activeLayerId, setActiveLayerId,
    addLayer, deleteLayer, updateLayer, updateFolderSetting, toggleLayerVisibility, reorderLayers,
    polygonManagerRef, pinManagerRef, floorPlanManagerRef,
    getExportProject,
    selectedLayerItemId, setSelectedLayerItemId,
    selectedRoadEntry, setSelectedRoadEntry, setRoadPopupPos,
  } = useWorkspace();

  const [expandedLayers, setExpandedLayers] = useState({});
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [editingLayerId, setEditingLayerId] = useState(null);
  const [tempLayerName, setTempLayerName] = useState("");
  
  const replaceFileRef = useRef(null);
  const [replacingFloorPlanId, setReplacingFloorPlanId] = useState(null);

  const handleReplaceFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !replacingFloorPlanId) return;
    const url = URL.createObjectURL(file);
    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.replaceImage(replacingFloorPlanId, url).catch(err => console.error(err));
    }
    setReplacingFloorPlanId(null);
    e.target.value = '';
  };


  // Multi-select state
  const [multiSelectedIds, setMultiSelectedIds] = useState(new Set());
  const [lastClickedId, setLastClickedId] = useState(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleDocClick = () => { setMenuOpenId(null); };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    const willCollapse = expandedLayers[id];
    if (willCollapse) {
      if (selectedLayerItemId === id) {
        setSelectedLayerItemId(null);
      } else if (id.startsWith('folder-') && selectedLayerItemId === id.replace('folder-', 'plots-')) {
        setSelectedLayerItemId(null);
      }
    }
    setExpandedLayers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleMenuClick = (id, e) => {
    e.stopPropagation();
    setMenuOpenId(prev => (prev === id ? null : id));

  };

  const handleStyleMenuClick = (id, e) => {
    e.stopPropagation();

    setMenuOpenId(null);
  };

  const handleLayerClick = (id) => {
    setActiveLayerId(id);
    setSelectedLayerItemId(id);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this layer? All features in it will be removed.")) {
      // First delete features in this layer
      if (polygonManagerRef.current) {
        polygonManagerRef.current.getState().forEach(f => {
          if (f.layerId === id) polygonManagerRef.current.deletePolygon(f.id, true);
        });
      }
      if (pinManagerRef.current) {
        pinManagerRef.current.getState().forEach(f => {
          if (f.layerId === id) pinManagerRef.current.deletePin(f.id, true);
        });
      }
      if (floorPlanManagerRef.current) {
        floorPlanManagerRef.current.getState().forEach(f => {
          if (f.layerId === id) floorPlanManagerRef.current.delete(f.id);
        });
      }
      deleteLayer(id);
      setMenuOpenId(null);
    }
  };

  const handleExport = (layerId, e) => {
    e.stopPropagation();
    const data = getExportProject();
    const layerData = {
      ...data,
      layers: data.layers.filter(l => l.id === layerId),
      polygons: data.polygons.filter(p => p.layerId === layerId),
      pins: data.pins.filter(p => p.layerId === layerId),
      floorPlans: data.floorPlans.filter(p => p.layerId === layerId),
    };
    const blob = new Blob([JSON.stringify(layerData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `layer-${layerId}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpenId(null);
  };

  // Drag & drop sorting using refs to prevent re-renders breaking the drag
  const draggedIdRef = useRef(null);

  const handleDragStart = (e, id) => {
    e.stopPropagation();
    draggedIdRef.current = id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData('text/plain', id);
  };
  const handleDragOver = (e) => {
    e.preventDefault(); // allow drop
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = draggedIdRef.current;
    if (draggedId && draggedId !== targetId) {
      reorderLayers(draggedId, targetId);
    }
    draggedIdRef.current = null;
  };

  const draggedItemIdRef = useRef(null);
  const draggedItemTypeRef = useRef(null);

  const handleItemDragStart = (e, id, type) => {
    e.stopPropagation();
    draggedItemIdRef.current = id;
    draggedItemTypeRef.current = type;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData('text/plain', id);
  };
  const handleItemDrop = (e, targetId, targetType) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedItemId = draggedItemIdRef.current;
    const draggedItemType = draggedItemTypeRef.current;
    if (draggedItemId && draggedItemId !== targetId && draggedItemType === targetType) {
      if ((draggedItemType === 'polygon' || draggedItemType === 'road') && polygonManagerRef.current) {
        polygonManagerRef.current.reorder(draggedItemId, targetId);
      } else if (draggedItemType === 'pin' && pinManagerRef.current) {
        pinManagerRef.current.reorder(draggedItemId, targetId);
      } else if (draggedItemType === 'floorplan' && floorPlanManagerRef.current) {
        floorPlanManagerRef.current.reorder(draggedItemId, targetId);
      }
    }
    draggedItemIdRef.current = null;
    draggedItemTypeRef.current = null;
  };


  // Derive active items for selecting children
  const _pmRaw = polygonManagerRef.current?.getState();
  const pmState = _pmRaw ? (Array.isArray(_pmRaw) ? _pmRaw : [...(_pmRaw.polygons || []), ...(_pmRaw.roads || [])]) : [];
  const pnmState = pinManagerRef.current?.getState() || [];
  const fpState = floorPlanManagerRef.current?.getState() || [];

  const getLayerChildren = (layerId) => {
    // Roads are now considered Landmarks and bypass regular layer tree sorting
    const polys = pmState.filter(f => f.layerId === layerId && f.category !== 'landmark' && f.category !== 'road' && f.category !== 'bridge').map(f => ({ ...f, type: 'polygon' }));
    const pins = pnmState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'pin' }));
    const fps = fpState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'floorplan' }));
    return [...fps, ...polys, ...pins];
  };

  const layers = [...(project?.layers || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  // Flatten all children to support shift-click
  const allRenderedChildren = [];

  const landmarkPolys = pmState.filter(f => f.category === 'landmark' || f.category === 'road' || f.category === 'bridge').map(f => ({ ...f, type: (f.category === 'road' || f.category === 'bridge') ? 'road' : 'polygon' }));
  if (expandedLayers['landmarks']) {
    allRenderedChildren.push(...landmarkPolys);
  }

  layers.forEach(layer => {
    if (expandedLayers[layer.id]) {
      const children = getLayerChildren(layer.id);
      const fps = children.filter(c => c.type === 'floorplan');
      const rootPolys = children.filter(c => c.type === 'polygon' && !c.metadata?.floorPlanId);
      const pins = children.filter(c => c.type === 'pin');

      fps.forEach(fp => {
        if (expandedLayers[`folder-${fp.id}`]) {
          allRenderedChildren.push(fp);
          const boundaryPoly = children.find(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && c.category === 'project');
          if (boundaryPoly) allRenderedChildren.push(boundaryPoly);

          if (expandedLayers[`plots-${fp.id}`]) {
            const nestedPlots = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && (c.category === 'unit' || c.category === 'pending-unit'));
            nestedPlots.sort((a, b) => {
              const numA = parseInt(a.name, 10);
              const numB = parseInt(b.name, 10);
              const isNumA = !isNaN(numA) && numA.toString() === (a.name || '').trim();
              const isNumB = !isNaN(numB) && numB.toString() === (b.name || '').trim();
              if (isNumA && isNumB) return numA - numB;
              if (isNumA && !isNumB) return -1;
              if (!isNumA && isNumB) return 1;
              return (a.name || '').localeCompare(b.name || '');
            });
            allRenderedChildren.push(...nestedPlots);
          }
        }
      });
      allRenderedChildren.push(...rootPolys);
      allRenderedChildren.push(...pins);
    }
  });

  const handleChildClick = (e, layerId, child) => {
    e.stopPropagation();
    handleLayerClick(layerId);

    if (e.shiftKey && lastClickedId) {
      const idx1 = allRenderedChildren.findIndex(c => c.id === lastClickedId);
      const idx2 = allRenderedChildren.findIndex(c => c.id === child.id);
      if (idx1 !== -1 && idx2 !== -1) {
        const min = Math.min(idx1, idx2);
        const max = Math.max(idx1, idx2);
        const newSet = new Set(multiSelectedIds);
        for (let i = min; i <= max; i++) {
          newSet.add(allRenderedChildren[i].id);
        }
        setMultiSelectedIds(newSet);
      }
    } else if (e.metaKey || e.ctrlKey) {
      const newSet = new Set(multiSelectedIds);
      if (newSet.has(child.id)) newSet.delete(child.id);
      else newSet.add(child.id);
      setMultiSelectedIds(newSet);
      setLastClickedId(child.id);
      if (newSet.size === 1) selectChild(child); // focus if only 1
    } else {
      setMultiSelectedIds(new Set([child.id]));
      setLastClickedId(child.id);
      selectChild(child);
    }
  };

  const handleToggleVisibility = (e, child, isBulk = false) => {
    e.stopPropagation();

    if (isBulk === 'landmarks') {
      const landmarkPolys = pmState.filter(f => f.category === 'landmark' || f.category === 'road' || f.category === 'bridge');
      const newState = !landmarkPolys.every(p => p.visible !== false);
      landmarkPolys.forEach(p => {
        const entry = polygonManagerRef.current?.polygons.get(p.id);
        if (entry) entry.itemVisible = newState;
      });
      if (polygonManagerRef.current) polygonManagerRef.current.callbacks.onChange();
      return;
    }

    if (isBulk === 'plots') {
      const plots = getLayerChildren(child.layerId).filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === child.id && (c.category === 'unit' || c.category === 'pending-unit'));
      const newState = !plots.every(p => p.visible !== false);
      plots.forEach(p => {
        const entry = polygonManagerRef.current?.polygons.get(p.id);
        if (entry) entry.itemVisible = newState;
      });
      if (polygonManagerRef.current) polygonManagerRef.current.callbacks.onChange();
      return;
    }

    const isMulti = child ? (multiSelectedIds.has(child.id) && multiSelectedIds.size > 1) : false;
    const targetIds = isMulti ? Array.from(multiSelectedIds) : [child?.id].filter(Boolean);

    if (!child) return;
    const newState = child.visible === false ? true : false;

    let allTargetIds = [...targetIds];
    if (isBulk === true) {
      targetIds.forEach(id => {
        const fp = floorPlanManagerRef.current?.getState().find(f => f.id === id);
        if (fp) {
          const childrenOfFp = getLayerChildren(fp.layerId || child.layerId).filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === id);
          allTargetIds.push(...childrenOfFp.map(c => c.id));
        }
      });
    }

    allTargetIds.forEach(id => {
      if (polygonManagerRef.current?.polygons.has(id)) {
        const entry = polygonManagerRef.current.polygons.get(id);
        entry.itemVisible = newState;
      }
      if (pinManagerRef.current?.pins.has(id)) {
        const entry = pinManagerRef.current.pins.get(id);
        entry.itemVisible = newState;
      }
      if (floorPlanManagerRef.current?.overlays.has(id)) {
        const entry = floorPlanManagerRef.current.overlays.get(id);
        entry.itemVisible = newState;
      }
    });

    if (polygonManagerRef.current) polygonManagerRef.current.callbacks.onChange();
    if (pinManagerRef.current) pinManagerRef.current.callbacks.onChange();
    if (floorPlanManagerRef.current) floorPlanManagerRef.current.callbacks.onChange();
  };

  const handleColorChange = (id, isLayer, color, children) => {
    if (isLayer) updateLayer(id, { color });
    else updateFolderSetting(id, { color });

    let isUniform = false;
    if (isLayer) {
      const l = project?.layers?.find(ll => ll.id === id);
      isUniform = l && l.styleMode === 'uniform';
    } else {
      const s = project?.folderSettings?.[id];
      isUniform = s && s.styleMode === 'uniform';
    }

    if (isUniform) {
      children.forEach(child => {
        if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) polygonManagerRef.current.setUniformColor(child.id, color);
        if (child.type === 'pin' && pinManagerRef.current) pinManagerRef.current.setUniformColor(child.id, color);
      });
    }
  };

  const handleStyleModeToggle = (id, isLayer, newMode, color, children) => {
    let oldMode = 'individual';
    if (isLayer) {
      const l = project?.layers?.find(ll => ll.id === id);
      if (l) oldMode = l.styleMode || 'individual';
    } else {
      const s = project?.folderSettings?.[id];
      if (s) oldMode = s.styleMode || 'individual';
    }
    if (oldMode === newMode) return;

    if (isLayer) updateLayer(id, { styleMode: newMode });
    else updateFolderSetting(id, { styleMode: newMode });

    if (newMode === 'uniform') {
      children.forEach(child => {
        if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) polygonManagerRef.current.setUniformColor(child.id, color);
        if (child.type === 'pin' && pinManagerRef.current) pinManagerRef.current.setUniformColor(child.id, color);
      });
    } else {
      children.forEach(child => {
        if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) polygonManagerRef.current.restoreOriginalColor(child.id);
        if (child.type === 'pin' && pinManagerRef.current) pinManagerRef.current.restoreOriginalColor(child.id);
      });
    }

  };

  const selectChild = (child) => {
    const map = polygonManagerRef.current?.map || pinManagerRef.current?.map || floorPlanManagerRef.current?.map;

    if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) {
      polygonManagerRef.current.select(child.id);
      if (map) {
        const entry = polygonManagerRef.current.polygons.get(child.id);
        if (entry && entry.gPolygon) {
          const bounds = new window.google.maps.LatLngBounds();
          entry.gPolygon.getPath().forEach(latLng => bounds.extend(latLng));
          focusOnBounds(map, bounds);
        }
      }
    }
    if (child.type === 'pin' && pinManagerRef.current) {
      pinManagerRef.current.select(child.id);
      if (map) {
        const coords = pinManagerRef.current.getCoords(child.id);
        if (coords) {
          const bounds = new window.google.maps.LatLngBounds();
          bounds.extend(coords);
          focusOnBounds(map, bounds);
        }
      }
    }
    if (child.type === 'floorplan' && floorPlanManagerRef.current) {
      floorPlanManagerRef.current.onSelect(child.id);
      if (map) {
        const fp = floorPlanManagerRef.current.getState().find(f => f.id === child.id);
        if (fp && fp.bounds) {
          const bounds = new window.google.maps.LatLngBounds(fp.bounds.sw, fp.bounds.ne);
          focusOnBounds(map, bounds);
        }
      }
    }
  };

  const renderItemChild = (child, layerObj, isNested = false, isDeeplyNested = false, isUniformParent = false) => {
    const isChildSelected = child.id === selectedLayerItemId || multiSelectedIds.has(child.id);
    const layerId = layerObj ? layerObj.id : child.layerId;
    return (
      <div key={child.id}>
        <div
          className={`lp-child-item ${isChildSelected ? 'lp-child-item--active' : ''}`}
          onClick={(e) => handleChildClick(e, layerId, child)}
          style={{ paddingLeft: isDeeplyNested ? 40 : (isNested ? 24 : 8), paddingRight: 4 }}
          draggable
          onDragStart={(e) => handleItemDragStart(e, child.id, child.type)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleItemDrop(e, child.id, child.type)}
        >
          <button
            className={`lp-toggle-btn ${child.visible === false ? 'lp-toggle-btn--hidden' : ''}`}
            style={{ marginRight: 8, padding: 0 }}
            onClick={(e) => handleToggleVisibility(e, child, false)}
            title={child.visible !== false ? "Hide item" : "Show item"}
          >
            {child.visible !== false ? <EyeIcon /> : <EyeOffIcon />}
          </button>
          <div className="lp-child-icon">
            {child.type === 'polygon' && <PolygonIcon />}
            {child.type === 'pin' && <PinIcon />}
            {child.type === 'floorplan' && <FloorPlanIcon />}
            {child.type === 'road' && <RoadIcon />}
          </div>
          {editingLayerId === child.id && child.type === 'floorplan' ? (
            <input
              type="text"
              className="lp-name-input"
              value={tempLayerName}
              autoFocus
              style={{ flex: 1 }}
              onChange={(e) => setTempLayerName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  if (floorPlanManagerRef.current) floorPlanManagerRef.current.rename(child.id, tempLayerName);
                  setEditingLayerId(null);
                } else if (e.key === 'Escape') {
                  setEditingLayerId(null);
                }
              }}
              onBlur={() => {
                if (floorPlanManagerRef.current) floorPlanManagerRef.current.rename(child.id, tempLayerName);
                setEditingLayerId(null);
              }}
            />
          ) : (
            <>
              <div className="lp-child-name" title={child.name || child.id}>
                {child.name || (child.type === 'floorplan' ? 'Floor Plan Overlay' : child.id)}
              </div>
              {child.type === 'floorplan' && (
                <div className="lp-menu-wrap" style={{ marginLeft: 4 }}>
                  <button
                    className="lp-child-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(prev => prev === `fp-menu-${child.id}` ? null : `fp-menu-${child.id}`);
                    }}
                    title="Options"
                  >
                    <MoreIcon />
                  </button>
                  {menuOpenId === `fp-menu-${child.id}` && (
                    <div className="lp-dropdown">
                      <button className="lp-dropdown-item" onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        setReplacingFloorPlanId(child.id);
                        if (replaceFileRef.current) replaceFileRef.current.click();
                      }}>Replace</button>
                      <button className="lp-dropdown-item" onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        alert('Add Floor feature needs specification');
                      }}>Add Floor</button>
                      <button className="lp-dropdown-item" onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        setEditingLayerId(child.id);
                        setTempLayerName(child.name || 'Floor Plan Overlay');
                      }}>Rename</button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {!isUniformParent && (!layerObj || layerObj.styleMode !== 'uniform') && child.type !== 'floorplan' && (
            <div className="lp-child-swatch-wrap">
              <ColorPickerPopover
                color={child.color || child.lineColor || '#00d4ff'}
                onChange={(c) => {
                  if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) {
                    polygonManagerRef.current.setColor(child.id, c);
                  }
                  if (child.type === 'pin' && pinManagerRef.current) {
                    pinManagerRef.current.setColor(child.id, c);
                  }
                }}
                className="lp-child-swatch"
              />
            </div>
          )}
          <button
            className="lp-child-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (layerId) handleLayerClick(layerId);
              selectChild(child);
            }}
            title="Edit"
          >
            <PaintBrushIcon />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="lp-panel">
      <input
        ref={replaceFileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleReplaceFile}
      />
      <div className="lp-header">
        <span className="lp-title">Layers</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="lp-add-btn" onClick={() => {
            const data = getExportProject();
            sessionStorage.setItem('preview_project_data', JSON.stringify(data));
            window.open('/preview', '_blank');
          }} title="Preview map">
            Preview
          </button>
          <button className="lp-add-btn" onClick={addLayer}>＋ Add</button>
        </div>
      </div>
      <div className="lp-content">
        {layers.map(layer => {
          const isActive = layer.id === activeLayerId;
          const isExpanded = expandedLayers[layer.id];
          const children = getLayerChildren(layer.id);

          return (
            <div
              key={layer.id}
              className={`lp-layer ${isActive ? 'lp-layer--active' : ''}`}
              onClick={(e) => {
                handleLayerClick(layer.id);
                toggleExpand(layer.id, e);
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, layer.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, layer.id)}
            >
              <div className={`lp-layer-row ${selectedLayerItemId === layer.id ? 'lp-layer-row--active' : ''}`}>
                <div className="lp-drag-handle" title="Drag to reorder">
                  <GripIcon />
                </div>
                <button
                  className={`lp-toggle-btn ${!layer.visible ? 'lp-toggle-btn--hidden' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                  title={layer.visible ? "Hide layer" : "Show layer"}
                >
                  {layer.visible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
                {editingLayerId === layer.id ? (
                  <input
                    type="text"
                    className="lp-name-input"
                    value={tempLayerName}
                    autoFocus
                    onChange={(e) => setTempLayerName(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        updateLayer(layer.id, { name: tempLayerName });
                        setEditingLayerId(null);
                      } else if (e.key === 'Escape') {
                        setEditingLayerId(null);
                      }
                    }}
                    onBlur={() => {
                      updateLayer(layer.id, { name: tempLayerName });
                      setEditingLayerId(null);
                    }}
                  />
                ) : (
                  <span
                    className="lp-name-input"
                    style={{ cursor: 'pointer', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {layer.name}
                  </span>
                )}

                <div className="lp-menu-wrap">
                  <button className="lp-menu-btn" onClick={(e) => handleMenuClick(layer.id, e)}>
                    <MoreIcon />
                  </button>
                  {menuOpenId === layer.id && (
                    <div className="lp-dropdown">
                      <button className="lp-dropdown-item" onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(null);
                        setEditingLayerId(layer.id);
                        setTempLayerName(layer.name);
                      }}>Rename</button>
                      <button className="lp-dropdown-item" onClick={(e) => handleExport(layer.id, e)}>Export to JSON</button>
                      <button className="lp-dropdown-item lp-dropdown-item--danger" onClick={(e) => handleDelete(layer.id, e)}>Delete layer</button>
                    </div>
                  )}
                </div>

                <div className="lp-menu-wrap">
                  <ColorPickerPopover
                    color={layer.color}
                    onChange={(c) => handleColorChange(layer.id, true, c, getLayerChildren(layer.id))}
                    styleMode={layer.styleMode || 'individual'}
                    onStyleModeChange={(newMode) => handleStyleModeToggle(layer.id, true, newMode, layer.color, getLayerChildren(layer.id))}
                    triggerElement={
                      (layer.styleMode === 'uniform') ? null : (
                        <button
                          className="lp-style-btn"
                          title="Style Mode"
                        >
                          <PaintBrushIcon />
                        </button>
                      )
                    }
                  />
                </div>

                <button
                  className={`lp-expand-btn ${isExpanded ? 'lp-expand-btn--expanded' : ''}`}
                  onClick={(e) => toggleExpand(layer.id, e)}
                  style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
                >
                  <ChevronIcon />
                </button>
              </div>

              {isExpanded && children.length > 0 && (
                <div className="lp-children">
                  {(() => {
                    const fps = children.filter(c => c.type === 'floorplan');
                    const rootPolys = children.filter(c => c.type === 'polygon' && !c.metadata?.floorPlanId);
                    const rootPins = children.filter(c => c.type === 'pin' && !c.metadata?.floorPlanId);

                    const rootChildren = [...rootPolys, ...rootPins];

                    return (
                      <>
                        {fps.map(fp => {
                          const folderId = `folder-${fp.id}`;
                          const isExpanded = expandedLayers[folderId];
                          return (
                            <div key={folderId} className="lp-fp-folder">
                              <div
                                className={`lp-layer-row ${selectedLayerItemId === folderId ? 'lp-layer-row--active' : ''}`}
                                style={{ paddingLeft: 8, cursor: 'pointer' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLayerItemId(folderId);
                                  handleLayerClick(layer.id);
                                  toggleExpand(folderId, e);
                                }}
                              >
                                <button
                                  className={`lp-toggle-btn ${fp.visible === false ? 'lp-toggle-btn--hidden' : ''}`}
                                  style={{ padding: 0, marginRight: 8 }}
                                  onClick={(e) => handleToggleVisibility(e, fp, true)}
                                  title={fp.visible !== false ? "Hide all" : "Show all"}
                                >
                                  {fp.visible !== false ? <EyeIcon /> : <EyeOffIcon />}
                                </button>
                                {editingLayerId === folderId ? (
                                  <input
                                    type="text"
                                    className="lp-name-input"
                                    value={tempLayerName}
                                    autoFocus
                                    onChange={(e) => setTempLayerName(e.target.value)}
                                    onClick={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        updateFolderSetting(folderId, { name: tempLayerName });
                                        setEditingLayerId(null);
                                      } else if (e.key === 'Escape') {
                                        setEditingLayerId(null);
                                      }
                                    }}
                                    onBlur={() => {
                                      updateFolderSetting(folderId, { name: tempLayerName });
                                      setEditingLayerId(null);
                                    }}
                                  />
                                ) : (
                                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', flexGrow: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    setEditingLayerId(folderId);
                                    const folderName = project?.folderSettings?.[folderId]?.name || fp.name || 'Floor Plan';
                                    setTempLayerName(folderName);
                                  }}>
                                    {project?.folderSettings?.[folderId]?.name || fp.name || 'Floor Plan'}
                                  </span>
                                )}

                                <div className="lp-menu-wrap">
                                  <button className="lp-menu-btn" onClick={(e) => handleMenuClick(folderId, e)}>
                                    <MoreIcon />
                                  </button>
                                  {menuOpenId === folderId && (
                                    <div className="lp-dropdown">
                                      <button className="lp-dropdown-item" onClick={(e) => {
                                        e.stopPropagation();
                                        setMenuOpenId(null);
                                        setEditingLayerId(folderId);
                                        const folderName = project?.folderSettings?.[folderId]?.name || fp.name || 'Floor Plan';
                                        setTempLayerName(folderName);
                                      }}>Rename</button>
                                    </div>
                                  )}
                                </div>

                                {(() => {
                                  const boundaryPoly = children.find(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && c.category === 'project');
                                  const nestedPlots = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && (c.category === 'unit' || c.category === 'pending-unit'));
                                  const otherPolys = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && c.category !== 'unit' && c.category !== 'pending-unit' && c.id !== boundaryPoly?.id);
                                  const nestedPins = children.filter(c => c.type === 'pin' && c.metadata?.floorPlanId === fp.id);
                                  const fpChildren = [fp, ...(boundaryPoly ? [boundaryPoly] : []), ...nestedPlots, ...otherPolys, ...nestedPins];
                                  const settings = project?.folderSettings?.[folderId] || {};
                                  const styleMode = settings.styleMode || 'individual';
                                  const color = settings.color || '#00CED1';

                                  return (
                                    <div className="lp-menu-wrap" style={{ marginRight: 8 }}>
                                      <ColorPickerPopover
                                        color={color}
                                        onChange={(c) => handleColorChange(folderId, false, c, fpChildren)}
                                        styleMode={styleMode}
                                        onStyleModeChange={(newMode) => handleStyleModeToggle(folderId, false, newMode, color, fpChildren)}
                                        triggerElement={
                                          styleMode === 'uniform' ? null : (
                                            <button
                                              className="lp-style-btn"
                                              title="Style Mode"
                                            >
                                              <PaintBrushIcon />
                                            </button>
                                          )
                                        }
                                      />
                                    </div>
                                  );
                                })()}

                                <button
                                  className={`lp-expand-btn ${isExpanded ? 'lp-expand-btn--expanded' : ''}`}
                                  style={{ visibility: 'visible' }}
                                  onClick={(e) => { e.stopPropagation(); toggleExpand(folderId, e); }}
                                >
                                  <ChevronIcon />
                                </button>
                              </div>
                              {isExpanded && (
                                <div className="lp-nested-children">
                                  {renderItemChild(fp, layer, true)}
                                  {(() => {
                                    const boundaryPoly = children.find(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && c.category === 'project');
                                    const nestedPlots = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && (c.category === 'unit' || c.category === 'pending-unit'));
                                    const otherPolys = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === fp.id && c.category !== 'unit' && c.category !== 'pending-unit' && c.id !== boundaryPoly?.id);
                                    const nestedPins = children.filter(c => c.type === 'pin' && c.metadata?.floorPlanId === fp.id);

                                    nestedPlots.sort((a, b) => {
                                      const numA = parseInt(a.name, 10);
                                      const numB = parseInt(b.name, 10);
                                      const isNumA = !isNaN(numA) && numA.toString() === (a.name || '').trim();
                                      const isNumB = !isNaN(numB) && numB.toString() === (b.name || '').trim();
                                      if (isNumA && isNumB) return numA - numB;
                                      if (isNumA && !isNumB) return -1;
                                      if (!isNumA && isNumB) return 1;
                                      return (a.name || '').localeCompare(b.name || '');
                                    });

                                    const folderSettings = project?.folderSettings?.[folderId] || {};
                                    const isFolderUniform = folderSettings.styleMode === 'uniform';

                                    return (
                                      <>
                                        {boundaryPoly && renderItemChild(boundaryPoly, layer, true, false, isFolderUniform)}
                                        {otherPolys.map(nc => renderItemChild(nc, layer, true, false, isFolderUniform))}
                                        {nestedPins.map(nc => renderItemChild(nc, layer, true, false, isFolderUniform))}
                                        {nestedPlots.length > 0 && (() => {
                                          const plotsFolderId = `plots-${fp.id}`;
                                          const isPlotsExpanded = expandedLayers[plotsFolderId];
                                          const allPlotsVisible = nestedPlots.every(p => p.visible !== false);
                                          const plotsSettings = project?.folderSettings?.[plotsFolderId] || {};
                                          const isPlotsUniform = plotsSettings.styleMode === 'uniform';

                                          return (
                                            <div key={plotsFolderId} className="lp-plots-folder">
                                              <div
                                                className={`lp-layer-row ${selectedLayerItemId === plotsFolderId ? 'lp-layer-row--active' : ''}`}
                                                style={{ paddingLeft: 24, cursor: 'pointer', height: 28 }}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setSelectedLayerItemId(plotsFolderId);
                                                  handleLayerClick(layer.id);
                                                  toggleExpand(plotsFolderId, e);
                                                }}
                                              >
                                                <button
                                                  className={`lp-toggle-btn ${!allPlotsVisible ? 'lp-toggle-btn--hidden' : ''}`}
                                                  style={{ padding: 0, marginRight: 8 }}
                                                  onClick={(e) => handleToggleVisibility(e, fp, 'plots')}
                                                  title={allPlotsVisible ? "Hide all" : "Show all"}
                                                >
                                                  {allPlotsVisible ? <EyeIcon /> : <EyeOffIcon />}
                                                </button>
                                                <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', flexGrow: 1 }}>
                                                  Plots ({nestedPlots.length})
                                                </span>

                                                {(() => {
                                                  const settings = project?.folderSettings?.[plotsFolderId] || {};
                                                  const styleMode = settings.styleMode || 'individual';
                                                  const color = settings.color || '#ff6b6b';

                                                  return (
                                                    <div className="lp-menu-wrap" style={{ marginRight: 8 }}>
                                                      <ColorPickerPopover
                                                        color={color}
                                                        onChange={(c) => handleColorChange(plotsFolderId, false, c, nestedPlots)}
                                                        styleMode={styleMode}
                                                        onStyleModeChange={(newMode) => handleStyleModeToggle(plotsFolderId, false, newMode, color, nestedPlots)}
                                                        triggerElement={
                                                          styleMode === 'uniform' ? null : (
                                                            <button
                                                              className="lp-style-btn"
                                                              title="Style Mode"
                                                            >
                                                              <PaintBrushIcon />
                                                            </button>
                                                          )
                                                        }
                                                      />
                                                    </div>
                                                  );
                                                })()}

                                                <button
                                                  className={`lp-expand-btn ${isPlotsExpanded ? 'lp-expand-btn--expanded' : ''}`}
                                                  style={{ visibility: 'visible' }}
                                                  onClick={(e) => { e.stopPropagation(); toggleExpand(plotsFolderId, e); }}
                                                >
                                                  <ChevronIcon />
                                                </button>
                                              </div>
                                              {isPlotsExpanded && (
                                                <div className="lp-nested-children">
                                                  {nestedPlots.map(nc => renderItemChild(nc, layer, false, true, isPlotsUniform))}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })()}
                                      </>
                                    );
                                  })()}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {rootChildren.map(c => renderItemChild(c, layer, false))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        {(() => {
          const landmarkPolys = pmState.filter(f => f.category === 'landmark' || f.category === 'road' || f.category === 'bridge').map(f => ({ ...f, type: (f.category === 'road' || f.category === 'bridge') ? 'road' : 'polygon' }));
          const isExpanded = expandedLayers['landmarks'];
          const allVisible = landmarkPolys.length > 0 && landmarkPolys.every(p => p.visible !== false);

          return (
            <div className="lp-layer lp-layer-landmarks">
              <div
                className={`lp-layer-row ${selectedLayerItemId === 'landmarks' ? 'lp-layer-row--active' : ''}`}
                style={{ paddingLeft: 8, cursor: 'pointer' }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedLayerItemId('landmarks');
                  toggleExpand('landmarks', e);
                }}
              >
                <button
                  className={`lp-toggle-btn ${!allVisible ? 'lp-toggle-btn--hidden' : ''}`}
                  style={{ padding: 0, marginRight: 8 }}
                  onClick={(e) => handleToggleVisibility(e, null, 'landmarks')}
                  title={allVisible ? "Hide all" : "Show all"}
                >
                  {allVisible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
                <div className="lp-child-icon" style={{ marginRight: 8 }}>
                  <PolygonIcon />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', flexGrow: 1 }}>
                  Landmarks ({landmarkPolys.length})
                </span>
                {(() => {
                  const folderId = 'landmarks';
                  const settings = project?.folderSettings?.[folderId] || {};
                  const styleMode = settings.styleMode || 'individual';
                  const color = settings.color || '#2ecc71';

                  return (
                    <div className="lp-menu-wrap" style={{ marginRight: 8 }}>
                      <ColorPickerPopover
                        color={color}
                        onChange={(c) => handleColorChange(folderId, false, c, landmarkPolys)}
                        styleMode={styleMode}
                        onStyleModeChange={(newMode) => handleStyleModeToggle(folderId, false, newMode, color, landmarkPolys)}
                        triggerElement={
                          styleMode === 'uniform' ? null : (
                            <button
                              className="lp-style-btn"
                              title="Style Mode"
                            >
                              <PaintBrushIcon />
                            </button>
                          )
                        }
                      />
                    </div>
                  );
                })()}

                <button
                  className={`lp-expand-btn ${isExpanded ? 'lp-expand-btn--expanded' : ''}`}
                  style={{ visibility: landmarkPolys.length > 0 ? 'visible' : 'hidden' }}
                  onClick={(e) => { e.stopPropagation(); toggleExpand('landmarks', e); }}
                >
                  <ChevronIcon />
                </button>
              </div>
              {isExpanded && (() => {
                const lmRoads = landmarkPolys.filter(p => p.type === 'road');
                const lmPolys = landmarkPolys.filter(p => p.type === 'polygon');

                const renderNestedFolder = (title, folderId, items, defaultColor) => {
                  if (items.length === 0) return null;
                  const isFolderExpanded = expandedLayers[folderId];
                  const allVisible = items.every(p => p.visible !== false);
                  const settings = project?.folderSettings?.[folderId] || {};
                  const styleMode = settings.styleMode || 'individual';
                  const isUniform = styleMode === 'uniform';
                  const color = settings.color || defaultColor;

                  return (
                    <div key={folderId} className="lp-plots-folder">
                      <div
                        className={`lp-layer-row ${selectedLayerItemId === folderId ? 'lp-layer-row--active' : ''}`}
                        style={{ paddingLeft: 24, cursor: 'pointer', height: 28 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLayerItemId(folderId);
                          toggleExpand(folderId, e);
                        }}
                      >
                        <button
                          className={`lp-toggle-btn ${!allVisible ? 'lp-toggle-btn--hidden' : ''}`}
                          style={{ padding: 0, marginRight: 8 }}
                          onClick={(e) => {
                            e.stopPropagation();
                            const newState = !allVisible;
                            items.forEach(p => {
                              const entry = polygonManagerRef.current?.polygons.get(p.id);
                              if (entry) entry.itemVisible = newState;
                            });
                            if (polygonManagerRef.current) polygonManagerRef.current.callbacks.onChange();
                          }}
                          title={allVisible ? "Hide all" : "Show all"}
                        >
                          {allVisible ? <EyeIcon /> : <EyeOffIcon />}
                        </button>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', flexGrow: 1 }}>
                          {title} ({items.length})
                        </span>

                        <div className="lp-menu-wrap" style={{ marginRight: 8 }}>
                          <ColorPickerPopover
                            color={color}
                            onChange={(c) => handleColorChange(folderId, false, c, items)}
                            styleMode={styleMode}
                            onStyleModeChange={(newMode) => handleStyleModeToggle(folderId, false, newMode, color, items)}
                            triggerElement={
                              styleMode === 'uniform' ? null : (
                                <button
                                  className="lp-style-btn"
                                  title="Style Mode"
                                >
                                  <PaintBrushIcon />
                                </button>
                              )
                            }
                          />
                        </div>

                        <button
                          className={`lp-expand-btn ${isFolderExpanded ? 'lp-expand-btn--expanded' : ''}`}
                          style={{ visibility: 'visible' }}
                          onClick={(e) => { e.stopPropagation(); toggleExpand(folderId, e); }}
                        >
                          <ChevronIcon />
                        </button>
                      </div>
                      {isFolderExpanded && (
                        <div className="lp-nested-children">
                          {items.map(nc => renderItemChild(nc, null, false, true, isUniform))}
                        </div>
                      )}
                    </div>
                  );
                };

                return (
                  <>
                    {renderNestedFolder('Roads', 'lm-roads', lmRoads, '#FF9800')}
                    {renderNestedFolder('Polygons', 'lm-polygons', lmPolys, '#2ecc71')}
                  </>
                );
              })()}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
