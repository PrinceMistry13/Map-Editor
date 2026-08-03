import React, { useState, useEffect, useRef, useCallback } from "react";
import { GoogleMap, OverlayView } from "@react-google-maps/api";
import PolygonManager from "../../lib/PolygonManager";
import PinManager from "../../lib/PinManager";
import FloorPlanManager from "../../lib/FloorPlanManager";
import "./PreviewMap.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 4;

function LoadingScreen() {
  return (
    <div className="preview-loading">
      <div className="preview-loading-ring" />
      <div className="preview-loading-label">Loading Preview...</div>
    </div>
  );
}

// ─── Hook: wait for the externally-loaded Maps script ────────────────────────
function useGoogleMapsReady() {
  const [ready, setReady] = useState(() => Boolean(window.google?.maps));
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      if (window.google?.maps) { setReady(true); clearInterval(id); }
    }, 80);
    return () => clearInterval(id);
  }, [ready]);
  return ready;
}

function buildMapOptions() {
  return {
    mapTypeId: "hybrid",
    tilt: 45,
    isFractionalZoomEnabled: true,
    maxZoom: 22,
    gestureHandling: "greedy",
    keyboardShortcuts: true,
    clickableIcons: false,
    disableDefaultUI: false,
    zoomControl: true,
    fullscreenControl: true,
    streetViewControl: true,
    mapTypeControl: true,
    rotateControl: true,
    scaleControl: true,
  };
}

export default function PreviewMap() {
  const mapsReady = useGoogleMapsReady();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  
  const [projectData, setProjectData] = useState(null);
  const polygonManagerRef = useRef(null);
  const pinManagerRef = useRef(null);
  const floorPlanManagerRef = useRef(null);
  
  const featureOverlaysRef = useRef({ roads: [], radii: [] });

  const [selectedFeature, setSelectedFeature] = useState(null); // { type, name, pos }
  const [expandedLayers, setExpandedLayers] = useState({});
  const [layerVisibility, setLayerVisibility] = useState({});

  useEffect(() => {
    try {
      const dataStr = sessionStorage.getItem('preview_project_data');
      if (dataStr) {
        const parsed = JSON.parse(dataStr);
        setProjectData(parsed);
        const visibility = {};
        parsed.layers?.forEach(l => { visibility[l.id] = l.visible !== false; });
        setLayerVisibility(visibility);
      } else {
        alert("No preview data found.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load preview data.");
    }
  }, []);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !projectData || !window.google?.maps) return;
    const map = mapRef.current;
    const bounds = new window.google.maps.LatLngBounds();
    let boundsExtended = false;

    const extendBounds = (latLng) => {
      bounds.extend(latLng);
      boundsExtended = true;
    };

    // 1. PolygonManager
    if (polygonManagerRef.current && polygonManagerRef.current.map !== map) {
      polygonManagerRef.current.polygons.forEach(entry => entry.gPolygon.setMap(null));
      polygonManagerRef.current = null;
    }
    if (!polygonManagerRef.current) {
      polygonManagerRef.current = new PolygonManager(map, {
        onSelect: (entry, latLng) => {
          if (entry && latLng) {
            setSelectedFeature({ type: 'Polygon', name: entry.name, pos: latLng });
          } else if (!entry) {
            setSelectedFeature(null);
          }
        },
      });
      projectData.polygons?.forEach(p => {
        const polyId = `preview-poly-${p.id}`;
        polygonManagerRef.current.createPolygon(polyId, p.name, p.path, p.category, p.layerId, p.color);
        p.path.forEach(pt => extendBounds(pt));
      });
    }

    // 2. PinManager
    if (pinManagerRef.current && pinManagerRef.current.map !== map) {
      pinManagerRef.current.pins.forEach(entry => entry.marker.setMap(null));
      pinManagerRef.current = null;
    }
    if (!pinManagerRef.current) {
      pinManagerRef.current = new PinManager(map, {
        onSelect: (entry, latLng) => {
          if (entry && latLng) {
            setSelectedFeature({ type: 'Pin', name: entry.name, pos: latLng });
          } else if (!entry) {
            setSelectedFeature(null);
          }
        },
      });
      projectData.pins?.forEach(p => {
        const pinId = `preview-pin-${p.id}`;
        pinManagerRef.current.createPin(pinId, p.name, p.position.lat, p.position.lng, p.styleMode, p.layerId, p.color);
        if (p.styleMode === 'custom' && p.customImage) {
          pinManagerRef.current.setStyle(pinId, 'custom', p.customImage);
        }
        extendBounds(p.position);
      });
    }

    // 3. FloorPlanManager
    if (floorPlanManagerRef.current && floorPlanManagerRef.current.map !== map) {
      floorPlanManagerRef.current.overlays.forEach(entry => entry.overlay.setMap(null));
      floorPlanManagerRef.current = null;
    }
    if (!floorPlanManagerRef.current) {
      floorPlanManagerRef.current = new FloorPlanManager(map, {
        onSelect: () => {}, // No popup needed for floor plans
      });
      projectData.floorPlans?.forEach(fp => {
        const fpId = `preview-fp-${fp.id}`;
        const center = { lat: (fp.bounds.sw.lat + fp.bounds.ne.lat) / 2, lng: (fp.bounds.sw.lng + fp.bounds.ne.lng) / 2 };
        
        floorPlanManagerRef.current.addFloorPlan(
          fpId, fp.floorplan, center, fp.scale, fp.rotation, fp.opacity, fp.timestamp, fp.layerId
        ).then(() => {
          const entry = floorPlanManagerRef.current.overlays.get(fpId);
          if (entry && entry.overlay) {
             entry.overlay.update({ isLocked: true });
             // Apply initial visibility after load
             if (!layerVisibility[entry.layerId || 'layer-1']) {
               entry.overlay.setMap(null);
             }
          }
        });

        if (fp.bounds) {
          extendBounds(fp.bounds.sw);
          extendBounds(fp.bounds.ne);
        }
      });
    }

    // 4. Render roads & radii statically
    const GM = window.google.maps;
    if (featureOverlaysRef.current.initialized && featureOverlaysRef.current.map !== map) {
      featureOverlaysRef.current.roads.forEach(r => r.setMap(null));
      featureOverlaysRef.current.radii.forEach(r => r.setMap(null));
      featureOverlaysRef.current = { initialized: false, roads: [], radii: [] };
    }
    if (!featureOverlaysRef.current.initialized) {
      featureOverlaysRef.current.initialized = true;
      featureOverlaysRef.current.map = map;

      projectData.roads?.forEach((road) => {
        featureOverlaysRef.current.roads.push(
          new GM.Polyline({
            path: road.points,
            strokeColor: road.lineColor,
            strokeWeight: road.lineWidth,
            strokeOpacity: 0.9,
            map,
            clickable: false,
          })
        );
        road.points.forEach(pt => extendBounds(pt));
      });

      projectData.radii?.forEach((radius) => {

      const color = radius.ringColor || "#00CED1";
      featureOverlaysRef.current.radii.push(
        new GM.Marker({
          position: radius.center, map,
          icon: {
            path: GM.SymbolPath.CIRCLE, scale: 5,
            fillColor: color, fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 1.5,
          },
        })
      );
      extendBounds(radius.center);
      radius.rings.forEach(({ distance }) => {
        featureOverlaysRef.current.radii.push(
          new GM.Circle({
            center: radius.center, radius: distance, map,
            strokeColor: color, strokeWeight: 2, strokeOpacity: 0.8,
            fillOpacity: 0, clickable: false,
          })
        );
        const distDeg = distance / 111320;
        extendBounds({ lat: radius.center.lat + distDeg, lng: radius.center.lng + distDeg });
        extendBounds({ lat: radius.center.lat - distDeg, lng: radius.center.lng - distDeg });
      });
    });
    }

    // 5. Sync visibility based on layers whenever layerVisibility changes
    if (polygonManagerRef.current) {
      polygonManagerRef.current.polygons.forEach(entry => {
        entry.gPolygon.setVisible(layerVisibility[entry.layerId || 'layer-1'] !== false);
      });
    }
    if (pinManagerRef.current) {
      pinManagerRef.current.pins.forEach(entry => {
        entry.marker.setVisible(layerVisibility[entry.layerId || 'layer-1'] !== false);
      });
    }
    
    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.overlays.forEach(entry => {
        const isVisible = layerVisibility[entry.layerId || 'layer-1'] !== false;
        if (isVisible) {
           if (!entry.overlay.getMap()) entry.overlay.setMap(mapRef.current);
        } else {
           entry.overlay.setMap(null);
        }
      });
    }

    if (boundsExtended) {
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setCenter(bounds.getCenter());
        map.setZoom(18);
      } else {
        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
      }
    }
  }, [mapReady, projectData, layerVisibility]);

  const toggleLayerVisibility = (id) => {
    setLayerVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpand = (id) => {
    setExpandedLayers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const focusOnBounds = (bounds) => {
    if (!mapRef.current || !bounds) return;
    const mapDiv = mapRef.current.getDiv();
    const padX = Math.floor(mapDiv.offsetWidth * 0.25);
    const padY = Math.floor(mapDiv.offsetHeight * 0.25);
    mapRef.current.fitBounds(bounds, { top: padY, bottom: padY, left: padX, right: padX });
  };

  const selectChild = (child) => {
    if (!mapRef.current) return;
    
    if (child.type === 'polygon' && polygonManagerRef.current) {
      const entry = polygonManagerRef.current.polygons.get(`preview-poly-${child.id}`);
      if (entry && entry.gPolygon) {
        const bounds = new window.google.maps.LatLngBounds();
        entry.gPolygon.getPath().forEach(latLng => bounds.extend(latLng));
        focusOnBounds(bounds);
        setSelectedFeature({ type: 'Polygon', name: entry.name, pos: bounds.getCenter() });
      }
    }
    if (child.type === 'pin' && pinManagerRef.current) {
      const entry = pinManagerRef.current.pins.get(`preview-pin-${child.id}`);
      if (entry) {
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(entry.marker.getPosition());
        focusOnBounds(bounds);
        setSelectedFeature({ type: 'Pin', name: entry.name, pos: entry.marker.getPosition() });
      }
    }
    if (child.type === 'floorplan' && floorPlanManagerRef.current) {
      const entry = floorPlanManagerRef.current.overlays.get(`preview-fp-${child.id}`);
      if (entry) {
        const b = floorPlanManagerRef.current.computeBounds(entry.overlay);
        const bounds = new window.google.maps.LatLngBounds(b.sw, b.ne);
        focusOnBounds(bounds);
        setSelectedFeature(null);
      }
    }
  };

  if (!mapsReady || !projectData) return <LoadingScreen />;

  const layers = [...(projectData.layers || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const getLayerChildren = (layerId) => {
    const polys = (projectData.polygons || []).filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'polygon' }));
    const pins = (projectData.pins || []).filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'pin' }));
    const fps = (projectData.floorPlans || []).filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'floorplan' }));
    return [...fps, ...polys, ...pins];
  };

  return (
    <div className="preview-root">
      {/* Read-only Layers Panel */}
      <div className="preview-layers-panel">
        <div className="preview-lp-header">
          <span className="preview-lp-title">Project Layers</span>
        </div>
        <div className="preview-lp-content">
          {layers.map(layer => {
            const isVisible = layerVisibility[layer.id] !== false;
            const isExpanded = expandedLayers[layer.id];
            const children = getLayerChildren(layer.id);
            
            return (
              <div key={layer.id} className="preview-lp-layer">
                <div className="preview-lp-layer-row">
                  <button
                    className={`preview-lp-toggle-btn ${!isVisible ? 'preview-lp-toggle-btn--hidden' : ''}`}
                    onClick={() => toggleLayerVisibility(layer.id)}
                    title={isVisible ? "Hide layer" : "Show layer"}
                  >
                    {isVisible ? (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    )}
                  </button>
                  <div className="preview-lp-color-swatch-wrap">
                    <div className="preview-lp-color-swatch" style={{ background: layer.color }}></div>
                  </div>
                  <div className="preview-lp-name-text">{layer.name}</div>
                  <button
                    className={`preview-lp-expand-btn ${isExpanded ? 'preview-lp-expand-btn--expanded' : ''}`}
                    onClick={() => toggleExpand(layer.id)}
                    style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                </div>

                {isExpanded && children.length > 0 && (
                  <div className="preview-lp-children">
                    {children.map(child => (
                      <div key={child.id} className="preview-lp-child-item" onClick={() => selectChild(child)}>
                        <div className="preview-lp-child-name">{child.name || child.id}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="preview-map-container">
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          onLoad={onMapLoad}
          options={buildMapOptions()}
        >
          {selectedFeature && (
            <OverlayView
              position={selectedFeature.pos}
              mapPaneName={OverlayView.FLOAT_PANE}
              getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -height - 15 })}
            >
              <div
                className="poly-popup"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="poly-popup-header">{selectedFeature.type}</div>
                <div className="poly-popup-name">{selectedFeature.name}</div>
                <button className="poly-popup-close" onClick={() => {
                  setSelectedFeature(null);
                  polygonManagerRef.current?.deselect();
                  pinManagerRef.current?.deselect();
                }}>×</button>
              </div>
            </OverlayView>
          )}
        </GoogleMap>
      </div>
    </div>
  );
}
