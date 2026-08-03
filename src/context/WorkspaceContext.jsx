import { createContext, useState, useCallback, useContext, useRef } from 'react';
import { useHistory } from '../hooks/useHistory';

// ─── Feature ID generator ──────────────────────────────────────────────────────
let _idSeq = 0;
export function nextId(prefix = 'f') {
  _idSeq += 1;
  return `${prefix}-${Date.now()}-${_idSeq}`;
}

// ─── Initial project model ─────────────────────────────────────────────────────
const INITIAL_PROJECT = {
  layers: [{ id: 'layer-1', name: 'Untitled Layer', color: '#00CED1', visible: true, locked: false, order: 0, styleMode: 'individual' }],
  polygons: [], // { id, points:[{lat,lng}], fillColor, lineColor, lineWidth, layerId }
  pins: [], // { id, position:{lat,lng}, category, layerId }
  roads: [], // { id, points:[{lat,lng}], lineColor, lineWidth, roadWidth, roadName }
  radii: [], // { id, center:{lat,lng}, rings:[{distance}], ringColor }
  floorPlans: [], // { id, url, center:{lat,lng}, bounds:{n,s,e,w}, layerId }
};

// ─── Context ───────────────────────────────────────────────────────────────────
export const WorkspaceContext = createContext(null);

// ─── Dummy Data for Portfolios and Projects ───────────────────────────────────
export const DUMMY_PORTFOLIOS = [
  {
    id: 'port-1',
    name: 'Sample Builders',
    projects: [
      { id: 'proj-1', name: 'Riverside Towers' },
      { id: 'proj-2', name: 'Green Valley Phase 1' }
    ]
  }
];

export const DUMMY_PROJECTS = [
  { id: 'proj-3', name: 'Personal Project A' },
  { id: 'proj-4', name: 'Personal Project B' }
];

export function WorkspaceProvider({ children }) {
  const { state: project, commit, pushThunk, undo, redo, canUndo, canRedo } =
    useHistory(INITIAL_PROJECT);

  // Each tool-group keeps its own highlight state so selecting a tool in one
  // group never clears the other group's active button. `lastGroup` tracks
  // whichever was touched most recently — that's the one that actually
  // drives map click/drawing behavior (only one tool can draw at a time).
  const [activeProjectTool, _setActiveProjectTool] = useState(null); // 'proj-*'|null
  const [activeLandmarkTool, _setActiveLandmarkTool] = useState(null); // 'lm-*'|null
  const [lastGroup, setLastGroup] = useState(null); // 'project'|'landmark'|null

  const [selectedId, setSelectedId] = useState(null);
  const [selectedPolygonEntry, setSelectedPolygonEntry] = useState(null);
  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState(null);
  const [selectedLayerItemId, setSelectedLayerItemId] = useState(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [floorPlanMode, setFloorPlanMode] = useState('manual'); // 'manual' | 'gcp'
  const [gcpPoints, setGCPPoints] = useState([]); // { id, img: {x,y}, map: {lat,lng}, error }
  const [pendingImgPt, setPendingImgPt] = useState(null); // {x, y}
  const [activeLayerId, setActiveLayerId] = useState('layer-1');

  const polygonManagerRef = useRef(null);
  const pinManagerRef = useRef(null);
  const floorPlanManagerRef = useRef(null);

  const setActiveProjectTool = useCallback((idOrFn) => {
    _setActiveProjectTool(idOrFn);
    setLastGroup('project');
    setSelectedId(null);
  }, []);

  const setActiveLandmarkTool = useCallback((idOrFn) => {
    _setActiveLandmarkTool(idOrFn);
    setLastGroup('landmark');
    setSelectedId(null);
  }, []);

  const activeTool = lastGroup === 'landmark' ? activeLandmarkTool : activeProjectTool;

  // Generic setter (used by Escape-to-cancel, etc.) — targets whichever
  // group is currently live.
  const setActiveTool = useCallback((idOrFn) => {
    if (lastGroup === 'landmark') setActiveLandmarkTool(idOrFn);
    else setActiveProjectTool(idOrFn);
  }, [lastGroup, setActiveLandmarkTool, setActiveProjectTool]);

  // Closes any open side popup/panel — called whenever a tool button is tapped
  const closeSidePopups = useCallback(() => {
    polygonManagerRef.current?.deselect();
    pinManagerRef.current?.deselect();
    floorPlanManagerRef.current?.onSelect(null);
    setSelectedPolygonEntry(null);
    setSelectedId(null);
    setSelectedFloorPlanId(null);
    setSelectedLayerItemId(null);
  }, []);

  // commitProject: updater fn or new project object — writes to history
  const commitProject = useCallback((updater) => {
    commit(updater);
  }, [commit]);

  // ── Layer Management ────────────────────────────────────────────────────────
  const addLayer = useCallback(() => {
    const newLayer = {
      id: nextId('layer'),
      name: `Layer ${(project.layers?.length || 0) + 1}`,
      color: '#00CED1',
      visible: true,
      locked: false,
      order: project.layers?.length || 0,
      styleMode: 'individual'
    };
    commitProject((proj) => ({ ...proj, layers: [...(proj.layers || []), newLayer] }));
    setActiveLayerId(newLayer.id);
  }, [project.layers, commitProject]);

  const deleteLayer = useCallback((layerId) => {
    commitProject((proj) => {
      const layers = (proj.layers || []).filter(l => l.id !== layerId);
      return { ...proj, layers };
    });
    // Ensure activeLayerId is valid
    setActiveLayerId((curr) => {
      if (curr === layerId) {
        return project.layers?.find(l => l.id !== layerId)?.id || null;
      }
      return curr;
    });
  }, [project.layers, commitProject]);

  const updateLayer = useCallback((layerId, updates) => {
    commitProject((proj) => ({
      ...proj,
      layers: (proj.layers || []).map(l => l.id === layerId ? { ...l, ...updates } : l)
    }));
  }, [commitProject]);

  const toggleLayerVisibility = useCallback((layerId) => {
    commitProject((proj) => ({
      ...proj,
      layers: (proj.layers || []).map(l => l.id === layerId ? { ...l, visible: !l.visible } : l)
    }));
  }, [commitProject]);

  const reorderLayers = useCallback((draggedId, targetId) => {
    commitProject((proj) => {
      const layers = [...(proj.layers || [])];
      const draggedIndex = layers.findIndex(l => l.id === draggedId);
      const targetIndex = layers.findIndex(l => l.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return proj;
      
      const [draggedLayer] = layers.splice(draggedIndex, 1);
      layers.splice(targetIndex, 0, draggedLayer);
      
      // Update order field
      layers.forEach((l, i) => { l.order = i; });
      return { ...proj, layers };
    });
  }, [commitProject]);

  // Polygons live inside PolygonManager's own Map, not in `project` state
  // (avoids double undo-history entries). Anything that needs the FULL
  // project — save, export, project switch — must read through this.
  const getExportProject = useCallback(() => ({
    ...project,
    polygons: polygonManagerRef.current?.getState() ?? [],
    pins: pinManagerRef.current?.getState() ?? [],
    floorPlans: floorPlanManagerRef.current?.getState() ?? [],
  }), [project]);

  return (
    <WorkspaceContext.Provider
      value={{
        project,
        commitProject,
        getExportProject,
        pushThunk,
        undo,
        redo,
        canUndo,
        canRedo,
        activeTool,
        setActiveTool,
        activeProjectTool,
        setActiveProjectTool,
        activeLandmarkTool,
        setActiveLandmarkTool,
        closeSidePopups,
        selectedId,
        setSelectedId,
        selectedPolygonEntry,
        setSelectedPolygonEntry,
        selectedFloorPlanId,
        setSelectedFloorPlanId,
        selectedLayerItemId,
        setSelectedLayerItemId,
        floorPlanMode,
        setFloorPlanMode,
        gcpPoints,
        setGCPPoints,
        pendingImgPt,
        setPendingImgPt,
        polygonManagerRef,
        pinManagerRef,
        floorPlanManagerRef,
        snapToGrid,
        setSnapToGrid,
        activeLayerId,
        setActiveLayerId,
        addLayer,
        deleteLayer,
        updateLayer,
        toggleLayerVisibility,
        reorderLayers,
        DUMMY_PORTFOLIOS,
        DUMMY_PROJECTS,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be inside <WorkspaceProvider>');
  return ctx;
}