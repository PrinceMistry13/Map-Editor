import { useState, useCallback, useRef, useEffect } from "react";
import { GoogleMap, OverlayView } from "@react-google-maps/api";
import "./MapWorkspace.css";
import { WorkspaceProvider, useWorkspace, nextId } from "../../context/WorkspaceContext";
import ToolPanel from "../ToolPanel/ToolPanel";
import PropertyPanel from "../ToolPanel/PropertyPanel";
import PolygonManager from "../../lib/PolygonManager";
import PinManager from "../../lib/PinManager";
import FloorPlanManager from "../../lib/FloorPlanManager";
import GCPSplitPanel from "../ToolPanel/GCPSplitPanel";
import FloorPlanBottomPanel from "../ToolPanel/FloorPlanBottomPanel";
import LayersPanel from "../LayersPanel/LayersPanel";
import ColorPickerPopover from "../common/ColorPickerPopover";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_CONTAINER_STYLE = { width: "100vw", height: "100vh" };
const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
const DEFAULT_ZOOM = 4;
const LAT_LNG_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const SQM_TO_SQFT = 10.7639104167;
const M_TO_FT = 3.2808399;

function formatSqFt(sqMeters) {
  const sqft = sqMeters * SQM_TO_SQFT;
  return sqft.toLocaleString(undefined, { maximumFractionDigits: sqft < 1000 ? 1 : 0 });
}
function formatFt(meters) {
  const ft = meters * M_TO_FT;
  return ft.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

// ─── Haversine distance (meters) ──────────────────────────────────────────────
function haversine(p1, p2) {
  const R = 6371000;
  const φ1 = (p1.lat * Math.PI) / 180;
  const φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

// ─── Helper: Focus camera on bounds with ~50% viewport fill ──────────────────
export function focusOnBounds(map, bounds) {
  if (!map || !bounds) return;

  // To avoid the map "bouncing" (animating to fitBounds, stopping, then abruptly 
  // zooming out), we use padding instead of the 'idle' + map.setZoom(-1) trick.
  // 25% padding on all sides ensures the bounds fill exactly 50% of the viewport.
  const mapDiv = map.getDiv();
  const padX = Math.floor(mapDiv.offsetWidth * 0.25);
  const padY = Math.floor(mapDiv.offsetHeight * 0.25);

  map.fitBounds(bounds, {
    top: padY,
    bottom: padY,
    left: padX,
    right: padX
  });
}

// ─── Map options (built once after SDK is ready) ──────────────────────────────
function buildMapOptions() {
  const { ControlPosition, MapTypeControlStyle } = window.google.maps;
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
    mapTypeControlOptions: {
      style: MapTypeControlStyle.HORIZONTAL_BAR,
      position: ControlPosition.TOP_RIGHT,
    },
    zoomControlOptions: { position: ControlPosition.RIGHT_CENTER },
    streetViewControlOptions: { position: ControlPosition.RIGHT_BOTTOM },
    fullscreenControlOptions: { position: ControlPosition.RIGHT_TOP },
    rotateControlOptions: { position: ControlPosition.RIGHT_CENTER },
  };
}

// ─── SearchBar ────────────────────────────────────────────────────────────────
function SearchBar({ mapRef }) {
  const [focused, setFocused] = useState(false);
  const [hasValue, setHasValue] = useState(false);
  const [showCoordHint, setShowCoordHint] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  const inputRef = useRef(null);
  const acSvcRef = useRef(null);
  const placesSvcRef = useRef(null);
  const debounceRef = useRef(null);
  const maxZoomSvcRef = useRef(null);

  useEffect(() => {
    if (!window.google?.maps?.places) return;
    acSvcRef.current = new window.google.maps.places.AutocompleteService();
    maxZoomSvcRef.current = new window.google.maps.MaxZoomService();
    const el = document.createElement("div");
    el.style.display = "none";
    document.body.appendChild(el);
    placesSvcRef.current = new window.google.maps.places.PlacesService(el);
    return () => { document.body.removeChild(el); };
  }, []);

  const navigateTo = useCallback((latLng, viewport) => {
    const map = mapRef.current;
    if (!map) return;
    if (viewport) {
      map.fitBounds(viewport);
    } else {
      map.panTo(latLng);
      const doZoom = (z) => map.setZoom(Math.min(Math.max(z, 16), 22));
      if (maxZoomSvcRef.current) {
        maxZoomSvcRef.current.getMaxZoomAtLatLng(
          new window.google.maps.LatLng(latLng.lat, latLng.lng),
          (r) => doZoom(r.status === window.google.maps.MaxZoomStatus.OK ? r.zoom : 20),
        );
      } else { doZoom(20); }
    }
    setPredictions([]);
    setActiveIdx(-1);
  }, [mapRef]);

  const tryCoords = useCallback((str) => {
    const m = LAT_LNG_RE.exec(str);
    if (!m) return false;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    navigateTo({ lat, lng }, null);
    return true;
  }, [navigateTo]);

  const selectPrediction = useCallback((pred) => {
    if (inputRef.current) inputRef.current.value = pred.description;
    setHasValue(true); setPredictions([]); setActiveIdx(-1); setShowCoordHint(false);
    placesSvcRef.current?.getDetails({ placeId: pred.place_id, fields: ["geometry"] }, (place, status) => {
      if (status === window.google.maps.places.PlacesServiceStatus.OK && place?.geometry?.location) {
        navigateTo(
          { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() },
          place.geometry.viewport ?? null,
        );
      }
    });
  }, [navigateTo]);

  const fetchPredictions = useCallback((input) => {
    if (!acSvcRef.current || !input.trim()) { setPredictions([]); return; }
    acSvcRef.current.getPlacePredictions({ input }, (results, status) => {
      setPredictions(
        status === window.google.maps.places.PlacesServiceStatus.OK && results
          ? results.slice(0, 5) : [],
      );
    });
  }, []);

  const handleChange = () => {
    const v = inputRef.current?.value ?? "";
    setHasValue(Boolean(v));
    setShowCoordHint(LAT_LNG_RE.test(v));
    setActiveIdx(-1);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPredictions(v), 220);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, predictions.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); return; }
    if (e.key === "Escape") { setPredictions([]); setActiveIdx(-1); return; }
    if (e.key !== "Enter") return;
    if (activeIdx >= 0 && predictions[activeIdx]) { selectPrediction(predictions[activeIdx]); return; }
    if (predictions.length > 0) { selectPrediction(predictions[0]); return; }
    if (tryCoords(inputRef.current?.value ?? "")) inputRef.current?.blur();
  };

  const handleClear = () => {
    if (inputRef.current) inputRef.current.value = "";
    setHasValue(false); setShowCoordHint(false); setPredictions([]); setActiveIdx(-1);
    inputRef.current?.focus();
  };

  const showDrop = focused && predictions.length > 0;

  return (
    <div className={`mw-search-wrapper${focused ? " mw-search-wrapper--focused" : ""}`}>
      <svg className="mw-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={11} cy={11} r={8} /><line x1={21} y1={21} x2={16.65} y2={16.65} />
      </svg>
      <input ref={inputRef} className="mw-search-input" type="text" onKeyDown={handleKeyDown}
        onChange={handleChange} onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="Search address, place, or lat, lng…" autoComplete="off" spellCheck="false" />
      {hasValue && (
        <button className="mw-search-clear" onMouseDown={(e) => { e.preventDefault(); handleClear(); }} aria-label="Clear">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1={18} y1={6} x2={6} y2={18} /><line x1={6} y1={6} x2={18} y2={18} />
          </svg>
        </button>
      )}
      {showCoordHint && <span className="mw-coord-badge">↵ Go to coordinates</span>}
      {showDrop && (
        <div className="mw-predictions" role="listbox">
          {predictions.map((p, i) => {
            const main = p.structured_formatting?.main_text ?? p.description;
            const sub = p.structured_formatting?.secondary_text ?? "";
            return (
              <div key={p.place_id} role="option" aria-selected={i === activeIdx}
                className={`mw-prediction-item${i === activeIdx ? " mw-prediction-item--active" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); selectPrediction(p); }}>
                <svg className="mw-prediction-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
                  <circle cx={12} cy={9} r={2.5} />
                </svg>
                <div>
                  <div className="mw-prediction-main">{main}</div>
                  {sub && <div className="mw-prediction-sub">{sub}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Loading screen ───────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="mw-loading">
      <div className="mw-loading-ring" />
      <span className="mw-loading-label">Initializing workspace…</span>
    </div>
  );
}

// ─── Default tool property values ────────────────────────────────────────────
const DEFAULT_TOOL_PROPS = {
  polygon: { fillColor: "#00CED1", lineColor: "#00CED1", lineWidth: 2 },
  pin: { color: "#00CED1" },
  road: { lineColor: "#FF9800", lineWidth: 3, roadWidth: 6, roadName: "" },
  radius: { rings: [{ distance: 100 }, { distance: 250 }, { distance: 500 }], ringColor: "#00CED1" },
};

// ─── MapWorkspaceInner — consumes WorkspaceContext ────────────────────────────
function MapWorkspaceInner() {
  const mapsReady = useGoogleMapsReady();
  const mapOptions = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  // Tracks the actual live google.maps.Map object (not just "is one ready").
  // In dev, React.StrictMode mounts GoogleMap twice, producing two distinct
  // Map instances while mapReady only ever flips false→true once — so
  // anything gated purely on `mapReady` can silently bind to the first,
  // since-discarded instance. Keeping the instance itself in state lets the
  // manager-setup effects below re-run and re-parent whenever it changes.
  const [mapInstance, setMapInstance] = useState(null);

  const {
    project, commitProject, pushThunk,
    undo, redo,
    activeTool, setActiveTool,
    activeLandmarkTool, setActiveLandmarkTool,
    selectedPolygonEntry, setSelectedPolygonEntry,
    selectedFloorPlanId, setSelectedFloorPlanId,
    selectedLayerItemId, setSelectedLayerItemId,
    openFloorPlanFolderId,
    selectedRoadEntry, setSelectedRoadEntry,
    roadPopupPos, setRoadPopupPos,
    floorPlanMode,
    gcpPoints, setGCPPoints,
    pendingImgPt, setPendingImgPt,
    polygonManagerRef,
    pinManagerRef,
    floorPlanManagerRef,
    isDrawingInProgressRef,
    activeLayerId, setActiveLayerId,
    isAutoPlotReviewMode,
    confirmAutoPlotUnits,
    cancelAutoPlotUnits,
  } = useWorkspace();

  const [tick, setTick] = useState(0);

  const lastSelectedPolygonIdRef = useRef(null);
  const lastSelectedFloorPlanIdRef = useRef(null);
  const lastSelectedPinIdRef = useRef(null);

  // Mirrors context's openFloorPlanFolderId — the floorplan whose folder
  // dropdown is CURRENTLY open in the Layers panel (null if none is open).
  const openFloorPlanFolderIdRef = useRef(openFloorPlanFolderId);
  useEffect(() => { openFloorPlanFolderIdRef.current = openFloorPlanFolderId; }, [openFloorPlanFolderId]);

  const activeLayerIdRef = useRef(activeLayerId);
  const selectedLayerItemIdRef = useRef(selectedLayerItemId);
  useEffect(() => { activeLayerIdRef.current = activeLayerId; }, [activeLayerId]);
  useEffect(() => { selectedLayerItemIdRef.current = selectedLayerItemId; }, [selectedLayerItemId]);
  useEffect(() => {
    if (!selectedLayerItemId) return;
    const match = /^(?:folder|plots)-(.+)$/.exec(selectedLayerItemId);
    if (match) {
      const fpId = match[1];
      const stillExists = floorPlanManagerRef.current?.getState().some(f => f.id === fpId);
      if (stillExists) lastLayersPanelFloorPlanIdRef.current = fpId;
    }
  }, [selectedLayerItemId, floorPlanManagerRef]);

  const activeLayerColor = project.layers?.find(l => l.id === activeLayerId)?.color || '#00CED1';

  const [polygonPopupPos, setPolygonPopupPos] = useState(null);
  const [polygonIsEditing, setPolygonIsEditing] = useState(false);
  const [polygonMetricsNow, setPolygonMetricsNow] = useState(null); // { area, perimeter } in meters
  const [coordsCopied, setCoordsCopied] = useState(false);

  // Naming/classification modal shown right after a polygon is closed —
  // nothing is committed to the map until the user confirms it here.
  const [pendingPolygon, setPendingPolygon] = useState(null); // { path: LatLng[] }
  const [pendingName, setPendingName] = useState('');
  const [pendingCategory, setPendingCategory] = useState('project');

  // Road naming modal — same pattern as polygon
  const [pendingRoad, setPendingRoad] = useState(null); // { path: [{lat,lng}...] }
  const [pendingRoadName, setPendingRoadName] = useState('');
  const [pendingRoadCategory, setPendingRoadCategory] = useState('Road'); // 'Road' | 'Bridge'

  const [selectedPinEntry, setSelectedPinEntry] = useState(null);
  const [pinPopupPos, setPinPopupPos] = useState(null);
  const [pinIsEditing, setPinIsEditing] = useState(false);
  const [pinCoordsCopied, setPinCoordsCopied] = useState(false);
  const baseTool = activeTool?.includes('-') ? activeTool.split('-').slice(1).join('-') : activeTool;

  const [sliderBeforeStates, setSliderBeforeStates] = useState({});

  const handleSliderDown = (field) => {
    if (selectedPolygonEntry) {
      setSliderBeforeStates(prev => ({ ...prev, [field]: selectedPolygonEntry[field] }));
    }
  };

  const handleSliderUp = (field, finalValue) => {
    if (selectedPolygonEntry && polygonManagerRef.current) {
      const before = sliderBeforeStates[field];
      polygonManagerRef.current.commitStyleChange(selectedPolygonEntry.id, field, before, finalValue);
    }
  };

  // Same drag-start/drag-end pattern as the polygon sliders above, applied to
  // a pin's custom size — setCustomSizeLive updates continuously while
  // dragging (no history spam), commitCustomSize pushes one undo step on release.
  const [pinSizeBefore, setPinSizeBefore] = useState(1);
  const handlePinSizeDown = () => {
    if (selectedPinEntry) setPinSizeBefore(selectedPinEntry.customSize ?? 1);
  };
  const handlePinSizeUp = (finalValue) => {
    if (selectedPinEntry && pinManagerRef.current) {
      pinManagerRef.current.commitCustomSize(selectedPinEntry.id, pinSizeBefore, finalValue);
    }
  };

  // Tool-specific drawing properties (not stored in history)
  const [toolProps, setToolProps] = useState(DEFAULT_TOOL_PROPS);
  const toolPropsRef = useRef(toolProps);
  useEffect(() => { toolPropsRef.current = toolProps; }, [toolProps]);

  // ── In-progress drawing state ───────────────────────────────────────────────
  const [inProgressPoints, setInProgressPoints] = useState([]);
  const [radiusCenter, setRadiusCenter] = useState(null);
  const [radiusRings, setRadiusRings] = useState([]);   // distances[]

  // Refs that mirror state so event-listener closures are never stale
  const inProgressRef = useRef([]);
  const radCenterRef = useRef(null);
  const radRingsRef = useRef([]);
  const activeToolRef = useRef(null);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  // ── Imperative overlay refs ─────────────────────────────────────────────────
  const featureOverlaysRef = useRef({ polygons: [], pins: [], roads: [], radii: [], floorPlans: [] });
  const previewLineRef = useRef(null);   // in-progress polyline
  const previewDotsRef = useRef([]);     // vertex dots
  const previewCirclesRef = useRef([]);     // radius circles
  const mapListenersRef = useRef([]);
  const polyCleanupRef = useRef(null); // cleanup fn for in-progress polygon draw visuals
  const roadCleanupRef = useRef(null); // cleanup fn for in-progress road draw visuals
  // Called from keyboard handler to finish an in-progress road drawing
  const finishRoadRef = useRef(null);
  // When non-null, road drawing appends to this existing road's points array
  const extendingRoadIdRef = useRef(null);

  // Floor plan file input
  const floorFileRef = useRef(null);
  const floorClickRef = useRef(null);  // lat/lng where user clicked for floor plan

  // ── Instantiate PolygonManager ──────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;
    if (!polygonManagerRef.current) {
      polygonManagerRef.current = new PolygonManager(mapRef.current, {
        onSelect: (entry, latLng) => {
          if (entry && (entry.category === 'road' || entry.category === 'bridge')) {
            setSelectedRoadEntry(entry);
            setSelectedLayerItemId(entry.id);
            pinManagerRef.current?.deselect();
            floorPlanManagerRef.current?.onSelect(null);
            setSelectedPolygonEntry(null);
            setPolygonPopupPos(null);
            setPolygonMetricsNow(null);
            const isNewSelection = entry.id !== lastSelectedPolygonIdRef.current;
            lastSelectedPolygonIdRef.current = entry.id;

            if (isNewSelection && mapRef.current && window.google?.maps) {
              const bounds = new window.google.maps.LatLngBounds();
              entry.gPolygon.getPath().forEach(p => bounds.extend(p));
              focusOnBounds(mapRef.current, bounds);
            }
            if (latLng) setRoadPopupPos(latLng);
            return;
          }

          setSelectedPolygonEntry(entry);
          setSelectedLayerItemId(entry ? entry.id : null);
          if (!entry) {
            // Explicit deselect — close popup and clear its readouts.
            setPolygonPopupPos(null);
            setPolygonMetricsNow(null);
            setCoordsCopied(false);
            lastSelectedPolygonIdRef.current = null;
            return;
          }

          // Deselect others to guarantee single active selection globally
          pinManagerRef.current?.deselect();
          floorPlanManagerRef.current?.onSelect(null);
          setSelectedRoadEntry(null);
          setRoadPopupPos(null);

          const isNewSelection = entry.id !== lastSelectedPolygonIdRef.current;
          lastSelectedPolygonIdRef.current = entry.id;

          if (isNewSelection && mapRef.current && window.google?.maps) {
            const bounds = new window.google.maps.LatLngBounds();
            entry.gPolygon.getPath().forEach(p => bounds.extend(p));
            focusOnBounds(mapRef.current, bounds);
          }

          // Only reposition the popup when a real click coordinate is given
          // (fresh selection or a vertex drag). Rename keystrokes call
          // onSelect with no latLng specifically so the popup stays put
          // instead of disappearing while the user types.
          if (latLng) setPolygonPopupPos(latLng);
          setPolygonMetricsNow(polygonManagerRef.current?.metrics(entry.id) ?? null);
        },
        onEditToggle: (entry, isEditing) => {
          setPolygonIsEditing(isEditing);
        },
        onChange: () => {
          setTick(t => t + 1);
        },
        pushHistory: pushThunk,
        getActiveTool: () => activeToolRef.current,
      });
    } else if (polygonManagerRef.current.map !== mapRef.current) {
      polygonManagerRef.current.map = mapRef.current;
      polygonManagerRef.current.polygons.forEach((entry) => {
        entry.gPolygon.setMap(mapRef.current);
      });
    }
  }, [mapReady, mapInstance, pushThunk, setSelectedPolygonEntry, polygonManagerRef]);

  // ── Instantiate PinManager ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;
    if (!pinManagerRef.current) {
      pinManagerRef.current = new PinManager(mapRef.current, {
        onSelect: (entry, latLng) => {
          setSelectedPinEntry(entry);
          setSelectedLayerItemId(entry ? entry.id : null);
          if (!entry) {
            setPinPopupPos(null);
            setPinCoordsCopied(false);
            lastSelectedPinIdRef.current = null;
            return;
          }

          // Deselect others to guarantee single active selection globally
          polygonManagerRef.current?.deselect();
          floorPlanManagerRef.current?.onSelect(null);
          setSelectedRoadEntry(null);
          setRoadPopupPos(null);

          const isNewSelection = entry.id !== lastSelectedPinIdRef.current;
          lastSelectedPinIdRef.current = entry.id;

          if (isNewSelection && mapRef.current && window.google?.maps) {
            const bounds = new window.google.maps.LatLngBounds();
            bounds.extend(entry.position);
            focusOnBounds(mapRef.current, bounds);
          }

          if (latLng) setPinPopupPos(latLng); // no latLng on rename keystrokes — popup stays put
        },
        onEditToggle: (entry, isEditing) => {
          setPinIsEditing(isEditing);
        },
        onChange: () => { setTick(t => t + 1); },
        onPinPlaced: () => setActiveTool(null),
        pushHistory: pushThunk,
        getActiveTool: () => activeToolRef.current,
      });
    } else if (pinManagerRef.current.map !== mapRef.current) {
      pinManagerRef.current.map = mapRef.current;
      pinManagerRef.current.pins.forEach((entry) => entry.marker.setMap(mapRef.current));
    }
  }, [mapReady, mapInstance, pushThunk, pinManagerRef]);

  // ── Instantiate FloorPlanManager ─────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return;
    if (!floorPlanManagerRef.current) {
      floorPlanManagerRef.current = new FloorPlanManager(mapRef.current, {
        onSelect: (id) => {
          setSelectedFloorPlanId(id);
          setSelectedLayerItemId(id || null);

          if (id) {
            // Deselect others to guarantee single active selection globally
            polygonManagerRef.current?.deselect();
            pinManagerRef.current?.deselect();
            setSelectedRoadEntry(null);
            setRoadPopupPos(null);
          }

          const isNewSelection = id !== lastSelectedFloorPlanIdRef.current;
          lastSelectedFloorPlanIdRef.current = id || null;

          if (isNewSelection && id && floorPlanManagerRef.current && mapRef.current && window.google?.maps) {
            const entry = floorPlanManagerRef.current.overlays.get(id);
            // Only auto-focus if it is locked. If it is unlocked, the user is likely
            // clicking it to drag/resize, and moving the map mid-drag breaks the math.
            if (entry && entry.overlay.isLocked) {
              const b = floorPlanManagerRef.current.computeBounds(entry.overlay);
              const bounds = new window.google.maps.LatLngBounds(b.sw, b.ne);
              focusOnBounds(mapRef.current, bounds);
            }
          }
        },
        onChange: () => { setTick(t => t + 1); },
        // Deleting a floorplan (from anywhere — the Layers panel's folder
        // menu, or the bottom edit panel's Delete button) removes ONLY the
        // image/overlay itself. It intentionally does NOT cascade-delete the
        // boundary, plots, or pins tied to it: the Layers panel's "Delete
        // floor plan" already explicitly removes those itself (as part of
        // its own combined undo step) when that's really what's wanted, and
        // the bottom panel's Delete is meant to remove just the picture so
        // a new one can be added back into the same folder.
        onDelete: () => { setTick(t => t + 1); },
        pushHistory: pushThunk,
        getActiveTool: () => activeToolRef.current,
        // Auto-plot the boundary polygon from the floorplan's own traced
        // outline the moment it's locked — one polygon per floorplan,
        // re-used (path updated in place) if it's unlocked/relocked again.
        onLock: (id, latLngPath) => {
          const pm = polygonManagerRef.current;
          if (!pm || !window.google?.maps) return;
          const path = latLngPath.map(
            (c) => new window.google.maps.LatLng(c.lat, c.lng)
          );
          const polyId = `floorplan-boundary-${id}`;
          const fp = floorPlanManagerRef.current?.getState().find(f => f.id === id);
          const fpName = fp && fp.name ? `${fp.name} Boundary` : 'Floorplan Boundary';

          if (pm.polygons.has(polyId)) {
            const entry = pm.polygons.get(polyId);
            entry.gPolygon.setPath(path);
            entry.name = fpName;
            entry.gPolygon.setOptions({ zIndex: ++pm.zCounter }); // bring to front on re-lock
            pm.callbacks.onChange && pm.callbacks.onChange();
            return;
          }
          pm.createPolygon(polyId, fpName, path, 'project', activeLayerIdRef.current, '#00ff00', { floorPlanId: id });
          pushThunk({
            undo: () => pm.deletePolygon(polyId, true),
            redo: () => pm.createPolygon(polyId, fpName, [...path], 'project', activeLayerIdRef.current, '#00ff00', { floorPlanId: id }),
          });
        },
      });
      // Initial load from project
      project.floorPlans.forEach(fp => floorPlanManagerRef.current.loadFloorPlan(fp.id, fp));
    } else if (floorPlanManagerRef.current.map !== mapRef.current) {
      floorPlanManagerRef.current.map = mapRef.current;
      floorPlanManagerRef.current.overlays.forEach((entry) => {
        entry.overlay.setMap(mapRef.current);
      });
    }
  }, [mapReady, mapInstance, pushThunk, setSelectedFloorPlanId, floorPlanManagerRef, project.floorPlans]);

  // Sync floorPlanMode to FloorPlanManager
  useEffect(() => {
    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.setMode(floorPlanMode);
    }
  }, [floorPlanMode, floorPlanManagerRef]);


  // ── Build map options once ──────────────────────────────────────────────────
  if (mapsReady && !mapOptions.current) {
    mapOptions.current = buildMapOptions();
  }

  // ── onMapLoad ───────────────────────────────────────────────────────────────
  const onMapLoad = useCallback((m) => {
    mapRef.current = m;
    setMapInstance(m);
    setMapReady(true);
  }, []);

  // ── Cancel helper — clears in-progress drawing ──────────────────────────────
  const clearPreview = useCallback(() => {
    if (previewLineRef.current) { previewLineRef.current.setMap(null); previewLineRef.current = null; }
    previewDotsRef.current.forEach((o) => o.setMap(null)); previewDotsRef.current = [];
    previewCirclesRef.current.forEach((o) => o.setMap(null)); previewCirclesRef.current = [];
  }, []);
  const cancelDrawing = useCallback(() => {
    inProgressRef.current = [];
    setInProgressPoints([]);
    radCenterRef.current = null;
    setRadiusCenter(null);
    radRingsRef.current = [];
    setRadiusRings([]);
    // Polygon drawing visuals are cleaned up via the effect's return function
  }, []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        if (pendingPolygon) { setPendingPolygon(null); return; }
        if (pendingRoad) { setPendingRoad(null); return; }
        // Also cancel any in-progress road extend
        extendingRoadIdRef.current = null;
        cancelDrawing();
        setActiveTool(null);
        return;
      }
      // Enter key finishes an in-progress road draw
      if (e.key === 'Enter') {
        const tool = activeToolRef.current;
        const baseTl = tool?.includes('-') ? tool.split('-').slice(1).join('-') : tool;
        if (baseTl === 'road' && finishRoadRef.current) {
          e.preventDefault();
          finishRoadRef.current();
          return;
        }
      }
      if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); return; }
      if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); redo(); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && polygonManagerRef.current) {
        polygonManagerRef.current.handleDeleteKey(e);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [cancelDrawing, setActiveTool, undo, redo, pendingPolygon, pendingRoad]);

  // ── Commit functions (use refs internally for non-stale access in listeners) ─

  const commitRadius = useCallback((center, rings) => {
    const p = toolPropsRef.current.radius;
    commitProject((proj) => ({
      ...proj,
      radii: [...proj.radii, {
        id: nextId("radius"), center,
        rings: rings.map((d) => ({ distance: d })),
        ringColor: p.ringColor || "#00CED1",
      }],
    }));
  }, [commitProject]);

  const commitRoad = useCallback((points, name, category, layerId) => {
    const p = toolPropsRef.current.road;
    const roadId = nextId("road");
    const path = points.map(pt => new window.google.maps.LatLng(pt.lat, pt.lng));
    polygonManagerRef.current?.createPolygon(
      roadId,
      name || 'Road',
      path,
      'road',
      layerId || activeLayerIdRef.current || 'layer-1',
      p.lineColor || "#FF9800",
      {},
      { strokeWeight: p.lineWidth || 3 }
    );
    return roadId;
  }, []);

  // Keep stable refs to commit fns so drawing-effect closures never go stale
  const commitRoadRef = useRef(commitRoad);
  const commitRadiusRef = useRef(commitRadius);
  useEffect(() => { commitRoadRef.current = commitRoad; }, [commitRoad]);
  useEffect(() => { commitRadiusRef.current = commitRadius; }, [commitRadius]);

  // ── Road naming/classification modal ────────────────────────────────────────
  // Mirrors the polygon beginNaming / confirmPendingPolygon pattern exactly.
  const beginRoadNaming = useCallback((path) => {
    const roads = polygonManagerRef.current?.getState()?.roads || [];
    const count = roads.length + 1;
    setPendingRoadName(`Road ${count}`);
    setPendingRoadCategory('Road');
    setPendingRoad({ path });
    setActiveTool(null);
  }, [setActiveTool]);

  const beginRoadNamingRef = useRef(beginRoadNaming);
  useEffect(() => { beginRoadNamingRef.current = beginRoadNaming; }, [beginRoadNaming]);

  const confirmPendingRoad = useCallback(() => {
    if (!pendingRoad) return;
    const p = toolPropsRef.current.road;
    const newId = nextId('road');
    const layerId = activeLayerIdRef.current || 'layer-1';

    if (polygonManagerRef.current) {
      polygonManagerRef.current.createPolygon(
        newId,
        pendingRoadName.trim() || 'Road',
        pendingRoad.path,
        pendingRoadCategory === 'Bridge' ? 'bridge' : 'road',
        layerId,
        p.lineColor || '#FF9800',
        {},
        { strokeWeight: p.lineWidth || 3 }
      );
      polygonManagerRef.current.callbacks.onChange();
      polygonManagerRef.current.select(newId);
    }

    setPendingRoad(null);
  }, [pendingRoad, pendingRoadName, pendingRoadCategory]);

  const cancelPendingRoad = useCallback(() => {
    setPendingRoad(null);
  }, []);

  // ── Polygon naming/classification modal ─────────────────────────────────────
  // A closed polygon path is held here uncommitted until the user names it and
  // picks Landmark/Project — nothing is drawn as a real, selectable polygon
  // (and it never becomes editable) until "Done" is pressed.

  // Determines which floorplan a new "unit" polygon would currently be routed
  // to: an explicitly selected floorplan folder/Plots folder wins; otherwise
  // fall back to whichever floorplan folder is currently OPEN (expanded) in
  // the Layers panel; otherwise null (goes to global storage).
  const resolveUnitFloorPlanId = useCallback(() => {
    const selectedItem = selectedLayerItemIdRef.current;
    if (selectedItem) {
      const match = /^(?:folder|plots)-(.+)$/.exec(selectedItem);
      if (match) {
        const fpId = match[1];
        const exists = floorPlanManagerRef.current?.getState().some(f => f.id === fpId);
        if (exists) return fpId;
      }
    }
    const openFpId = openFloorPlanFolderIdRef.current;
    const openFpExists = openFpId && floorPlanManagerRef.current?.getState().some(f => f.id === openFpId);
    return openFpExists ? openFpId : null;
  }, [floorPlanManagerRef]);

  // Computes the next auto-generated unit/plot name: a plain number
  // continuing that floorplan's own Plots-folder sequence, or "Unit N"
  // counting only floorplan-less units when floorPlanId is null (global).
  const computeNextUnitName = useCallback((floorPlanId) => {
    const pm = polygonManagerRef.current;
    const polys = pm ? Array.from(pm.polygons.values()) : [];
    if (floorPlanId) {
      const samePlotFloorPlan = polys.filter(p => (p.category === 'unit' || p.category === 'pending-unit') && p.metadata?.floorPlanId === floorPlanId);
      const highestPlotNo = samePlotFloorPlan.reduce((max, p) => {
        const n = parseInt(p.name, 10);
        const isPlainNumber = !isNaN(n) && n.toString() === (p.name || '').trim();
        return isPlainNumber && n > max ? n : max;
      }, 0);
      const nextNo = highestPlotNo > 0 || samePlotFloorPlan.length === 0
        ? highestPlotNo + 1
        : samePlotFloorPlan.length + 1;
      return `${nextNo}`;
    }
    const globalUnits = polys.filter(p => (p.category === 'unit' || p.category === 'pending-unit') && !p.metadata?.floorPlanId);
    return `Unit ${globalUnits.length + 1}`;
  }, [polygonManagerRef]);

  const beginNaming = useCallback((path) => {
    let defaultCat = 'project';
    if (isAutoPlotReviewMode) {
      defaultCat = 'pending-unit';
    } else {
      const selectedItem = selectedLayerItemIdRef.current;
      if (selectedItem) {
        if (selectedItem === 'landmarks') {
          defaultCat = 'landmark';
        } else if (selectedItem.startsWith('plots-')) {
          defaultCat = 'unit';
        }
      }
    }

    const pm = polygonManagerRef.current;
    let count = 1;
    let defaultName = `Boundary ${count}`;

    if (defaultCat === 'landmark') {
      const polys = pm ? Array.from(pm.polygons.values()) : [];
      count = polys.filter(p => p.category === 'landmark').length + 1;
      defaultName = `Landmark ${count}`;
    } else if (defaultCat === 'unit' || defaultCat === 'pending-unit') {
      defaultName = computeNextUnitName(resolveUnitFloorPlanId());
    } else {
      const polys = pm ? Array.from(pm.polygons.values()) : [];
      count = polys.filter(p => p.category !== 'landmark' && p.category !== 'unit' && p.category !== 'pending-unit').length + 1;
      defaultName = `Boundary ${count}`;
    }

    setPendingName(defaultName);
    setPendingCategory(defaultCat);
    setPendingPolygon({ path });
    setActiveTool(null);
  }, [setActiveTool, polygonManagerRef, isAutoPlotReviewMode, computeNextUnitName, resolveUnitFloorPlanId]);

  const beginNamingRef = useRef(beginNaming);
  useEffect(() => { beginNamingRef.current = beginNaming; }, [beginNaming]);

  const confirmPendingPolygon = useCallback(() => {
    const pm = polygonManagerRef.current;
    if (!pendingPolygon || !pm) return;
    const id = nextId('poly');
    const category = pendingCategory;
    const path = pendingPolygon.path;

    let targetLayerId = activeLayerIdRef.current;
    let targetCategory = category;
    let targetMetadata = {};

    // Route based on selected folder/layer
    const selectedItem = selectedLayerItemIdRef.current;

    let selectedFloorplanFolder = false;
    let floorplanExists = false;

    if (selectedItem) {
      if (selectedItem.startsWith('folder-') || selectedItem.startsWith('plots-')) {
        const fpId = selectedItem.replace(/^(folder|plots)-/, '');
        const fp = floorPlanManagerRef.current?.getState().find(f => f.id === fpId);
        if (fp) {
          selectedFloorplanFolder = true;
          floorplanExists = true;
          targetLayerId = fp.layerId || targetLayerId;
          targetMetadata = { floorPlanId: fpId };
        }
      } else if (selectedItem === 'landmarks') {
        targetCategory = 'landmark';
      } else if (selectedItem.startsWith('layer-')) {
        targetLayerId = selectedItem;
      }
    }

    let finalColor = activeLayerColor;
    if (targetCategory === 'landmark') {
      finalColor = '#8B5CF6'; // predefined purple for all landmark polygons
    } else if (category === 'unit' || category === 'pending-unit') {
      finalColor = '#ff6b6b';

      if (category === 'unit') {
        if (selectedFloorplanFolder && floorplanExists) {
          // targetMetadata already has floorPlanId from the routing block above
        } else {
          // No floorplan folder is directly selected right now — fall back to
          // whichever floorplan folder is CURRENTLY OPEN (expanded) in the
          // Layers panel. If none is open, the unit is stored globally.
          const openFpId = openFloorPlanFolderIdRef.current;
          const openFpStillExists = openFpId && floorPlanManagerRef.current?.getState().some(f => f.id === openFpId);
          if (openFpStillExists) {
            targetMetadata.floorPlanId = openFpId;
          } else {
            delete targetMetadata.floorPlanId;
          }
        }
      } else {
        // Fallback for pending-unit to preserve old behavior
        if (!targetMetadata.floorPlanId && selectedFloorPlanId) {
          targetMetadata = { floorPlanId: selectedFloorPlanId };
        }
      }
    } else if (category === 'pending-unit' && selectedFloorPlanId) {
      // Keep legacy logic just in case
      targetMetadata = { floorPlanId: selectedFloorPlanId };
    }

    // Determine default/fallback name. For units, number continues from the
    // specific floorplan's own Plots folder (not a project-wide count), so
    // each floorplan keeps its own independent 1, 2, 3... sequence.
    const polys = Array.from(pm.polygons.values());
    let count = 1;
    let fallbackName = `Boundary ${count}`;

    if (category === 'landmark') {
      count = polys.filter(p => p.category === 'landmark').length + 1;
      fallbackName = `Landmark ${count}`;
    } else if (category === 'unit' || category === 'pending-unit') {
      fallbackName = computeNextUnitName(targetMetadata.floorPlanId || null);
    } else {
      count = polys.filter(p => p.category !== 'landmark' && p.category !== 'unit' && p.category !== 'pending-unit').length + 1;
      fallbackName = `Boundary ${count}`;
    }

    const name = pendingName.trim() || fallbackName;

    // Uniform Style Override
    let targetContainerId = null;
    if (targetMetadata.floorPlanId) {
      if (category === 'unit' || category === 'pending-unit') {
        targetContainerId = `plots-${targetMetadata.floorPlanId}`;
      } else {
        targetContainerId = `folder-${targetMetadata.floorPlanId}`;
      }
    } else if (selectedItem && selectedItem.startsWith('layer-')) {
      targetContainerId = selectedItem;
    } else if (targetLayerId) {
      targetContainerId = targetLayerId;
    }

    if (targetContainerId) {
      if (targetContainerId.startsWith('plots-') || targetContainerId.startsWith('folder-')) {
        const settings = project?.folderSettings?.[targetContainerId];
        if (settings && settings.styleMode === 'uniform' && settings.color) {
          finalColor = settings.color;
        }
      } else if (targetContainerId.startsWith('layer-')) {
        const layer = project?.layers?.find(l => l.id === targetContainerId);
        if (layer && layer.styleMode === 'uniform' && layer.color) {
          finalColor = layer.color;
        }
      }
    }

    try {
      pm.createPolygon(id, name, path, targetCategory, targetLayerId, finalColor, targetMetadata);
      pm.callbacks.pushHistory && pm.callbacks.pushHistory({
        undo: () => pm.deletePolygon(id, true),
        redo: () => pm.createPolygon(id, name, [...path], targetCategory, targetLayerId, finalColor, targetMetadata),
      });
      pm.callbacks.onChange && pm.callbacks.onChange();
      pm.select(id); // selects the popup only — polygon stays non-editable
    } catch (err) {
      console.error('Polygon create error:', err);
    }
    setPendingPolygon(null);
  }, [pendingPolygon, pendingName, pendingCategory, polygonManagerRef, selectedFloorPlanId, project, computeNextUnitName]);

  const cancelPendingPolygon = useCallback(() => {
    setPendingPolygon(null);
  }, []);

  const handlePendingCategoryChange = useCallback((newCat) => {
    const pm = polygonManagerRef.current;
    const polys = pm ? Array.from(pm.polygons.values()) : [];

    const isUnchangedBoundary = /^Boundary \d+$/.test(pendingName);
    const isUnchangedLandmark = /^Landmark \d+$/.test(pendingName);
    const isUnchangedUnit = /^Unit \d+$/.test(pendingName);
    const isUnchangedPlotNumber = /^\d+$/.test(pendingName.trim());

    if (isUnchangedBoundary || isUnchangedLandmark || isUnchangedUnit || isUnchangedPlotNumber || pendingName.trim() === '') {
      let nextName;
      if (newCat === 'landmark') {
        const count = polys.filter(p => p.category === 'landmark').length + 1;
        nextName = `Landmark ${count}`;
      } else if (newCat === 'unit' || newCat === 'pending-unit') {
        nextName = computeNextUnitName(resolveUnitFloorPlanId());
      } else {
        const count = polys.filter(p => p.category !== 'landmark' && p.category !== 'unit' && p.category !== 'pending-unit').length + 1;
        nextName = `Boundary ${count}`;
      }
      setPendingName(nextName);
    }
    setPendingCategory(newCat);
  }, [pendingName, polygonManagerRef, computeNextUnitName, resolveUnitFloorPlanId]);

  // ── Wire map interaction per active tool ────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;

    // Remove previous listeners
    mapListenersRef.current.forEach((l) => window.google.maps.event.removeListener(l));
    mapListenersRef.current = [];
    cancelDrawing();
    clearPreview();

    // Disable FloorPlan DOM pointer events while drawing so clicks pass down to map
    const isDrawing = activeTool !== null;
    if (floorPlanManagerRef.current) floorPlanManagerRef.current.setAllPointerEvents(!isDrawing);

    if (!activeTool || baseTool === "grid") {
      if (floorPlanMode !== 'gcp') {
        map.setOptions({ draggableCursor: "", disableDoubleClickZoom: false });
        return;
      }
    }

    map.setOptions({
      draggableCursor: baseTool === "floor-plan" ? "pointer" : (floorPlanMode === 'gcp' ? "crosshair" : "crosshair"),
      disableDoubleClickZoom: ["polygon", "road", "radius"].includes(baseTool) || floorPlanMode === 'gcp',
    });

    const ls = [];
    // 220ms timer separates single-click from double-click
    let timer = null;

    // ── GCP Mode Map Click Handler ──────────────────────────────────────────
    if (floorPlanMode === 'gcp') {
      ls.push(map.addListener("click", (e) => {
        if (pendingImgPt) {
          setGCPPoints(pts => [...pts, {
            id: Date.now().toString(),
            img: pendingImgPt,
            map: { lat: e.latLng.lat(), lng: e.latLng.lng() }
          }]);
          setPendingImgPt(null);
        }
      }));
    }

    // ── Pin ────────────────────────────────────────────────────────────────
    if (baseTool === "pin") {
      let targetLayerId = activeLayerIdRef.current;
      let targetMetadata = {};
      const selectedItem = selectedLayerItemIdRef.current;
      if (selectedItem) {
        if (selectedItem.startsWith('folder-') || selectedItem.startsWith('plots-')) {
          const fpId = selectedItem.replace(/^(folder|plots)-/, '');
          const fp = floorPlanManagerRef.current?.getState().find(f => f.id === fpId);
          if (fp) {
            targetLayerId = fp.layerId || targetLayerId;
            targetMetadata = { floorPlanId: fpId };
          }
        } else if (selectedItem.startsWith('layer-')) {
          targetLayerId = selectedItem;
        }
      }
      let finalColor = activeLayerColor;
      let targetContainerId = null;

      if (targetMetadata.floorPlanId) {
        targetContainerId = `folder-${targetMetadata.floorPlanId}`;
      } else if (selectedItem && selectedItem.startsWith('layer-')) {
        targetContainerId = selectedItem;
      } else if (targetLayerId) {
        targetContainerId = targetLayerId;
      }

      if (targetContainerId) {
        if (targetContainerId.startsWith('folder-')) {
          const settings = project?.folderSettings?.[targetContainerId];
          if (settings && settings.styleMode === 'uniform' && settings.color) {
            finalColor = settings.color;
          }
        } else if (targetContainerId.startsWith('layer-')) {
          const layer = project?.layers?.find(l => l.id === targetContainerId);
          if (layer && layer.styleMode === 'uniform' && layer.color) {
            finalColor = layer.color;
          }
        }
      }

      pinManagerRef.current?.armPlacement(finalColor, targetLayerId, targetMetadata);
    }

    // ── Polygon ────────────────────────────────────────────────────────────
    else if (baseTool === "polygon") {
      const pm = polygonManagerRef.current;
      if (!pm) return;

      // Draw state
      let drawPath = [];
      let drawMarkers = [];
      let snapMode = false; // true when cursor is near first point

      // The live polyline that follows the cursor (rubber-band preview)
      let previewLine = new window.google.maps.Polyline({
        map,
        path: [],
        strokeColor: '#00d4ff',
        strokeWeight: 2,
        strokeOpacity: 0.55,
        zIndex: 50,
        clickable: false,
      });

      // The committed polyline connecting placed points
      let placedLine = new window.google.maps.Polyline({
        map,
        path: [],
        strokeColor: '#00d4ff',
        strokeWeight: 2.5,
        zIndex: 50,
        clickable: false,
      });

      map.setOptions({ draggableCursor: 'crosshair' });

      // Tracks the most recent cursor position from mousemove. Used to seed
      // the rubberband immediately after a click, instead of leaving it
      // collapsed to a single (invisible) point until the next mousemove
      // fires — fast clicking can skip/coalesce mousemove events entirely
      // between two clicks, which was making the rubberband disappear.
      let lastMousePos = null;

      // Helper: pixel distance between two LatLng on screen
      const screenDist = (a, b) => {
        const proj = map.getProjection();
        if (!proj) return Infinity;
        const scale = Math.pow(2, map.getZoom());
        const pa = proj.fromLatLngToPoint(a);
        const pb = proj.fromLatLngToPoint(b);
        return Math.sqrt(Math.pow((pa.x - pb.x) * scale, 2) + Math.pow((pa.y - pb.y) * scale, 2));
      };

      // First-point marker icon helpers
      const firstIcon = (snapping) => ({
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: snapping ? 12 : 8,
        fillColor: snapping ? '#ffffff' : '#00d4ff',
        fillOpacity: 1,
        strokeWeight: 2.5,
        strokeColor: snapping ? '#00d4ff' : '#ffffff',
      });

      const addPoint = (latLng) => {
        drawPath.push(latLng);
        isDrawingInProgressRef.current = true;
        placedLine.setPath(drawPath);

        const isFirst = drawMarkers.length === 0;
        const marker = new window.google.maps.Marker({
          position: latLng,
          map,
          icon: firstIcon(false),
          zIndex: 51,
          clickable: false,
        });
        drawMarkers.push(marker);

        // Seed the preview from the last known cursor position immediately —
        // don't wait for the next mousemove, which may not come right away.
        previewLine.setPath(drawPath.length >= 1 ? [latLng, lastMousePos || latLng] : []);
      };

      const finish = () => {
        previewLine.setMap(null);
        placedLine.setMap(null);
        drawMarkers.forEach((m) => m.setMap(null));
        if (drawPath.length >= 3) {
          // Nothing is created yet — hand the closed path off to the
          // naming/classification modal; it commits the real polygon.
          beginNamingRef.current([...drawPath]);
        }
        drawPath = [];
        drawMarkers = [];
        snapMode = false;
        isDrawingInProgressRef.current = false;
      };

      // Live rubber-band: update preview segment as mouse moves
      ls.push(map.addListener('mousemove', (e) => {
        lastMousePos = e.latLng;
        if (drawPath.length === 0) return;
        const cursor = e.latLng;
        previewLine.setPath([drawPath[drawPath.length - 1], cursor]);

        // Snap detection: check if cursor is near first point (after ≥3 placed)
        if (drawPath.length >= 3) {
          const dist = screenDist(cursor, drawPath[0]);
          const shouldSnap = dist < 14;
          if (shouldSnap !== snapMode) {
            snapMode = shouldSnap;
            if (drawMarkers[0]) drawMarkers[0].setIcon(firstIcon(snapMode));
            map.setOptions({ draggableCursor: snapMode ? 'pointer' : 'crosshair' });
          }
        }
      }));

      // Click: place a point, or close if snapping to first point.
      ls.push(map.addListener('click', (e) => {
        const pt = e.latLng;
        // Close polygon when clicking near first point (≥3 points already placed)
        if (snapMode && drawPath.length >= 3) {
          finish();
          return;
        }
        addPoint(pt);
      }));

      // Double-click still works as an alternative close gesture
      ls.push(map.addListener('dblclick', (e) => {
        e.stop && e.stop();
        finish();
      }));

      // Store cleanup for draw visuals so the effect return can call it
      polyCleanupRef.current = () => {
        previewLine.setMap(null);
        placedLine.setMap(null);
        drawMarkers.forEach((m) => m.setMap(null));
        drawPath = [];
        drawMarkers = [];
        snapMode = false;
        isDrawingInProgressRef.current = false;
      };
    }

    // ── Road ───────────────────────────────────────────────────────────────
    else if (baseTool === "road") {
      // --- Extend mode: append clicks to an existing road ---
      const extendId = extendingRoadIdRef.current;
      if (extendId) {
        let extendPreviewLine = new window.google.maps.Polyline({
          map, path: [], strokeColor: '#FF9800', strokeWeight: 3,
          strokeOpacity: 0.55, zIndex: 50, clickable: false,
        });
        let lastExtendPt = null;

        // Seed preview start from last point of the road being extended
        const existingEntry = polygonManagerRef.current?.polygons.get(extendId);
        if (existingEntry) {
          const path = existingEntry.gPolygon.getPath();
          if (path.getLength() > 0) {
            lastExtendPt = path.getAt(path.getLength() - 1);
          }
        }

        ls.push(map.addListener('mousemove', (e) => {
          if (!lastExtendPt) return;
          extendPreviewLine.setPath([lastExtendPt, e.latLng]);
        }));

        ls.push(map.addListener('click', (e) => {
          lastExtendPt = e.latLng;
          // Append to the road in polygon manager
          const entry = polygonManagerRef.current?.polygons.get(extendId);
          if (entry) {
            if (entry.takeSnapshot) entry.takeSnapshot();
            entry.gPolygon.getPath().push(e.latLng);
            polygonManagerRef.current?.callbacks.onChange?.();
            setSelectedRoadEntry({ ...entry });
          }
        }));

        // Double-click or Enter exits extend mode (Enter handled by keyboard effect)
        ls.push(map.addListener('dblclick', (e) => {
          e.stop && e.stop();
          extendPreviewLine.setMap(null);
          extendingRoadIdRef.current = null;
          setActiveTool(null);
        }));

        finishRoadRef.current = () => {
          extendPreviewLine.setMap(null);
          extendingRoadIdRef.current = null;
          setActiveTool(null);
        };

        roadCleanupRef.current = () => {
          extendPreviewLine.setMap(null);
        };
        // Register listeners and return cleanup explicitly (don't fall through to normal draw)
        mapListenersRef.current = ls;
        return () => {
          ls.forEach((l) => window.google.maps.event.removeListener(l));
          if (roadCleanupRef.current) { roadCleanupRef.current(); roadCleanupRef.current = null; }
          map.setOptions({ draggableCursor: '', disableDoubleClickZoom: false });
        };
      }

      // --- Normal draw mode: polygon-style rubber-band ---
      let drawPath = []; // [{lat,lng}]
      let drawMarkers = [];

      const roadColor = toolPropsRef.current.road.lineColor || '#FF9800';
      const roadWeight = toolPropsRef.current.road.lineWidth || 3;

      // Live rubber-band preview segment (follows cursor)
      let previewLine = new window.google.maps.Polyline({
        map, path: [], strokeColor: roadColor, strokeWeight: roadWeight,
        strokeOpacity: 0.55, zIndex: 50, clickable: false,
      });

      // Committed segment line (placed points)
      let placedLine = new window.google.maps.Polyline({
        map, path: [], strokeColor: roadColor, strokeWeight: roadWeight + 0.5,
        zIndex: 50, clickable: false,
      });

      map.setOptions({ draggableCursor: 'crosshair' });

      // Tracks the most recent cursor position so the rubberband can be
      // seeded immediately after a click, instead of sitting collapsed to a
      // single (invisible) point until the next mousemove fires — fast
      // clicking can skip mousemove events entirely between two clicks.
      let lastMousePos = null;

      const addPoint = (latLng) => {
        const pt = { lat: latLng.lat(), lng: latLng.lng() };
        drawPath.push(pt);
        isDrawingInProgressRef.current = true;
        placedLine.setPath(drawPath);
        const marker = new window.google.maps.Marker({
          position: latLng, map, clickable: false, zIndex: 51,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE, scale: 5,
            fillColor: roadColor, fillOpacity: 1,
            strokeColor: '#ffffff', strokeWeight: 1.5,
          },
        });
        drawMarkers.push(marker);
        // Seed the preview from the last known cursor position immediately.
        previewLine.setPath(drawPath.length >= 1 ? [pt, lastMousePos || pt] : []);
      };

      const finish = () => {
        previewLine.setMap(null);
        placedLine.setMap(null);
        drawMarkers.forEach((m) => m.setMap(null));
        finishRoadRef.current = null;
        if (drawPath.length >= 2) {
          beginRoadNamingRef.current([...drawPath]);
        }
        drawPath = [];
        drawMarkers = [];
        isDrawingInProgressRef.current = false;
      };

      // Register finish fn for Enter key
      finishRoadRef.current = finish;

      // Live rubber-band: update preview as mouse moves
      ls.push(map.addListener('mousemove', (e) => {
        lastMousePos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        if (drawPath.length === 0) return;
        previewLine.setPath([drawPath[drawPath.length - 1], lastMousePos]);
      }));

      // Click: add a point
      ls.push(map.addListener('click', (e) => {
        addPoint(e.latLng);
      }));

      // Double-click: finish drawing
      ls.push(map.addListener('dblclick', (e) => {
        e.stop && e.stop();
        finish();
      }));

      // Store cleanup for draw visuals so the effect return can call it
      roadCleanupRef.current = () => {
        previewLine.setMap(null);
        placedLine.setMap(null);
        drawMarkers.forEach((m) => m.setMap(null));
        drawPath = [];
        drawMarkers = [];
        finishRoadRef.current = null;
        isDrawingInProgressRef.current = false;
      };
    }

    // ── Radius ─────────────────────────────────────────────────────────────
    else if (baseTool === "radius") {
      ls.push(map.addListener("click", (e) => {
        const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          if (!radCenterRef.current) {
            radCenterRef.current = pt;
            setRadiusCenter(pt);
          } else {
            const d = Math.round(haversine(radCenterRef.current, pt));
            radRingsRef.current = [...radRingsRef.current, d];
            setRadiusRings([...radRingsRef.current]);
          }
        }, 220);
      }));
      ls.push(map.addListener("dblclick", () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (radCenterRef.current && radRingsRef.current.length >= 1) {
          commitRadiusRef.current(radCenterRef.current, [...radRingsRef.current]);
        }
        radCenterRef.current = null; setRadiusCenter(null);
        radRingsRef.current = []; setRadiusRings([]);
      }));
    }

    // ── Floor Plan ─────────────────────────────────────────────────────────
    else if (baseTool === "floor-plan") {
      ls.push(map.addListener("click", (e) => {
        floorClickRef.current = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        floorFileRef.current?.click();
      }));
    }

    mapListenersRef.current = ls;

    return () => {
      if (timer) clearTimeout(timer);
      ls.forEach((l) => window.google.maps.event.removeListener(l));
      if (polyCleanupRef.current) {
        polyCleanupRef.current();
        polyCleanupRef.current = null;
      }
      if (roadCleanupRef.current) {
        roadCleanupRef.current();
        roadCleanupRef.current = null;
      }
      pinManagerRef.current?.disarmPlacement();
      mapListenersRef.current = [];
      map.setOptions({ draggableCursor: "", disableDoubleClickZoom: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, activeTool, cancelDrawing, clearPreview, floorPlanMode, pendingImgPt, setGCPPoints, setPendingImgPt, activeLayerColor]);

  // ── Render committed features on the map ────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const GM = window.google.maps;

    // Clear all previous overlays
    Object.values(featureOverlaysRef.current).forEach((arr) => arr.forEach((o) => o.setMap(null)));
    featureOverlaysRef.current = { polygons: [], pins: [], roads: [], radii: [], floorPlans: [] };

    // Polygons are handled natively by PolygonManager now.

    // Roads — clickable so users can select them for editing
    project.roads.forEach((road) => {
      const isSelected = selectedRoadEntry?.id === road.id;
      const polyline = new GM.Polyline({
        path: road.points,
        strokeColor: road.lineColor || '#FF9800',
        strokeWeight: isSelected ? (road.lineWidth || 3) + 3 : (road.lineWidth || 3),
        strokeOpacity: 0.9,
        map,
        clickable: true,
        zIndex: isSelected ? 10 : 5,
      });
      polyline.addListener('click', (e) => {
        // Deselect polygon / pin / floorplan
        polygonManagerRef.current?.deselect();
        pinManagerRef.current?.deselect();
        floorPlanManagerRef.current?.onSelect(null);
        setSelectedRoadEntry(road);
        setRoadPopupPos({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      featureOverlaysRef.current.roads.push(polyline);
    });

    // Radii
    project.radii.forEach((radius) => {
      const color = radius.ringColor || "#00CED1";
      // Center dot
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
      // Rings
      radius.rings.forEach(({ distance }) => {
        featureOverlaysRef.current.radii.push(
          new GM.Circle({
            center: radius.center, radius: distance, map,
            strokeColor: color, strokeWeight: 2, strokeOpacity: 0.8,
            fillOpacity: 0, clickable: false,
          })
        );
      });
    });

    // Floor plans are now managed by FloorPlanManager natively, so no GM.GroundOverlay rendering here.


    return () => {
      Object.values(featureOverlaysRef.current).forEach((arr) => arr.forEach((o) => o.setMap(null)));
    };
  }, [mapReady, project, selectedRoadEntry]);

  // ── Sync layer visibility ──────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const layerVisibility = {};
    project.layers?.forEach(l => {
      layerVisibility[l.id] = l.visible !== false;
    });

    if (polygonManagerRef.current) {
      polygonManagerRef.current.polygons.forEach(entry => {
        const layerVisible = layerVisibility[entry.layerId || 'layer-1'];
        const itemVisible = entry.itemVisible !== false;
        const finalVisible = layerVisible && itemVisible;
        if (entry.gPolygon.getVisible() !== finalVisible) {
          entry.gPolygon.setVisible(finalVisible);
        }
      });
    }

    if (pinManagerRef.current) {
      pinManagerRef.current.pins.forEach(entry => {
        const layerVisible = layerVisibility[entry.layerId || 'layer-1'];
        const itemVisible = entry.itemVisible !== false;
        const finalVisible = layerVisible && itemVisible;
        if (entry.marker.getVisible() !== finalVisible) {
          entry.marker.setVisible(finalVisible);
        }
      });
    }

    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.overlays.forEach(entry => {
        const layerVisible = layerVisibility[entry.layerId || 'layer-1'];
        const itemVisible = entry.itemVisible !== false;
        const finalVisible = layerVisible && itemVisible;
        const currentMap = entry.overlay.getMap();
        if (finalVisible && !currentMap) {
          entry.overlay.setMap(mapRef.current);
        } else if (!finalVisible && currentMap) {
          entry.overlay.setMap(null);
        }
      });
    }
  }, [mapReady, project.layers, tick]);

  // ── Render in-progress preview overlays ────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current;
    if (!map || !window.google?.maps) return;
    const GM = window.google.maps;
    const tool = activeToolRef.current;

    clearPreview();

    // Road preview
    if (tool === "road" && inProgressPoints.length >= 1) {
      // Dashed preview line
      previewLineRef.current = new GM.Polyline({
        path: inProgressPoints,
        strokeColor: "#00CED1",
        strokeWeight: 2,
        strokeOpacity: 0.85,
        icons: [{
          icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 },
          offset: "0",
          repeat: "14px",
        }],
        map, clickable: false,
      });
      // Vertex dots
      inProgressPoints.forEach((pt) => {
        previewDotsRef.current.push(
          new GM.Marker({
            position: pt, map, clickable: false,
            icon: {
              path: GM.SymbolPath.CIRCLE, scale: 5,
              fillColor: "#00CED1", fillOpacity: 1,
              strokeColor: "#fff", strokeWeight: 1.5,
            },
          })
        );
      });
    }

    // Radius preview
    if (tool === "radius" && radiusCenter) {
      // Center marker
      previewCirclesRef.current.push(
        new GM.Marker({
          position: radiusCenter, map, clickable: false,
          icon: {
            path: GM.SymbolPath.CIRCLE, scale: 6,
            fillColor: "#00CED1", fillOpacity: 1,
            strokeColor: "#fff", strokeWeight: 2,
          },
        })
      );
      // Rings drawn so far
      radiusRings.forEach((dist) => {
        previewCirclesRef.current.push(
          new GM.Circle({
            center: radiusCenter, radius: dist, map, clickable: false,
            strokeColor: "#00CED1", strokeWeight: 2, strokeOpacity: 0.8,
            fillColor: "#00CED1", fillOpacity: 0.05,
          })
        );
      });
    }

    return () => { clearPreview(); };
  }, [mapReady, inProgressPoints, radiusCenter, radiusRings, clearPreview, activeTool]);

  // ── Handle pin image upload ─────────────────────────────────────────────────
  const handlePinImageFile = useCallback((e, pinId) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result) {
        pinManagerRef.current?.setStyle(pinId, 'custom', ev.target.result);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // ── Handle floor plan file selection ────────────────────────────────────────
  const handleFloorFile = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const center = floorClickRef.current ?? mapRef.current?.getCenter()?.toJSON() ?? DEFAULT_CENTER;

    // If the currently OPEN folder in the Layers panel is a floorplan folder
    // whose image was deleted (its boundary/plots/pins are still there, just
    // no picture), reuse that SAME floorPlanId instead of creating a new
    // one — so this image re-attaches to the existing folder/content rather
    // than starting a brand new, separate folder. Only applies when that
    // folder is still open and genuinely has no live image right now.
    const openFpId = openFloorPlanFolderIdRef.current;
    const reuseExistingFolder = openFpId && !floorPlanManagerRef.current?.overlays.has(openFpId);
    const id = reuseExistingFolder ? openFpId : nextId("fp");

    // Keep the re-added image on the SAME layer as the folder's existing
    // content, rather than wherever the toolbar's "active layer" happens to
    // be right now (which may have changed since the image was deleted).
    let targetLayerId = activeLayerIdRef.current;
    if (reuseExistingFolder) {
      const pm = polygonManagerRef.current;
      const pnm = pinManagerRef.current;
      const existingPoly = pm ? Array.from(pm.polygons.values()).find(p => p.metadata?.floorPlanId === openFpId) : null;
      const existingPin = pnm ? Array.from(pnm.pins.values()).find(p => p.metadata?.floorPlanId === openFpId) : null;
      targetLayerId = existingPoly?.layerId || existingPin?.layerId || targetLayerId;
    }

    let name = project?.folderSettings?.[`folder-${id}`]?.name;
    if (!name) {
      name = "Floor Plan";
      if (file.name) name = file.name.replace(/\.[^/.]+$/, "");
    }

    // Native pixel scale is defaulted to 1 map-meter per pixel.
    floorPlanManagerRef.current?.addFloorPlan(id, url, center, 1, 0, 1, null, targetLayerId, null, name).then(() => {
      setSelectedFloorPlanId(id);
      setActiveTool(null);
    });

    e.target.value = "";
  }, [floorPlanManagerRef, polygonManagerRef, pinManagerRef, setSelectedFloorPlanId, setActiveTool, project]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!mapsReady) return <LoadingScreen />;

  return (
    <div className={`mw-root ${floorPlanMode === 'gcp' ? 'mw-gcp-active' : ''}`}>
      {floorPlanMode === 'gcp' && <GCPSplitPanel />}

      <div className="mw-map-container">
        <GoogleMap
          mapContainerStyle={{ width: "100%", height: "100%" }}
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          onLoad={onMapLoad}
          options={mapOptions.current}
        >
          {/* Earth Pro-style Polygon Floating Context Popup */}
          {selectedPolygonEntry && polygonPopupPos && !polygonIsEditing && (
            <OverlayView
              position={polygonPopupPos}
              mapPaneName={OverlayView.FLOAT_PANE}
              getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -height - 15 })}
            >
              <div
                className="poly-popup"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="poly-popup-header">Polygon Properties</div>
                <input
                  className="poly-popup-input"
                  type="text"
                  value={selectedPolygonEntry.name}
                  onChange={(e) => polygonManagerRef.current?.rename(selectedPolygonEntry.id, e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Polygon Name"
                />
                <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                  <span className="poly-popup-cats-label">Category</span>
                  <div className="pp-cats">
                    <button
                      type="button"
                      className={`pp-cat${selectedPolygonEntry.category === 'project' ? ' pp-cat--active' : ''}`}
                      onClick={() => polygonManagerRef.current?.setCategory(selectedPolygonEntry.id, 'project')}
                    >
                      Project
                    </button>
                    <button
                      type="button"
                      className={`pp-cat${selectedPolygonEntry.category === 'landmark' ? ' pp-cat--active' : ''}`}
                      onClick={() => polygonManagerRef.current?.setCategory(selectedPolygonEntry.id, 'landmark')}
                    >
                      Landmark
                    </button>
                    <button
                      type="button"
                      className={`pp-cat${selectedPolygonEntry.category === 'unit' ? ' pp-cat--active' : ''}`}
                      onClick={() => polygonManagerRef.current?.setCategory(selectedPolygonEntry.id, 'unit')}
                    >
                      Unit
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Color</span>
                    <ColorPickerPopover
                      color={selectedPolygonEntry.color}
                      onChange={(c) => polygonManagerRef.current?.setColor(selectedPolygonEntry.id, c)}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Fill Opacity</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedPolygonEntry.fillOpacity ?? 0.12}
                        onPointerDown={() => handleSliderDown('fillOpacity')}
                        onPointerUp={(e) => handleSliderUp('fillOpacity', parseFloat(e.target.value))}
                        onChange={(e) => polygonManagerRef.current?.setStyleField(selectedPolygonEntry.id, 'fillOpacity', parseFloat(e.target.value))}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: '12px', color: '#fff', width: '24px' }}>
                        {Math.round((selectedPolygonEntry.fillOpacity ?? 0.12) * 100)}%
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Border Width</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        step="1"
                        value={selectedPolygonEntry.strokeWeight ?? 2}
                        onPointerDown={() => handleSliderDown('strokeWeight')}
                        onPointerUp={(e) => handleSliderUp('strokeWeight', parseInt(e.target.value))}
                        onChange={(e) => polygonManagerRef.current?.setStyleField(selectedPolygonEntry.id, 'strokeWeight', parseInt(e.target.value))}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: '12px', color: '#fff', width: '24px' }}>
                        {selectedPolygonEntry.strokeWeight ?? 2}px
                      </span>
                    </div>
                  </div>
                </div>
                {polygonMetricsNow && (
                  <div className="poly-popup-metrics">
                    <div><span>Area</span><strong>{formatSqFt(polygonMetricsNow.area)} sq ft</strong></div>
                    <div><span>Perimeter</span><strong>{formatFt(polygonMetricsNow.perimeter)} ft</strong></div>
                  </div>
                )}
                <div className="poly-popup-actions">
                  <button
                    className={`poly-popup-btn ${polygonIsEditing ? 'poly-popup-btn--active' : ''}`}
                    onClick={() => {
                      if (polygonIsEditing) polygonManagerRef.current?.exitEditMode();
                      else polygonManagerRef.current?.enterEditMode(selectedPolygonEntry.id);
                    }}
                  >
                    {polygonIsEditing ? 'Done Editing' : 'Edit Geometry'}
                  </button>
                  <button
                    className="poly-popup-btn poly-popup-btn--danger"
                    onClick={() => polygonManagerRef.current?.deletePolygon(selectedPolygonEntry.id)}
                  >
                    Delete
                  </button>
                </div>
                <button
                  className="poly-popup-btn poly-popup-btn--copy"
                  onClick={async () => {
                    const text = polygonManagerRef.current?.getCoordsText(selectedPolygonEntry.id) ?? '[]';
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch {
                      window.prompt('Copy polygon coordinates:', text);
                    }
                    setCoordsCopied(true);
                    setTimeout(() => setCoordsCopied(false), 1500);
                  }}
                >
                  {coordsCopied ? 'Copied ✓' : 'Copy Coordinates'}
                </button>
                <button className="poly-popup-close" onClick={() => polygonManagerRef.current?.deselect()}>×</button>
              </div>
            </OverlayView>
          )}

          {/* Pin popup — same pattern as the polygon popup */}
          {selectedPinEntry && pinPopupPos && !pinIsEditing && (
            <OverlayView
              position={pinPopupPos}
              mapPaneName={OverlayView.FLOAT_PANE}
              getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -height - 40 })}
            >
              <div
                className="poly-popup"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="poly-popup-header">Pin Properties</div>
                <input
                  className="poly-popup-input"
                  type="text"
                  value={selectedPinEntry.name}
                  onChange={(e) => pinManagerRef.current?.rename(selectedPinEntry.id, e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Pin Name"
                />
                <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                  <span className="poly-popup-cats-label" style={{ width: '60px' }}>Category</span>
                  <div className="pp-cats" style={{ flex: 1, display: 'flex' }}>
                    <button
                      type="button"
                      style={{ flex: 1 }}
                      className={`pp-cat${selectedPinEntry.category === 'project' ? ' pp-cat--active' : ''}`}
                      onClick={() => pinManagerRef.current?.setCategory(selectedPinEntry.id, 'project')}
                    >
                      Project
                    </button>
                    <button
                      type="button"
                      style={{ flex: 1 }}
                      className={`pp-cat${selectedPinEntry.category === 'landmark' ? ' pp-cat--active' : ''}`}
                      onClick={() => pinManagerRef.current?.setCategory(selectedPinEntry.id, 'landmark', selectedPinEntry.landmarkType || 'brts')}
                    >
                      Landmark
                    </button>
                  </div>
                </div>

                {selectedPinEntry.category === 'project' && (
                  <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                    <span className="poly-popup-cats-label" style={{ width: '60px' }}>Style</span>
                    <div className="pp-cats" style={{ flex: 1, display: 'flex' }}>
                      <button
                        type="button"
                        style={{ flex: 1 }}
                        className={`pp-cat${selectedPinEntry.styleMode !== 'custom' ? ' pp-cat--active' : ''}`}
                        onClick={() => pinManagerRef.current?.setStyle(selectedPinEntry.id, 'default')}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        style={{ flex: 1 }}
                        className={`pp-cat${selectedPinEntry.styleMode === 'custom' ? ' pp-cat--active' : ''}`}
                        onClick={() => pinManagerRef.current?.setStyle(selectedPinEntry.id, 'custom')}
                      >
                        Custom
                      </button>
                    </div>
                  </div>
                )}

                {selectedPinEntry.category === 'landmark' && (
                  <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                    <span className="poly-popup-cats-label" style={{ width: '60px' }}>Type</span>
                    <select
                      className="poly-popup-input"
                      style={{ flex: 1, margin: 0, padding: '4px 8px', fontSize: '12px', height: '24px', backgroundColor: 'rgba(4, 6, 12, 0.35)', color: '#fff', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: '8px' }}
                      value={selectedPinEntry.landmarkType || 'brts'}
                      onChange={(e) => pinManagerRef.current?.setCategory(selectedPinEntry.id, 'landmark', e.target.value)}
                    >
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="brts">BRTS</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="metro">Metro</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="railway">Railway</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="roads">Roads</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="bridges">Bridges</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="circle">Circle</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="school">School</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="college">College</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="hospital">Hospital</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="grocery">Grocery & Shopping Centre</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="garden">Garden</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="lake">Lake</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="temple">Temple</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="multiplex">Multiplex</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="police">Police Stations</option>
                      <option style={{ background: '#0a0e1c', color: '#fff' }} value="textile">Textile Market</option>
                    </select>
                  </div>
                )}

                <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                  <span className="poly-popup-cats-label" style={{ width: '60px' }}>Color</span>
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                    <ColorPickerPopover
                      color={selectedPinEntry.color}
                      onChange={(c) => pinManagerRef.current?.setColor(selectedPinEntry.id, c)}
                    />
                  </div>
                </div>
                {selectedPinEntry.styleMode === 'custom' && selectedPinEntry.category === 'project' && (
                  <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                    <span className="poly-popup-cats-label" style={{ width: '60px' }}>Image</span>
                    <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
                      <label className="poly-popup-btn" style={{ padding: '4px 10px', margin: 0, cursor: 'pointer', flex: 'none' }}>
                        Upload...
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          onChange={(e) => handlePinImageFile(e, selectedPinEntry.id)}
                        />
                      </label>
                    </div>
                  </div>
                )}
                {selectedPinEntry.styleMode === 'custom' && selectedPinEntry.category === 'project' && (
                  <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                    <span className="poly-popup-cats-label" style={{ width: '60px' }}>Size</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
                      <input
                        type="range"
                        min="0.5"
                        max="3"
                        step="0.1"
                        value={selectedPinEntry.customSize ?? 1}
                        onPointerDown={handlePinSizeDown}
                        onPointerUp={(e) => handlePinSizeUp(parseFloat(e.target.value))}
                        onChange={(e) => pinManagerRef.current?.setCustomSizeLive(selectedPinEntry.id, parseFloat(e.target.value))}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: '12px', color: '#fff', width: '32px' }}>
                        {Math.round((selectedPinEntry.customSize ?? 1) * 100)}%
                      </span>
                    </div>
                  </div>
                )}
                <div className="poly-popup-actions">
                  <button
                    className={`poly-popup-btn ${pinIsEditing ? 'poly-popup-btn--active' : ''}`}
                    onClick={() => {
                      if (pinIsEditing) pinManagerRef.current?.exitEditMode();
                      else pinManagerRef.current?.enterEditMode(selectedPinEntry.id);
                    }}
                  >
                    {pinIsEditing ? 'Done Editing' : 'Edit Location'}
                  </button>
                  <button
                    className="poly-popup-btn poly-popup-btn--danger"
                    onClick={() => pinManagerRef.current?.deletePin(selectedPinEntry.id)}
                  >
                    Delete
                  </button>
                </div>
                <button
                  className="poly-popup-btn poly-popup-btn--copy"
                  onClick={async () => {
                    const text = pinManagerRef.current?.getCoordsText(selectedPinEntry.id) ?? '{}';
                    try { await navigator.clipboard.writeText(text); }
                    catch { window.prompt('Copy pin coordinates:', text); }
                    setPinCoordsCopied(true);
                    setTimeout(() => setPinCoordsCopied(false), 1500);
                  }}
                >
                  {pinCoordsCopied ? 'Copied ✓' : 'Copy Coordinates'}
                </button>
                <button className="poly-popup-close" onClick={() => pinManagerRef.current?.deselect()}>×</button>
              </div>
            </OverlayView>
          )}

          {/* Road popup — custom popup mapped to PolygonManager */}
          {selectedRoadEntry && roadPopupPos && (
            <OverlayView
              position={roadPopupPos}
              mapPaneName={OverlayView.FLOAT_PANE}
              getPixelPositionOffset={(width, height) => ({ x: -(width / 2), y: -height - 15 })}
            >
              <div
                className="poly-popup"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <div className="poly-popup-header">Road Properties</div>
                <input
                  className="poly-popup-input"
                  type="text"
                  value={selectedRoadEntry.name || ''}
                  onChange={(e) => {
                    polygonManagerRef.current?.rename(selectedRoadEntry.id, e.target.value);
                    setSelectedRoadEntry({ ...selectedRoadEntry, name: e.target.value });
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Road name"
                />
                <div className="poly-popup-cats-row" onMouseDown={(e) => e.stopPropagation()}>
                  <span className="poly-popup-cats-label">Category</span>
                  <div className="pp-cats">
                    {['Road', 'Bridge'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        className={`pp-cat${(selectedRoadEntry.category || '').toLowerCase() === cat.toLowerCase() ? ' pp-cat--active' : ''}`}
                        onClick={() => {
                          const c = cat.toLowerCase();
                          polygonManagerRef.current?.setCategory(selectedRoadEntry.id, c);
                          setSelectedRoadEntry({ ...selectedRoadEntry, category: c });
                        }}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', marginTop: '8px', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Color</span>
                    <ColorPickerPopover
                      color={selectedRoadEntry.color || '#FF9800'}
                      onChange={(c) => {
                        polygonManagerRef.current?.setColor(selectedRoadEntry.id, c);
                        setSelectedRoadEntry({ ...selectedRoadEntry, color: c });
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Line Width</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        step="1"
                        value={selectedRoadEntry.strokeWeight || 3}
                        onChange={(e) => {
                          const w = parseInt(e.target.value);
                          polygonManagerRef.current?.setStyleField(selectedRoadEntry.id, 'strokeWeight', w);
                          setSelectedRoadEntry({ ...selectedRoadEntry, strokeWeight: w });
                        }}
                        style={{ width: 80 }}
                      />
                      <span style={{ fontSize: '12px', color: '#fff', width: '24px' }}>
                        {selectedRoadEntry.strokeWeight || 3}px
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', color: '#94a3b8' }}>Points</span>
                    <span style={{ fontSize: '12px', color: '#fff' }}>{selectedRoadEntry.gPolygon?.getPath()?.getLength() || 0}</span>
                  </div>
                </div>

                <div className="poly-popup-actions">
                  <button
                    className="poly-popup-btn"
                    onClick={() => {
                      polygonManagerRef.current?.enterEditMode(selectedRoadEntry.id);
                      setRoadPopupPos(null);
                    }}
                  >
                    Edit Geometry
                  </button>
                  <button
                    className="poly-popup-btn"
                    onClick={() => {
                      // Enter extend mode: set the extending ref and activate road tool
                      extendingRoadIdRef.current = selectedRoadEntry.id;
                      setRoadPopupPos(null);
                      setActiveLandmarkTool('lm-road');
                      setActiveTool('lm-road');
                    }}
                  >
                    Extend Road
                  </button>
                  <button
                    className="poly-popup-btn poly-popup-btn--danger"
                    onClick={() => {
                      polygonManagerRef.current?.deletePolygon(selectedRoadEntry.id);
                      setSelectedRoadEntry(null);
                      setRoadPopupPos(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
                <button
                  className="poly-popup-close"
                  onClick={() => {
                    polygonManagerRef.current?.deselect();
                    setSelectedRoadEntry(null);
                    setRoadPopupPos(null);
                  }}
                >×</button>
              </div>
            </OverlayView>
          )}

          {/* GCP Map Markers */}
          {floorPlanMode === 'gcp' && gcpPoints.map((pt, i) => (
            <OverlayView
              key={pt.id}
              position={pt.map}
              mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
              getPixelPositionOffset={(width, height) => ({ x: -10, y: -10 })}
            >
              <div className="gcp-marker" style={{ position: 'absolute' }}>
                {i + 1}
              </div>
            </OverlayView>
          ))}

        </GoogleMap>
      </div>

      {/* Search bar */}
      <div className="mw-search-container">
        <SearchBar mapRef={mapRef} />
      </div>

      {/* Floating tool panel (left side) */}
      {floorPlanMode !== 'gcp' && <ToolPanel />}

      {/* Layers panel */}
      {floorPlanMode !== 'gcp' && <LayersPanel tick={tick} />}

      {/* Per-tool property panel (appears right of tool panel when tool is active) */}
      {floorPlanMode !== 'gcp' && <PropertyPanel toolProps={toolProps} setToolProps={setToolProps} />}

      {/* Floating bottom-center panel for Floor Plan tools */}
      {floorPlanMode !== 'gcp' && <FloorPlanBottomPanel />}

      {/* Hidden file input for Floor Plan tool */}
      <input
        ref={floorFileRef}
        id="fp-upload-input"
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFloorFile}
      />

      {/* Floating "Done Editing" button */}
      {(polygonIsEditing || pinIsEditing) && (
        <button
          className="poly-edit-done-btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (polygonIsEditing) polygonManagerRef.current?.exitEditMode();
            if (pinIsEditing) pinManagerRef.current?.exitEditMode();
          }}
        >
          ✓ Done Editing
        </button>
      )}

      {/* Polygon naming/classification modal — shown once the drawn loop is
          closed. The polygon isn't created on the map until "Done" here. */}
      {pendingPolygon && (
        <div
          className="poly-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) cancelPendingPolygon(); }}
        >
          <div className="poly-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="poly-modal-header">Name this boundary</div>
            <input
              autoFocus
              className="poly-popup-input"
              type="text"
              value={pendingName}
              onChange={(e) => setPendingName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmPendingPolygon();
                if (e.key === 'Escape') cancelPendingPolygon();
              }}
              placeholder="Polygon name"
            />
            <div className="poly-modal-sublabel">Is this a Landmark or a Project boundary?</div>
            <div className="pp-cats poly-modal-cats">
              <button
                type="button"
                className={`pp-cat${pendingCategory === 'project' ? ' pp-cat--active' : ''}`}
                onClick={() => handlePendingCategoryChange('project')}
              >
                Project
              </button>
              <button
                type="button"
                className={`pp-cat${pendingCategory === 'landmark' ? ' pp-cat--active' : ''}`}
                onClick={() => handlePendingCategoryChange('landmark')}
              >
                Landmark
              </button>
              <button
                type="button"
                className={`pp-cat${(pendingCategory === 'pending-unit' || pendingCategory === 'unit') ? ' pp-cat--active' : ''}`}
                onClick={() => handlePendingCategoryChange(isAutoPlotReviewMode ? 'pending-unit' : 'unit')}
              >
                Unit
              </button>
            </div>
            <div className="poly-popup-actions poly-modal-actions">
              <button className="poly-popup-btn" onClick={cancelPendingPolygon}>Cancel</button>
              <button className="poly-popup-btn poly-popup-btn--primary" onClick={confirmPendingPolygon}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Road naming/classification modal — mirrors polygon modal exactly */}
      {pendingRoad && (
        <div
          className="poly-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) cancelPendingRoad(); }}
        >
          <div className="poly-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="poly-modal-header">Name this road</div>
            <input
              autoFocus
              className="poly-popup-input"
              type="text"
              value={pendingRoadName}
              onChange={(e) => setPendingRoadName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmPendingRoad();
                if (e.key === 'Escape') cancelPendingRoad();
              }}
              placeholder="Road name"
            />
            <div className="poly-modal-sublabel">Road or Bridge?</div>
            <div className="pp-cats poly-modal-cats">
              {['Road', 'Bridge'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`pp-cat${pendingRoadCategory === cat ? ' pp-cat--active' : ''}`}
                  onClick={() => setPendingRoadCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="poly-popup-actions poly-modal-actions">
              <button className="poly-popup-btn" onClick={cancelPendingRoad}>Cancel</button>
              <button className="poly-popup-btn poly-popup-btn--primary" onClick={confirmPendingRoad}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Plot Review Mode Floating Panel */}
      {isAutoPlotReviewMode && (
        <div style={{
          position: 'fixed', left: 360, top: 52,
          background: '#1e293b', border: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '4px 8px 4px 12px', borderRadius: '6px', zIndex: 1000,
          display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          color: 'white', fontFamily: 'Inter, sans-serif'
        }}>
          <div style={{ fontSize: '13px', fontWeight: 500, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
            Review Detected Units
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={cancelAutoPlotUnits} style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: '#cbd5e1',
              padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 500
            }}>Cancel</button>
            <button onClick={confirmAutoPlotUnits} style={{
              background: '#00d4ff', border: 'none', color: '#0f172a',
              padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600
            }}>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MapWorkspace (root export) — wraps inner with WorkspaceProvider ──────────
export default function MapWorkspace() {
  return (
    <WorkspaceProvider>
      <MapWorkspaceInner />
    </WorkspaceProvider>
  );
}