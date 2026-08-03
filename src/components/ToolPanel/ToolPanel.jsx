import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import SaveProjectDialog from '../Dialogs/SaveProjectDialog';
import OpenProjectDialog from '../Dialogs/OpenProjectDialog';
import './ToolPanel.css';

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const FloorPlanIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="9" y1="9" x2="9" y2="21" />
  </svg>
);

const PolygonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round">
    <polygon points="12 3 20.5 8.5 17.5 19.5 6.5 19.5 3.5 8.5" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round">
    <path d="M12 2C8.69 2 6 4.69 6 8c0 5 6 12 6 12s6-7 6-12c0-3.31-2.69-6-6-6z" />
    <circle cx="12" cy="8" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

const RoadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20 C7 16 9 13 12 12 C15 11 17 8 20 4" />
    <circle cx="4" cy="20" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="20" cy="4" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const RadiusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
    <circle cx="12" cy="12" r="2" />
    <circle cx="12" cy="12" r="5.5" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const GridIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const SaveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);


// ─── Tool definitions ─────────────────────────────────────────────────────────
// Polygon/Pin/Floor Plan live ONLY in the Project group — no more duplicate
// buttons across both groups. Landmark keeps only what's unique to it.

const PROJECT_TOOLS = [
  { id: 'floor-plan', label: 'Floor Plan', Icon: FloorPlanIcon },
  { id: 'polygon', label: 'Polygon', Icon: PolygonIcon },
  { id: 'pin', label: 'Pin', Icon: PinIcon },
];

const LANDMARK_TOOLS = [
  { id: 'road', label: 'Road', Icon: RoadIcon },
  { id: 'radius', label: 'Radius', Icon: RadiusIcon },
];

// ─── ToolBtn ──────────────────────────────────────────────────────────────────

function ToolBtn({ id, label, Icon, active, onClick, premium }) {
  return (
    <button
      className={`tp-btn${active ? ' tp-btn--active' : ''}${premium ? ' tp-btn--premium' : ''}`}
      onClick={onClick}
      title={premium ? `${label} — core tool` : label}
      aria-label={label}
      aria-pressed={active}
      id={`tp-tool-${id}`}
    >
      <span className="tp-icon"><Icon /></span>
      <span className="tp-label">{label}</span>
      {premium && <span className="tp-premium-badge">★</span>}
    </button>
  );
}

// ─── ToolPanel ────────────────────────────────────────────────────────────────

export default function ToolPanel() {
  const {
    activeProjectTool, setActiveProjectTool,
    activeLandmarkTool, setActiveLandmarkTool,
    snapToGrid, setSnapToGrid,
    closeSidePopups,
    getExportProject,
  } = useWorkspace();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);

  const handleExportJSON = () => {
    const data = getExportProject();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-${data.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const handleExportKML = () => {
    // Stub KML export
    handleExportJSON();
    setExportMenuOpen(false);
  };

  const handleExportKMZ = () => {
    // Stub KMZ export
    handleExportJSON();
    setExportMenuOpen(false);
  };

  const handleExportProjectTagJSON = () => {
    const data = getExportProject();

    const primaryLocation = data.pins?.[0]?.position || data.polygons?.[0]?.points?.[0] || { lat: 0, lng: 0 };
    const polygon = data.polygons?.[0]?.points || [{ lat: 0, lng: 0 }];
    const unitPolygons = data.polygons?.length > 0 ? data.polygons.map(p => p.points) : [[{ lat: 0, lng: 0 }]];

    const floorplanEntry = data.floorPlans?.[0] || {};
    const bounds = floorplanEntry.bounds || {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 0, lng: 0 }
    };
    const floorplanCorners = floorplanEntry.corners || {
      nw: { lat: 0, lng: 0 },
      ne: { lat: 0, lng: 0 },
      se: { lat: 0, lng: 0 },
      sw: { lat: 0, lng: 0 },
      rotationDeg: 0
    };

    const projectTag = {
      projectTag: {
        projectName: "",
        subTitle: "Residential",
        thumbnailUrl: "External-Files/Assets/Thumbnail",
        developer: "",
        contact: {
          phone: "",
          email: "",
          social: { facebook: "", instagram: "", website: "" }
        },
        location: {
          text: "",
          areaText: "",
          googleMapLink: "",
          mapEmbedUrl: ""
        },
        brochures: [],
        legal: [],
        photos: {},
        videos: [],
        floorplans: {},
        pinUrl: "External-Files/Assets/Pins",
        lat: primaryLocation.lat,
        lng: primaryLocation.lng,
        polygon: polygon,
        floorplan: "External-Files/Assets/Map-Floorplans",
        bounds: bounds,
        floorplanCorners: floorplanCorners,
        unitPolygonsGPS: true,
        unitPolygons: unitPolygons,
        units: [
          { id: 1, sqyd: 0, length: "", width: "", status: "AVAILABLE", orientation: "" }
        ]
      }
    };

    const blob = new Blob([JSON.stringify(projectTag, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-tag-${data.id || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };


  // Any tool tap closes the polygon popup / side panel before switching tools
  const handleProjectTool = (id) => {
    closeSidePopups();
    if (id === 'proj-floor-plan') {
      document.getElementById('fp-upload-input')?.click();
      return;
    }
    setActiveProjectTool((prev) => (prev === id ? null : id));
  };
  const handleLandmarkTool = (id) => {
    closeSidePopups();
    setActiveLandmarkTool((prev) => (prev === id ? null : id));
  };

  // ── Collapsed — only show the hamburger ───────────────────────────────────
  // ── Always expanded, all tools visible ───────────────────────────────────
  return (
    <div className="tp-panel" id="tp-panel">



      {/* Drawing tools — left side */}
      <div className="tp-group" role="group" aria-label="Project tools">
        {PROJECT_TOOLS.map(({ id, label, Icon, premium }) => (
          <ToolBtn
            key={`proj-${id}`}
            id={`proj-${id}`}
            label={label}
            Icon={Icon}
            premium={premium}
            active={activeProjectTool === `proj-${id}`}
            onClick={() => handleProjectTool(`proj-${id}`)}
          />
        ))}
      </div>



      {/* Landmark group */}
      <div className="tp-group" role="group" aria-label="Landmark tools">
        {LANDMARK_TOOLS.map(({ id, label, Icon }) => (
          <ToolBtn
            key={`lm-${id}`}
            id={`lm-${id}`}
            label={label}
            Icon={Icon}
            active={activeLandmarkTool === `lm-${id}`}
            onClick={() => handleLandmarkTool(`lm-${id}`)}
          />
        ))}
        <ToolBtn
          id="grid"
          label="Grid"
          Icon={GridIcon}
          active={snapToGrid}
          onClick={() => setSnapToGrid((v) => !v)}
        />
      </div>

      <div className="tp-sep" />

      {/* Export / Save / Open — right end */}
      <div className="tp-group" role="group" aria-label="File tools">
        <div style={{ position: 'relative' }}>
          <ToolBtn
            id="export-project"
            label="Export"
            Icon={ExportIcon}
            active={exportMenuOpen}
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
          />
          {exportMenuOpen && (
            <div className="tp-export-dropdown">
              <button className="tp-export-item" onClick={handleExportKML}>Export as KML</button>
              <button className="tp-export-item" onClick={handleExportKMZ}>Export as KMZ</button>
              <button className="tp-export-item" onClick={handleExportJSON}>Export as JSON</button>
              <button className="tp-export-item" onClick={handleExportProjectTagJSON}>Export Project Tag JSON</button>
            </div>
          )}
        </div>
        <ToolBtn
          id="save-project"
          label="Save"
          Icon={SaveIcon}
          active={saveDialogOpen}
          onClick={() => setSaveDialogOpen(true)}
        />
        <ToolBtn
          id="open-projects"
          label="Open Projects"
          Icon={FolderIcon}
          active={openDialogOpen}
          onClick={() => setOpenDialogOpen(true)}
        />
      </div>

      {/* Modals */}
      {saveDialogOpen && <SaveProjectDialog onClose={() => setSaveDialogOpen(false)} />}
      {openDialogOpen && <OpenProjectDialog onClose={() => setOpenDialogOpen(false)} />}
    </div>
  );
}