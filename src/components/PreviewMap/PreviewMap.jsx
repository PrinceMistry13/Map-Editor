import React, { useState, useEffect, useRef, useCallback } from "react";
import { GoogleMap, OverlayView } from "@react-google-maps/api";
import html2canvas from "html2canvas";
import PolygonManager from "../../lib/PolygonManager";
import PinManager from "../../lib/PinManager";
import FloorPlanManager from "../../lib/FloorPlanManager";

import "./PreviewMap.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 4;

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

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    this.setState({ info });
    console.error("ErrorBoundary caught an error", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '20px', background: '#222', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>Something went wrong in PreviewMap.</h2>
          <pre>{this.state.error && this.state.error.toString()}</pre>
          <pre>{this.state.info && this.state.info.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PreviewMapWrapper(props) {
  return <ErrorBoundary><PreviewMap {...props} /></ErrorBoundary>;
}

function PreviewMap() {

  const mapsReady = useGoogleMapsReady();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const [projectData, setProjectData] = useState(null);
  const polygonManagerRef = useRef(null);
  const pinManagerRef = useRef(null);
  const floorPlanManagerRef = useRef(null);

  const featureOverlaysRef = useRef({ radii: [] });
  const hasFitBoundsRef = useRef(false);

  const [selectedFeature, setSelectedFeature] = useState(null);
  const [expandedLayers, setExpandedLayers] = useState({});
  const [layerVisibility, setLayerVisibility] = useState({});

  const [tick, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;

    if (polygonManagerRef.current) {
      polygonManagerRef.current.polygons.forEach(entry => {
        const isLandmark = entry.category === 'landmark' || entry.category === 'road' || entry.category === 'bridge';
        const layerVis = isLandmark ? layerVisibility['landmarks'] !== false : layerVisibility[entry.layerId || 'layer-1'] !== false;
        const finalVisible = layerVis && entry.itemVisible !== false;
        if (entry.gPolygon && entry.gPolygon.getVisible() !== finalVisible) {
          entry.gPolygon.setVisible(finalVisible);
        }
      });
    }

    if (pinManagerRef.current) {
      pinManagerRef.current.pins.forEach(entry => {
        const isLandmark = entry.category === 'landmark';
        const layerVis = isLandmark ? layerVisibility['landmarks'] !== false : layerVisibility[entry.layerId || 'layer-1'] !== false;
        const finalVisible = layerVis && entry.itemVisible !== false;
        if (entry.marker && entry.marker.getVisible() !== finalVisible) {
          entry.marker.setVisible(finalVisible);
        }
      });
    }

    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.overlays.forEach(entry => {
        const layerVis = layerVisibility[entry.layerId || 'layer-1'] !== false;
        const finalVisible = layerVis && entry.itemVisible !== false;
        const currentMap = entry.overlay.getMap();
        if (finalVisible && !currentMap) {
          entry.overlay.setMap(mapRef.current);
        } else if (!finalVisible && currentMap) {
          entry.overlay.setMap(null);
        }
      });
    }
  }, [mapReady, layerVisibility, tick]);

  useEffect(() => {
    try {
      const dataStr = sessionStorage.getItem('preview_project_data');
      if (dataStr) {
        const parsed = JSON.parse(dataStr);
        setProjectData(parsed);
        const visibility = {};
        parsed.layers?.forEach(l => { visibility[l.id] = l.visible !== false; });
        visibility['landmarks'] = true;
        setLayerVisibility(visibility);
      } else {
        alert("No preview data found.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to load preview data.");
    }
  }, []);

  const focusOnBounds = useCallback((bounds) => {
    if (!mapRef.current || !bounds) return;
    const mapDiv = mapRef.current.getDiv();
    const padX = Math.floor(mapDiv.offsetWidth * 0.25);
    const padY = Math.floor(mapDiv.offsetHeight * 0.25);
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      mapRef.current.setCenter(bounds.getCenter());
      mapRef.current.setZoom(18);
    } else {
      mapRef.current.fitBounds(bounds, { top: padY, bottom: padY, left: padX, right: padX });
    }
  }, []);

  const selectChild = useCallback((child) => {
    if (!mapRef.current) return;

    if ((child.type === 'polygon' || child.type === 'road') && polygonManagerRef.current) {
      const entry = polygonManagerRef.current.polygons.get(child.id);
      if (entry && entry.gPolygon) {
        const bounds = new window.google.maps.LatLngBounds();
        entry.gPolygon.getPath().forEach(latLng => bounds.extend(latLng));
        focusOnBounds(bounds);
        setSelectedFeature({ type: entry.category === 'road' ? 'Road' : 'Polygon', name: entry.name, pos: bounds.getCenter() });
      }
    }
    if (child.type === 'pin' && pinManagerRef.current) {
      const entry = pinManagerRef.current.pins.get(child.id);
      if (entry) {
        const bounds = new window.google.maps.LatLngBounds();
        bounds.extend(entry.marker.getPosition());
        focusOnBounds(bounds);
        setSelectedFeature({ type: 'Pin', name: entry.name, pos: entry.marker.getPosition() });
      }
    }
    if (child.type === 'floorplan' && floorPlanManagerRef.current) {
      const entry = floorPlanManagerRef.current.overlays.get(child.id);
      if (entry) {
        const b = floorPlanManagerRef.current.computeBounds(entry.overlay);
        const bounds = new window.google.maps.LatLngBounds(b.sw, b.ne);
        focusOnBounds(bounds);
        setSelectedFeature(null);
      }
    }
  }, [focusOnBounds]);

  const onMapLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  const onMapUnmount = useCallback(() => {
    mapRef.current = null;
    polygonManagerRef.current = null;
    pinManagerRef.current = null;
    floorPlanManagerRef.current = null;
    featureOverlaysRef.current = { radii: [] };
    hasFitBoundsRef.current = false;
    setMapReady(false);
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
        onChange: forceUpdate,
        onSelect: (entry, latLng) => {
          if (entry && latLng) {
            selectChild({ id: entry.id, type: entry.category === 'road' ? 'road' : 'polygon' });
          } else {
            setSelectedFeature(null);
          }
        },
      });
      projectData.polygons?.forEach(p => {
        const polyId = `preview-poly-${p.id}`;
        polygonManagerRef.current.createPolygon(polyId, p.name, p.path, p.category, p.layerId, p.color, p.metadata || {}, { visible: p.visible, fillOpacity: p.fillOpacity, strokeWeight: p.strokeWeight });
        p.path.forEach(pt => extendBounds(pt));
      });
      projectData.roads?.forEach(r => {
        const polyId = `preview-poly-${r.id}`;
        // Create as category 'road' so it uses polylines and is placed in Landmarks
        polygonManagerRef.current.createPolygon(polyId, r.name, r.points || r.path, 'road', r.layerId, r.color || r.lineColor, {}, { strokeWeight: r.strokeWeight || r.lineWidth || 3 });
        (r.points || r.path).forEach(pt => extendBounds(pt));
      });
    }

    // 2. PinManager
    if (pinManagerRef.current && pinManagerRef.current.map !== map) {
      pinManagerRef.current.pins.forEach(entry => entry.marker.setMap(null));
      pinManagerRef.current = null;
    }
    if (!pinManagerRef.current) {
      pinManagerRef.current = new PinManager(map, {
        onChange: forceUpdate,
        onSelect: (entry, latLng) => {
          if (entry && latLng) {
            selectChild({ id: entry.id, type: 'pin' });
          } else {
            setSelectedFeature(null);
          }
        },
      });
      projectData.pins?.forEach(p => {
        const pinId = `preview-pin-${p.id}`;
        pinManagerRef.current.createPin(
          pinId,
          p.name,
          p.color,
          p.position,
          p.styleMode,
          p.imageDataUrl,
          p.layerId,
          p.metadata || {},
          p.category,
          p.landmarkType,
          p.customSize || 1
        );
        if (p.visible === false) {
          const entry = pinManagerRef.current.pins.get(pinId);
          if (entry) entry.itemVisible = false;
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
        onChange: forceUpdate,
        onSelect: () => { }, // No popup needed for floor plans
      });
      projectData.floorPlans?.forEach(fp => {
        const fpId = `preview-fp-${fp.id}`;
        const center = { lat: (fp.bounds.sw.lat + fp.bounds.ne.lat) / 2, lng: (fp.bounds.sw.lng + fp.bounds.ne.lng) / 2 };

        floorPlanManagerRef.current.addFloorPlan(
          fpId, fp.floorplan, center, fp.scale, fp.rotation, fp.opacity, fp.timestamp, fp.layerId, fp.distortedCorners, fp.name
        ).then(() => {
          const entry = floorPlanManagerRef.current.overlays.get(fpId);
          if (entry && entry.overlay) {
            // PreviewMap's own FloorPlanManager always constructs overlays with
            // mode 'manual' (its currentMode default is never switched to
            // 'distort' here, since Preview has no distort UI) — but draw()
            // now correctly branches on mode, not just distortedCorners'
            // presence. Without this, a genuinely distorted floor plan would
            // silently render as a plain rectangle in Preview instead of the
            // actual warped quad. Baked (no longer distorted) floor plans
            // correctly get mode 'manual' here since distortedCorners is null.
            entry.overlay.update({ mode: fp.distortedCorners ? 'distort' : 'manual', isLocked: true });
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

    // 4. Render radii statically
    const GM = window.google.maps;
    if (featureOverlaysRef.current.initialized && featureOverlaysRef.current.map !== map) {
      featureOverlaysRef.current.radii.forEach(r => r.setMap(null));
      featureOverlaysRef.current = { initialized: false, radii: [] };
    }
    if (!featureOverlaysRef.current.initialized) {
      featureOverlaysRef.current.initialized = true;
      featureOverlaysRef.current.map = map;

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
        const isLandmark = entry.category === 'landmark' || entry.category === 'road' || entry.category === 'bridge';
        const layerVis = isLandmark ? layerVisibility['landmarks'] !== false : layerVisibility[entry.layerId || 'layer-1'] !== false;
        entry.gPolygon.setVisible(layerVis && entry.itemVisible !== false);
      });
    }
    if (pinManagerRef.current) {
      pinManagerRef.current.pins.forEach(entry => {
        const isLandmark = entry.category === 'landmark';
        const layerVis = isLandmark ? layerVisibility['landmarks'] !== false : layerVisibility[entry.layerId || 'layer-1'] !== false;
        entry.marker.setVisible(layerVis && entry.itemVisible !== false);
      });
    }

    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.overlays.forEach(entry => {
        const isVisible = layerVisibility[entry.layerId || 'layer-1'] !== false && entry.itemVisible !== false;
        if (isVisible) {
          if (!entry.overlay.getMap()) entry.overlay.setMap(mapRef.current);
        } else {
          entry.overlay.setMap(null);
        }
      });
    }

    if (boundsExtended && !hasFitBoundsRef.current) {
      hasFitBoundsRef.current = true;
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setCenter(bounds.getCenter());
        map.setZoom(18);
      } else {
        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
      }
    }
  }, [mapReady, projectData, layerVisibility, tick]);

  const toggleLayerVisibility = (id) => {
    setLayerVisibility(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleExpand = (id, e) => {
    if (e) e.stopPropagation();
    setExpandedLayers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleItemVisibility = (e, child) => {
    if (e) e.stopPropagation();
    if (!child) return;

    let newState = true;
    if (polygonManagerRef.current?.polygons.has(child.id)) {
      const entry = polygonManagerRef.current.polygons.get(child.id);
      newState = entry.itemVisible === false ? true : false;
      entry.itemVisible = newState;
    } else if (pinManagerRef.current?.pins.has(child.id)) {
      const entry = pinManagerRef.current.pins.get(child.id);
      newState = entry.itemVisible === false ? true : false;
      entry.itemVisible = newState;
    } else if (floorPlanManagerRef.current?.overlays.has(child.id)) {
      const entry = floorPlanManagerRef.current.overlays.get(child.id);
      newState = entry.itemVisible === false ? true : false;
      entry.itemVisible = newState;
    } else {
      child.visible = child.visible === false ? true : false;
    }

    setLayerVisibility(prev => ({ ...prev, [`item-${child.id}`]: newState }));
    forceUpdate();
  };

  const handleToggleBulkVisibility = (e, items, folderId) => {
    if (e) e.stopPropagation();

    let allVisible = true;
    items.forEach(child => {
      if (child.type === 'polygon' || child.type === 'road') {
        const entry = polygonManagerRef.current?.polygons.get(child.id);
        if (entry && entry.itemVisible === false) allVisible = false;
      } else if (child.type === 'pin') {
        const entry = pinManagerRef.current?.pins.get(child.id);
        if (entry && entry.itemVisible === false) allVisible = false;
      } else if (child.type === 'floorplan') {
        const entry = floorPlanManagerRef.current?.overlays.get(child.id);
        if (entry && entry.itemVisible === false) allVisible = false;
      }
    });

    const newState = !allVisible;
    if (folderId) {
      setLayerVisibility(prev => ({ ...prev, [folderId]: newState }));
    }

    items.forEach(child => {
      if (child.type === 'polygon' || child.type === 'road') {
        const entry = polygonManagerRef.current?.polygons.get(child.id);
        if (entry) entry.itemVisible = newState;
      } else if (child.type === 'pin') {
        const entry = pinManagerRef.current?.pins.get(child.id);
        if (entry) entry.itemVisible = newState;
      } else if (child.type === 'floorplan') {
        const entry = floorPlanManagerRef.current?.overlays.get(child.id);
        if (entry) entry.itemVisible = newState;
      }
    });

    forceUpdate();
  };





  const [isDownloading, setIsDownloading] = useState(false);
  const handleDownload = async () => {
    // Functionality removed as per request
  };

  if (!mapsReady || !projectData) return <LoadingScreen />;

  const layers = [...(projectData.layers || [])].sort((a, b) => (a.order || 0) - (b.order || 0));

  const _pmRaw = polygonManagerRef.current?.getState();
  const pmState = _pmRaw ? (Array.isArray(_pmRaw) ? _pmRaw : [...(_pmRaw.polygons || []), ...(_pmRaw.roads || [])]) : projectData.polygons || [];
  const pnmState = pinManagerRef.current?.getState() || projectData.pins || [];
  const fpState = floorPlanManagerRef.current?.getState() || projectData.floorPlans || [];

  const getLayerChildren = (layerId) => {
    const polys = pmState.filter(f => f.layerId === layerId && f.category !== 'landmark' && f.category !== 'road' && f.category !== 'bridge').map(f => ({ ...f, type: 'polygon' }));
    const pins = pnmState.filter(f => f.layerId === layerId && f.category !== 'landmark').map(f => ({ ...f, type: 'pin' }));
    const fps = fpState.filter(f => f.layerId === layerId).map(f => ({ ...f, type: 'floorplan' }));
    return [...fps, ...polys, ...pins];
  };

  const landmarkPolys = pmState.filter(f => f.category === 'landmark' || f.category === 'road' || f.category === 'bridge').map(f => ({ ...f, type: (f.category === 'road' || f.category === 'bridge') ? 'road' : 'polygon' }));
  const landmarkPins = pnmState.filter(f => f.category === 'landmark').map(f => ({ ...f, type: 'pin' }));
  const allLandmarks = [...landmarkPolys, ...landmarkPins];

  const renderItemChild = (child, isDeeplyNested = false) => {
    const isVisible = child.itemVisible !== false && child.visible !== false;
    return (
      <div key={child.id} className="preview-lp-child-item" onClick={() => selectChild(child)} style={{ paddingLeft: isDeeplyNested ? 40 : 24 }}>
        <button
          className={`preview-lp-toggle-btn ${!isVisible ? 'preview-lp-toggle-btn--hidden' : ''}`}
          onClick={(e) => handleToggleItemVisibility(e, child)}
          title={isVisible ? "Hide item" : "Show item"}
        >
          {isVisible ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <div className="preview-lp-child-icon">
          {child.type === 'polygon' && <PolygonIcon />}
          {child.type === 'pin' && <PinIcon />}
          {child.type === 'floorplan' && <FloorPlanIcon />}
          {child.type === 'road' && <RoadIcon />}
        </div>
        <div className="preview-lp-child-name" title={child.name || child.id}>
          {child.name || child.id}
        </div>
      </div>
    );
  };

  return (
    <div className="preview-root">
      <div className="preview-layers-panel">
        <div className="preview-lp-header">
          <span className="preview-lp-title">Project Layers</span>
          <button
            className="preview-download-btn"
            onClick={handleDownload}
            disabled={isDownloading}
          >
            {isDownloading ? "Capturing..." : "Download Map"}
          </button>
        </div>
        <div className="preview-lp-content">\n          {allLandmarks.length > 0 && (
          <div className="preview-lp-layer">
            <div className="preview-lp-layer-row" onClick={(e) => toggleExpand('landmarks', e)}>
              <button
                className={`preview-lp-toggle-btn ${layerVisibility['landmarks'] === false ? 'preview-lp-toggle-btn--hidden' : ''}`}
                onClick={(e) => handleToggleBulkVisibility(e, allLandmarks, 'landmarks')}
                title={layerVisibility['landmarks'] !== false ? "Hide all" : "Show all"}
              >
                {layerVisibility['landmarks'] !== false ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <div className="preview-lp-child-icon" style={{ marginLeft: 4, marginRight: 4 }}>
                <PolygonIcon />
              </div>
              <div className="preview-lp-name-text">Landmarks ({allLandmarks.length})</div>
              <button
                className={`preview-lp-expand-btn ${expandedLayers['landmarks'] ? 'preview-lp-expand-btn--expanded' : ''}`}
                style={{ visibility: 'visible' }}
              >
                <ChevronIcon />
              </button>
            </div>

            {expandedLayers['landmarks'] && (() => {
              const lmRoads = landmarkPolys.filter(p => p.type === 'road');
              const lmPolys = landmarkPolys.filter(p => p.type === 'polygon');
              const lmPins = landmarkPins;

              const renderFolder = (title, id, items) => {
                if (items.length === 0) return null;
                const isExpanded = expandedLayers[id];
                const allVisible = items.every(p => p.itemVisible !== false && p.visible !== false);
                return (
                  <div key={id} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div className="preview-lp-layer-row" style={{ paddingLeft: 24, height: 28 }} onClick={(e) => toggleExpand(id, e)}>
                      <button
                        className={`preview-lp-toggle-btn ${!allVisible ? 'preview-lp-toggle-btn--hidden' : ''}`}
                        onClick={(e) => handleToggleBulkVisibility(e, items, id)}
                      >
                        {allVisible ? <EyeIcon /> : <EyeOffIcon />}
                      </button>
                      <div className="preview-lp-name-text" style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>
                        {title} ({items.length})
                      </div>
                      <button className={`preview-lp-expand-btn ${isExpanded ? 'preview-lp-expand-btn--expanded' : ''}`}>
                        <ChevronIcon />
                      </button>
                    </div>
                    {isExpanded && items.map(c => renderItemChild(c, true))}
                  </div>
                );
              };

              return (
                <div className="preview-lp-children" style={{ marginLeft: 12 }}>
                  {renderFolder('Roads', 'lm-roads', lmRoads)}
                  {renderFolder('Polygons', 'lm-polygons', lmPolys)}
                  {renderFolder('Pins', 'lm-pins', lmPins)}
                </div>
              );
            })()}
          </div>
        )}\n          {layers.map(layer => {
          const isVisible = layerVisibility[layer.id] !== false;
          const isExpanded = expandedLayers[layer.id];
          const children = getLayerChildren(layer.id);

          return (
            <div key={layer.id} className="preview-lp-layer">
              <div className="preview-lp-layer-row" onClick={(e) => toggleExpand(layer.id, e)}>
                <button
                  className={`preview-lp-toggle-btn ${!isVisible ? 'preview-lp-toggle-btn--hidden' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                  title={isVisible ? "Hide layer" : "Show layer"}
                >
                  {isVisible ? <EyeIcon /> : <EyeOffIcon />}
                </button>
                <div className="preview-lp-color-swatch-wrap">
                  <div className="preview-lp-color-swatch" style={{ background: layer.color }}></div>
                </div>
                <div className="preview-lp-name-text">{layer.name}</div>
                <button
                  className={`preview-lp-expand-btn ${isExpanded ? 'preview-lp-expand-btn--expanded' : ''}`}
                  style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
                >
                  <ChevronIcon />
                </button>
              </div>

              {isExpanded && children.length > 0 && (
                <div className="preview-lp-children">
                  {(() => {
                    const fps = children.filter(c => c.type === 'floorplan');
                    const rootPolys = children.filter(c => c.type === 'polygon' && !c.metadata?.floorPlanId);
                    const rootPins = children.filter(c => c.type === 'pin' && !c.metadata?.floorPlanId);
                    const elements = [];

                    fps.forEach(fp => {
                      elements.push(
                        <div key={fp.id} style={{ display: 'flex', flexDirection: 'column' }}>
                          <div className="preview-lp-layer-row" style={{ paddingLeft: 24, height: 28 }} onClick={(e) => toggleExpand('folder-' + fp.id, e)}>
                            <button
                              className={`preview-lp-toggle-btn ${fp.itemVisible === false ? 'preview-lp-toggle-btn--hidden' : ''}`}
                              onClick={(e) => handleToggleItemVisibility(e, fp)}
                              title={fp.itemVisible !== false ? "Hide item" : "Show item"}
                            >
                              {fp.itemVisible !== false ? <EyeIcon /> : <EyeOffIcon />}
                            </button>
                            <div className="preview-lp-child-icon" style={{ marginLeft: 4, marginRight: 4 }}>
                              <FloorPlanIcon />
                            </div>
                            <div className="preview-lp-name-text" style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                              {fp.name || 'Floor Plan'}
                            </div>
                            <button className={`preview-lp-expand-btn ${expandedLayers['folder-' + fp.id] ? 'preview-lp-expand-btn--expanded' : ''}`}>
                              <ChevronIcon />
                            </button>
                          </div>
                          {expandedLayers['folder-' + fp.id] && (() => {
                            const fpChildren = [];

                            // 1. The floorplan itself (indented)
                            fpChildren.push(renderItemChild(fp, true));

                            // 2. The boundary polygon
                            const originalFpId = fp.id.replace('preview-fp-', '');
                            const boundaryPoly = children.find(c => c.type === 'polygon' && c.metadata?.floorPlanId === originalFpId && c.category === 'project');
                            if (boundaryPoly) fpChildren.push(renderItemChild(boundaryPoly, true));

                            // 3. The nested plots (unit/pending-unit)
                            const nestedPlots = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === originalFpId && (c.category === 'unit' || c.category === 'pending-unit'));
                            if (nestedPlots.length > 0) {
                              // SORT NESTED PLOTS (Numeric sort)
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

                              const allPlotsVisible = nestedPlots.every(p => p.itemVisible !== false);
                              fpChildren.push(
                                <div key={'plots-' + fp.id} style={{ display: 'flex', flexDirection: 'column' }}>
                                  <div className="preview-lp-layer-row" style={{ paddingLeft: 40, height: 28 }} onClick={(e) => toggleExpand('plots-' + fp.id, e)}>
                                    <button
                                      className={`preview-lp-toggle-btn ${!allPlotsVisible ? 'preview-lp-toggle-btn--hidden' : ''}`}
                                      onClick={(e) => handleToggleBulkVisibility(e, nestedPlots)}
                                    >
                                      {allPlotsVisible ? <EyeIcon /> : <EyeOffIcon />}
                                    </button>
                                    <div className="preview-lp-name-text" style={{ fontSize: '12px', color: '#94a3b8', textTransform: 'uppercase' }}>
                                      Plots ({nestedPlots.length})
                                    </div>
                                    <button className={`preview-lp-expand-btn ${expandedLayers['plots-' + fp.id] ? 'preview-lp-expand-btn--expanded' : ''}`}>
                                      <ChevronIcon />
                                    </button>
                                  </div>
                                  {expandedLayers['plots-' + fp.id] && nestedPlots.map(c => renderItemChild(c, false, true))}
                                </div>
                              );
                            }

                            // 4. Other polygons associated with this floorplan
                            const otherPolys = children.filter(c => c.type === 'polygon' && c.metadata?.floorPlanId === originalFpId && c.category !== 'unit' && c.category !== 'pending-unit' && c.id !== boundaryPoly?.id);
                            otherPolys.forEach(c => fpChildren.push(renderItemChild(c, true)));

                            // 5. Nested pins associated with this floorplan
                            const nestedPins = children.filter(c => c.type === 'pin' && c.metadata?.floorPlanId === originalFpId);
                            nestedPins.forEach(c => fpChildren.push(renderItemChild(c, true)));

                            return <div className="preview-lp-children">{fpChildren}</div>;
                          })()}
                        </div>
                      );
                    });

                    elements.push(...rootPolys.map(c => renderItemChild(c)));
                    elements.push(...rootPins.map(c => renderItemChild(c)));

                    return elements;
                  })()}
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
          onUnmount={onMapUnmount}
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
