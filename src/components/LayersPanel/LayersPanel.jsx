import React, { useState, useEffect, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { focusOnBounds } from '../MapWorkspace/MapWorkspace';
import './LayersPanel.css';

// Icons
const EyeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
);

const EyeOffIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
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
    addLayer, deleteLayer, updateLayer, toggleLayerVisibility, reorderLayers,
    polygonManagerRef, pinManagerRef, floorPlanManagerRef,
    getExportProject,
    selectedId,
    selectedPolygonEntry,
    selectedFloorPlanId,
  } = useWorkspace();

  const [expandedLayers, setExpandedLayers] = useState({});
  const [menuOpenId, setMenuOpenId] = useState(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleDocClick = () => setMenuOpenId(null);
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  const toggleExpand = (id, e) => {
    e.stopPropagation();
    setExpandedLayers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleMenuClick = (id, e) => {
    e.stopPropagation();
    setMenuOpenId(prev => (prev === id ? null : id));
  };

  const handleLayerClick = (id) => {
    setActiveLayerId(id);
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

  // Drag & drop sorting
  const [draggedId, setDraggedId] = useState(null);

  const handleDragStart = (e, id) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e) => {
    e.preventDefault(); // allow drop
  };
  const handleDrop = (e, targetId) => {
    e.preventDefault();
    if (draggedId && draggedId !== targetId) {
      reorderLayers(draggedId, targetId);
    }
    setDraggedId(null);
  };

  // Derive active items for selecting children
  const pmState = polygonManagerRef.current?.getState() || [];
  const pnmState = pinManagerRef.current?.getState() || [];
  const fpState = floorPlanManagerRef.current?.getState() || [];

  const getLayerChildren = (layerId) => {
    const polys = pmState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'polygon' }));
    const pins = pnmState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'pin' }));
    const fps = fpState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'floorplan' }));
    return [...fps, ...polys, ...pins];
  };

  const selectChild = (child) => {
    const map = polygonManagerRef.current?.map || pinManagerRef.current?.map || floorPlanManagerRef.current?.map;

    if (child.type === 'polygon' && polygonManagerRef.current) {
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

  const layers = [...(project.layers || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  return (
    <div className="lp-panel">
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
              onClick={() => handleLayerClick(layer.id)}
              draggable
              onDragStart={(e) => handleDragStart(e, layer.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, layer.id)}
            >
              <div className="lp-layer-row">
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
                <div className="lp-color-swatch-wrap" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="color"
                    className="lp-color-swatch"
                    value={layer.color}
                    onChange={(e) => updateLayer(layer.id, { color: e.target.value })}
                  />
                </div>
                <input
                  type="text"
                  className="lp-name-input"
                  value={layer.name}
                  onChange={(e) => updateLayer(layer.id, { name: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                />
                
                <div className="lp-menu-wrap">
                  <button className="lp-menu-btn" onClick={(e) => handleMenuClick(layer.id, e)}>
                    <MoreIcon />
                  </button>
                  {menuOpenId === layer.id && (
                    <div className="lp-dropdown">
                      <button className="lp-dropdown-item" onClick={(e) => { e.stopPropagation(); setMenuOpenId(null); document.querySelector('.lp-name-input')?.focus(); }}>Rename</button>
                      <button className="lp-dropdown-item" onClick={(e) => handleExport(layer.id, e)}>Export to JSON</button>
                      <button className="lp-dropdown-item lp-dropdown-item--danger" onClick={(e) => handleDelete(layer.id, e)}>Delete layer</button>
                    </div>
                  )}
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
                  {children.map(child => {
                    const isChildSelected = (child.type === 'polygon' && selectedPolygonEntry?.id === child.id) ||
                                            (child.type === 'pin' && selectedId === child.id) ||
                                            (child.type === 'floorplan' && selectedFloorPlanId === child.id);
                    return (
                      <div
                        key={child.id}
                        className={`lp-child-item ${isChildSelected ? 'lp-child-item--active' : ''}`}
                        onClick={(e) => { e.stopPropagation(); handleLayerClick(layer.id); selectChild(child); }}
                      >
                        <div className="lp-child-icon">
                          {child.type === 'polygon' && <PolygonIcon />}
                          {child.type === 'pin' && <PinIcon />}
                          {child.type === 'floorplan' && <FloorPlanIcon />}
                        </div>
                        <div className="lp-child-name" title={child.name || child.id}>
                          {child.name || (child.type === 'floorplan' ? 'Floor Plan' : child.id)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
