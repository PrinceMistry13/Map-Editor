import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspace } from '../../context/WorkspaceContext';
import SaveProjectDialog from '../Dialogs/SaveProjectDialog';
import JSZip from 'jszip';
import { bakeFloorplanImage } from '../../utils/imageBake';
import { polygonArea } from '../../utils/polygonMetrics';
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
  { id: 'road', label: 'Road', Icon: RoadIcon, premium: true },
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

const blobUrlToBytes = async (url) => {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await blob.arrayBuffer();
  } catch (e) {
    console.warn("Failed to fetch blob", e);
    return null;
  }
};

const LANDMARK_PIN_TYPE_LABELS = {
  brts: 'BRTS', metro: 'Metro', railway: 'Railway', roads: 'Roads', bridges: 'Bridges',
  circle: 'Circle', school: 'School', college: 'College', hospital: 'Hospital',
  grocery: 'Grocery', garden: 'Garden', lake: 'Lake', temple: 'Temple',
  multiplex: 'Multiplex', police: 'Police', textile: 'Textile', other: 'Other',
};
const LANDMARK_PIN_LABEL_TO_TYPE = Object.entries(LANDMARK_PIN_TYPE_LABELS)
  .reduce((acc, [k, v]) => { acc[v.toLowerCase()] = k; return acc; }, {});

const generateKMLString = (data, exportMode = 'kml') => {
  let kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">\n  <Document>\n    <name>${data.id || 'Exported Project'}</name>\n`;

  const plotSortValue = (key) => {
    if (key === null || key === undefined) return Number.POSITIVE_INFINITY;
    const match = String(key).match(/-?\d+/);
    return match ? parseInt(match[0], 10) : Number.POSITIVE_INFINITY;
  };

  const lmRoadItems = [];
  const lmPolyItems = [];
  const lmPinsByType = {};

  const fpBuckets = {};
  if (data.floorPlans) {
    data.floorPlans.forEach((fp, i) => {
      fpBuckets[fp.id] = { fp, index: i, items: [], plotItems: [] };
    });
  }
  const globalItems = [];
  const globalPlotItems = [];

  const addStr = (metadata, str, isPlot = false, sortKey = null) => {
    const fpId = metadata?.floorPlanId;
    const bucket = fpId && fpBuckets[fpId] ? fpBuckets[fpId] : null;
    if (isPlot) {
      (bucket ? bucket.plotItems : globalPlotItems).push({ str, sortKey });
    } else {
      (bucket ? bucket.items : globalItems).push(str);
    }
  };

  if (data.polygons) {
    data.polygons.forEach((poly, i) => {
      if (!poly.path || poly.path.length < 3) return;

      const altMode = 'clampToGround';
      const coords = [...poly.path, poly.path[0]].map(p => `${p.lng},${p.lat},0`).join(' ');

      let styleStr = '';
      if (poly.color) {
        const hex = poly.color.replace('#', '');
        if (hex.length === 6) {
          const r = hex.substring(0, 2);
          const g = hex.substring(2, 4);
          const b = hex.substring(4, 6);
          const kmlLineColor = `ff${b}${g}${r}`;
          const kmlFillColor = `1e${b}${g}${r}`;
          styleStr = `
      <Style>
        <LineStyle>
          <color>${kmlLineColor}</color>
          <width>2</width>
        </LineStyle>
        <PolyStyle>
          <color>${kmlFillColor}</color>
          <fill>0</fill>
        </PolyStyle>
      </Style>`;
        }
      }

      const extData = `
      <ExtendedData>
        <Data name="appCategory"><value>${poly.category || 'project'}</value></Data>
        <Data name="appLayerId"><value>${poly.layerId || 'layer-1'}</value></Data>
      </ExtendedData>`;

      const str = `
    <Placemark>
      <name>${poly.name || `Polygon ${i + 1}`}</name>${styleStr}${extData}
      <Polygon>
        <tessellate>1</tessellate>
        <altitudeMode>${altMode}</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;

      if (poly.category === 'landmark') {
        lmPolyItems.push(str);
      } else {
        addStr(poly.metadata, str, poly.category === 'unit' || poly.category === 'pending-unit', poly.name || `Polygon ${i + 1}`);
      }
    });
  }

  if (data.roads) {
    data.roads.forEach((road, i) => {
      const roadPath = road.points || road.path;
      if (!roadPath || roadPath.length < 2) return;

      const altMode = 'clampToGround';
      const coords = roadPath.map(p => `${p.lng},${p.lat},0`).join(' ');

      let styleStr = '';
      const rColor = road.lineColor || road.color;
      const width = road.lineWidth || road.strokeWeight || 3;
      if (rColor) {
        const hex = rColor.replace('#', '');
        if (hex.length === 6) {
          const r = hex.substring(0, 2);
          const g = hex.substring(2, 4);
          const b = hex.substring(4, 6);
          const kmlLineColor = `ff${b}${g}${r}`;
          styleStr = `
      <Style>
        <LineStyle>
          <color>${kmlLineColor}</color>
          <width>${width}</width>
        </LineStyle>
      </Style>`;
        }
      }

      const extData = `
      <ExtendedData>
        <Data name="appCategory"><value>road</value></Data>
        <Data name="appLayerId"><value>${road.layerId || 'layer-1'}</value></Data>
        <Data name="appLineWidth"><value>${width}</value></Data>
      </ExtendedData>`;

      const str = `
    <Placemark>
      <name>${road.name || `Road ${i + 1}`}</name>${styleStr}${extData}
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>${altMode}</altitudeMode>
        <gx:drawOrder>2</gx:drawOrder>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
      lmRoadItems.push(str);
    });
  }

  if (data.pins) {
    data.pins.forEach((pin, i) => {
      if (!pin.position) return;

      const scale = pin.customSize || 1;
      let iconHref;
      let colorTag = '';
      if (pin.styleMode === 'custom' && pin.imageDataUrl) {
        iconHref = (exportMode === 'kmz') ? `files/pin-${pin.id}.png` : pin.imageDataUrl;
      } else {
        // Standard Google Earth pin, tinted to match the editor's pin color —
        // default-style pins previously exported with no color/size at all.
        iconHref = 'http://maps.google.com/mapfiles/kml/paddle/wht-blank.png';
        const hex = (pin.color || '#00CED1').replace('#', '');
        if (hex.length === 6) {
          const r = hex.substring(0, 2), g = hex.substring(2, 4), b = hex.substring(4, 6);
          colorTag = `
          <color>ff${b}${g}${r}</color>`;
        }
      }

      const styleStr = `
      <Style>
        <IconStyle>${colorTag}
          <scale>${scale}</scale>
          <Icon>
            <href>${iconHref}</href>
          </Icon>
        </IconStyle>
      </Style>`;

      const extData = `
      <ExtendedData>
        <Data name="appCategory"><value>${pin.category || 'project'}</value></Data>
        <Data name="appLandmarkType"><value>${pin.landmarkType || ''}</value></Data>
        <Data name="appLayerId"><value>${pin.layerId || 'layer-1'}</value></Data>
        <Data name="appStyleMode"><value>${pin.styleMode || 'default'}</value></Data>
        <Data name="appColor"><value>${pin.color || ''}</value></Data>
        <Data name="appCustomSize"><value>${scale}</value></Data>
      </ExtendedData>`;

      const str = `
    <Placemark>
      <name>${pin.name || `Pin ${i + 1}`}</name>${styleStr}${extData}
      <Point>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${pin.position.lng},${pin.position.lat},0</coordinates>
      </Point>
    </Placemark>`;

      if (pin.category === 'landmark') {
        const t = pin.landmarkType || 'other';
        if (!lmPinsByType[t]) lmPinsByType[t] = [];
        lmPinsByType[t].push(str);
      } else {
        addStr(pin.metadata, str);
      }
    });
  }

  if (data.radii) {
    data.radii.forEach((radius, i) => {
      if (!radius.center || !radius.rings) return;
      radius.rings.forEach((ring, j) => {
        const distMeters = ring.distance;
        const coords = [];
        for (let angle = 0; angle <= 360; angle += 360 / 64) {
          const rad = angle * Math.PI / 180;
          const earthRadius = 6378137;
          const dLat = (distMeters * Math.cos(rad)) / earthRadius;
          const dLng = (distMeters * Math.sin(rad)) / (earthRadius * Math.cos(radius.center.lat * Math.PI / 180));
          const lat = radius.center.lat + (dLat * 180 / Math.PI);
          const lng = radius.center.lng + (dLng * 180 / Math.PI);
          coords.push(`${lng},${lat},0`);
        }
        const str = `
    <Placemark>
      <name>Radius ${i + 1} Ring ${j + 1}</name>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${coords.join(' ')}</coordinates>
      </LineString>
    </Placemark>`;
        addStr(radius.metadata, str);
      });
    });
  }

  if (data.floorPlans) {
    data.floorPlans.forEach((fp) => {
      const bucket = fpBuckets[fp.id];
      if (!bucket) return;
      const { index, items, plotItems } = bucket;
      if (!fp.bounds || !fp.corners) return;
      const name = fp.name || `Floor Plan ${index + 1}`;

      const sortedPlotItems = [...plotItems].sort((a, b) => plotSortValue(a.sortKey) - plotSortValue(b.sortKey));
      const plotsFolderStr = sortedPlotItems.length > 0 ? `
    <Folder>
      <name>Plots</name>
${sortedPlotItems.map(p => p.str).join('')}
    </Folder>` : '';
      let href = fp.floorplan;
      if (exportMode === 'kmz') href = `files/floorplan-${fp.id}.png`;
      else if (exportMode === 'zip') href = `floorplan-${fp.id}.png`;

      const isDistorted = !!fp.distortedCorners;
      let goStr = '';

      if (exportMode === 'zip') {
        goStr = `
      <GroundOverlay>
        <name>${name}</name>
        <gx:drawOrder>0</gx:drawOrder>
        <altitudeMode>clampToGround</altitudeMode>
        <Icon>
          <href>${href}</href>
        </Icon>
        <LatLonBox>
          <north>${fp.bounds.ne.lat}</north>
          <south>${fp.bounds.sw.lat}</south>
          <east>${fp.bounds.ne.lng}</east>
          <west>${fp.bounds.sw.lng}</west>
          <rotation>0</rotation>
        </LatLonBox>
      </GroundOverlay>`;
      } else if (exportMode === 'kmz' || isDistorted) {
        const targetCorners = fp.distortedCorners || fp.corners;
        const { sw, se, ne, nw } = targetCorners;
        const isDistortedStr = isDistorted ? 'true' : 'false';
        goStr = `
      <GroundOverlay>
        <name>${name}</name>
        <gx:drawOrder>0</gx:drawOrder>
        <altitudeMode>clampToGround</altitudeMode>
        <ExtendedData>
          <Data name="isDistorted">
            <value>${isDistortedStr}</value>
          </Data>
          <Data name="rotation">
            <value>${fp.rotation || 0}</value>
          </Data>
          <Data name="scale">
            <value>${fp.scale || 1}</value>
          </Data>
        </ExtendedData>
        <Icon>
          <href>${href}</href>
        </Icon>
        <gx:LatLonQuad>
          <coordinates>${sw.lng},${sw.lat},0 ${se.lng},${se.lat},0 ${ne.lng},${ne.lat},0 ${nw.lng},${nw.lat},0</coordinates>
        </gx:LatLonQuad>
      </GroundOverlay>`;
      } else {
        goStr = `
      <GroundOverlay>
        <name>${name}</name>
        <gx:drawOrder>0</gx:drawOrder>
        <altitudeMode>clampToGround</altitudeMode>
        <Icon>
          <href>${href}</href>
        </Icon>
        <LatLonBox>
          <north>${fp.bounds.ne.lat}</north>
          <south>${fp.bounds.sw.lat}</south>
          <east>${fp.bounds.ne.lng}</east>
          <west>${fp.bounds.sw.lng}</west>
          <rotation>${fp.rotation || 0}</rotation>
        </LatLonBox>
      </GroundOverlay>`;
      }

      kml += `
    <Folder>
      <name>${name}</name>${goStr}
${items.join('')}${plotsFolderStr}
    </Folder>`;
    });
  }

  if (lmRoadItems.length > 0 || lmPolyItems.length > 0 || Object.keys(lmPinsByType).length > 0) {
    const roadsFolderStr = lmRoadItems.length > 0 ? `
    <Folder>
      <name>Roads</name>
${lmRoadItems.join('')}
    </Folder>` : '';

    const polygonsFolderStr = lmPolyItems.length > 0 ? `
    <Folder>
      <name>Polygons</name>
${lmPolyItems.join('')}
    </Folder>` : '';

    const pinTypeKeys = Object.keys(lmPinsByType).sort();
    const pinsFolderStr = pinTypeKeys.length > 0 ? `
    <Folder>
      <name>Pins</name>
${pinTypeKeys.map(t => `
      <Folder>
        <name>${LANDMARK_PIN_TYPE_LABELS[t] || t}</name>
${lmPinsByType[t].join('')}
      </Folder>`).join('')}
    </Folder>` : '';

    kml += `
    <Folder>
      <name>Landmarks</name>${roadsFolderStr}${polygonsFolderStr}${pinsFolderStr}
    </Folder>`;
  }

  if (globalItems.length > 0 || globalPlotItems.length > 0) {
    const sortedGlobalPlotItems = [...globalPlotItems].sort((a, b) => plotSortValue(a.sortKey) - plotSortValue(b.sortKey));
    const globalPlotsFolderStr = sortedGlobalPlotItems.length > 0 ? `
    <Folder>
      <name>Plots</name>
${sortedGlobalPlotItems.map(p => p.str).join('')}
    </Folder>` : '';

    kml += `
    <Folder>
      <name>Global Layer</name>
${globalItems.join('')}${globalPlotsFolderStr}
    </Folder>`;
  }

  kml += `
  </Document>
</kml>`;
  return kml;
};

function SaveBundleDialog({ onClose, onSave, defaultName }) {
  const [name, setName] = useState(defaultName);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.select();
    }
  }, []);

  React.useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [onClose]);

  return createPortal(
    <div
      className="dialog-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif"
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: '#1A202C',
          padding: '16px',
          borderRadius: '10px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.3)',
          border: '1px solid #2D3748',
          width: '280px',
          boxSizing: 'border-box'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: '#E2E8F0', fontFamily: 'inherit' }}>
          Project Name
        </h3>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => {
            e.target.style.borderColor = '#00E5FF';
            e.target.style.boxShadow = '0 0 0 1px #00E5FF';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#2D3748';
            e.target.style.boxShadow = 'inset 0 1px 2px rgba(0,0,0,0.2)';
          }}
          style={{
            fontFamily: 'inherit',
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid #2D3748',
            color: '#E2E8F0',
            fontSize: '14px',
            fontWeight: '500',
            outline: 'none',
            width: '100%',
            boxSizing: 'border-box',
            padding: '8px 12px',
            borderRadius: '6px',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)',
            transition: 'all 0.2s ease'
          }}
          placeholder="Project name..."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const val = name.trim();
              if (val) onSave(val);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              onClose();
            }
          }}
        />

        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <button
            style={{
              fontFamily: 'inherit',
              flex: 1,
              background: 'transparent',
              border: '1px solid #4A5568',
              color: '#E2E8F0',
              padding: '8px 0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '500',
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = '#2D3748';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'transparent';
            }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            style={{
              fontFamily: 'inherit',
              flex: 1,
              background: '#00E5FF',
              border: 'none',
              color: '#0B1120',
              padding: '8px 0',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: '600',
              transition: 'opacity 0.2s ease'
            }}
            onMouseEnter={(e) => e.target.style.opacity = '0.8'}
            onMouseLeave={(e) => e.target.style.opacity = '1'}
            onClick={() => {
              const val = name.trim();
              if (val) onSave(val);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ToolPanel() {
  const {
    activeTool,
    activeProjectTool, setActiveProjectTool,
    activeLandmarkTool, setActiveLandmarkTool,
    closeSidePopups,
    getExportProject,
    floorPlanManagerRef,
    polygonManagerRef,
    pinManagerRef,
    activeLayerId,
    isDrawingInProgressRef
  } = useWorkspace();
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [saveBundleDialogOpen, setSaveBundleDialogOpen] = useState(false);
  const [defaultZipName, setDefaultZipName] = useState('project');
  const [blockedMessage, setBlockedMessage] = useState(null);
  const blockedTimerRef = React.useRef(null);

  // Shown when the user tries to switch tools mid-draw. Polygon/road drawing
  // state lives in MapWorkspace's map listeners, not here — isDrawingInProgressRef
  // is the shared flag that lets this component know a draw is in progress.
  const triggerBlockedMessage = () => {
    const isRoad = (activeTool || '').includes('road');
    setBlockedMessage(isRoad ? 'Complete or press Esc to cancel the road' : 'Complete or press Esc to cancel the polygon');
    if (blockedTimerRef.current) clearTimeout(blockedTimerRef.current);
    blockedTimerRef.current = setTimeout(() => setBlockedMessage(null), 2000);
  };

  const getJSONString = (data) => JSON.stringify(data, null, 2);

  const handleExportJSON = () => {
    const data = getExportProject();
    const blob = new Blob([getJSONString(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-${data.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const getKMLStringExport = (data) => generateKMLString(data, 'kml');

  const handleExportKML = () => {
    const data = getExportProject();
    const kml = getKMLStringExport(data);
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-${data.id || 'export'}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    setExportMenuOpen(false);
  };

  const getKMZBlob = async (data) => {
    const zip = new JSZip();
    const filesFolder = zip.folder("files");

    if (data.floorPlans) {
      for (const fp of data.floorPlans) {
        if (fp.floorplan && fp.floorplan.startsWith('blob:')) {
          const bytes = await blobUrlToBytes(fp.floorplan);
          if (bytes) filesFolder.file(`floorplan-${fp.id}.png`, bytes);
        } else if (fp.floorplan && fp.floorplan.startsWith('data:')) {
          const base64Data = fp.floorplan.split(',')[1];
          filesFolder.file(`floorplan-${fp.id}.png`, base64Data, { base64: true });
        }
      }
    }

    if (data.pins) {
      for (const pin of data.pins) {
        if (pin.styleMode === 'custom' && pin.imageDataUrl) {
          if (pin.imageDataUrl.startsWith('data:')) {
            const base64Data = pin.imageDataUrl.split(',')[1];
            filesFolder.file(`pin-${pin.id}.png`, base64Data, { base64: true });
          } else if (pin.imageDataUrl.startsWith('blob:')) {
            const bytes = await blobUrlToBytes(pin.imageDataUrl);
            if (bytes) filesFolder.file(`pin-${pin.id}.png`, bytes);
          }
        }
      }
    }

    const kml = generateKMLString(data, 'kmz');
    zip.file("doc.kml", kml);

    return await zip.generateAsync({ type: "blob" });
  };

  const handleExportKMZ = async () => {
    setExportMenuOpen(false);
    const data = getExportProject();

    try {
      const blob = await getKMZBlob(data);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${data.id || 'export'}.kmz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("KMZ generation failed", e);
    }
  };

  const populateZIPImages = async (data, zip) => {
    if (data.floorPlans && data.floorPlans.length > 0) {
      for (const fp of data.floorPlans) {
        if (!fp.floorplan) continue;

        let img = floorPlanManagerRef.current?.overlays.get(fp.id)?.overlay?.imgEl;

        // If we couldn't get the already-loaded image, load it fresh
        if (!img || !img.complete || img.naturalWidth === 0) {
          img = await new Promise((resolve, reject) => {
            const newImg = new Image();
            newImg.crossOrigin = "anonymous";
            newImg.onload = () => resolve(newImg);
            newImg.onerror = () => {
              console.error("Failed to load image for ZIP export", fp.floorplan);
              resolve(null); // resolve null so we skip this file instead of crashing the export
            };
            newImg.src = fp.floorplan;
          });
        }

        if (img && img.naturalWidth > 0) {
          const bakedBlob = await bakeFloorplanImage(img, fp);
          if (bakedBlob) {
            zip.file(`floorplan-${fp.id}.png`, bakedBlob);
          }
        }
      }
    }
  };

  const handleExportZIP = async () => {
    setExportMenuOpen(false);
    const data = getExportProject();
    const zip = new JSZip();
    const projectName = data.id || 'project';

    await populateZIPImages(data, zip);

    const kml = generateKMLString(data, 'zip');
    zip.file(`${projectName}.kml`, kml);

    try {
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("ZIP generation failed", e);
    }
  };

  const handleSaveProject = async (fileName) => {
    setSaveBundleDialogOpen(false);
    const data = getExportProject();
    const bundleZip = new JSZip();

    // 1. Map images (exact same distorted/stretched image output as current "export as zip")
    await populateZIPImages(data, bundleZip);

    // 2. KML file (identical output to current KML export)
    const kmlString = getKMLStringExport(data);
    bundleZip.file(`${fileName}.kml`, kmlString);

    // 3. JSON file (identical structure/output to current JSON export)
    const jsonString = getJSONString(data);
    bundleZip.file(`${fileName}.json`, jsonString);

    // 4. KMZ file (identical output to current KMZ export)
    try {
      const kmzBlob = await getKMZBlob(data);
      bundleZip.file(`${fileName}.kmz`, kmzBlob);
    } catch (e) {
      console.error("Failed to generate KMZ for bundle", e);
    }

    try {
      const bundleBlob = await bundleZip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(bundleBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Bundle ZIP generation failed", e);
    }
  };

  const getAncestorFolderNames = (node) => {
    const names = [];
    let cur = node.parentNode;
    while (cur) {
      const tag = cur.tagName || cur.nodeName || cur.localName;
      if (tag === 'Folder') {
        const nameNode = Array.from(cur.childNodes || []).find(c => (c.tagName || c.nodeName) === 'name');
        const nm = nameNode?.textContent?.trim();
        if (nm) names.push(nm);
      }
      cur = cur.parentNode;
    }
    return names; // immediate parent Folder name first, root-most last
  };

  const readExtendedData = (pm) => {
    const ext = pm.getElementsByTagName('ExtendedData')[0];
    const out = {};
    if (!ext) return out;
    const dataNodes = ext.getElementsByTagName('Data');
    for (let d = 0; d < dataNodes.length; d++) {
      const nm = dataNodes[d].getAttribute('name');
      const val = dataNodes[d].getElementsByTagName('value')[0]?.textContent;
      if (nm) out[nm] = val;
    }
    return out;
  };

  const processKMLDoc = async (doc, zip) => {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let hasBounds = false;

    const updateBounds = (lat, lng) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      hasBounds = true;
    };

    const groundOverlays = doc.getElementsByTagName('GroundOverlay');
    const floorPlanMap = {}; // Maps KML name to fp.id for folder grouping
    for (let i = 0; i < groundOverlays.length; i++) {
      const go = groundOverlays[i];
      const goName = go.getElementsByTagName('name')[0]?.textContent?.trim();
      const href = go.getElementsByTagName('href')[0]?.textContent;
      let blobUrl = null;

      if (href) {
        if (zip) {
          const imageFile = zip.file(href);
          if (imageFile) {
            const imgBlob = await imageFile.async('blob');
            blobUrl = URL.createObjectURL(imgBlob);
          }
        } else {
          blobUrl = href;
        }
      }

      let rotation = 0;
      let isDistortedFlag = null;
      let scale = undefined;
      const extData = go.getElementsByTagName('ExtendedData')[0];
      if (extData) {
        const dataNodes = extData.getElementsByTagName('Data');
        for (let d = 0; d < dataNodes.length; d++) {
          const dName = dataNodes[d].getAttribute('name');
          const dValue = dataNodes[d].getElementsByTagName('value')[0]?.textContent;
          if (dName === 'isDistorted') {
            isDistortedFlag = dValue === 'true';
          } else if (dName === 'rotation') {
            rotation = parseFloat(dValue || 0);
          } else if (dName === 'scale') {
            scale = parseFloat(dValue || 1);
          }
        }
      }

      const latLonQuad = go.getElementsByTagName('gx:LatLonQuad')[0] || go.getElementsByTagName('LatLonQuad')[0];
      const latLonBox = go.getElementsByTagName('LatLonBox')[0];
      let corners = null;
      let distortedCorners = null;
      let bounds = null;

      if (latLonQuad) {
        const coordsStr = latLonQuad.getElementsByTagName('coordinates')[0]?.textContent;
        if (coordsStr) {
          const pts = coordsStr.trim().split(/\s+/).map(p => {
            const [lng, lat] = p.split(',').map(Number);
            return { lat, lng };
          });
          if (pts.length >= 4) {
            distortedCorners = { sw: pts[0], se: pts[1], ne: pts[2], nw: pts[3] };
            corners = distortedCorners;

            let minLatQ = 90, maxLatQ = -90, minLngQ = 180, maxLngQ = -180;
            pts.forEach(pt => {
              updateBounds(pt.lat, pt.lng);
              if (pt.lat < minLatQ) minLatQ = pt.lat;
              if (pt.lat > maxLatQ) maxLatQ = pt.lat;
              if (pt.lng < minLngQ) minLngQ = pt.lng;
              if (pt.lng > maxLngQ) maxLngQ = pt.lng;
            });
            bounds = { ne: { lat: maxLatQ, lng: maxLngQ }, sw: { lat: minLatQ, lng: minLngQ } };

            if (isDistortedFlag === false) {
              distortedCorners = null;
            }
          }
        }
      } else if (latLonBox) {
        const n = parseFloat(latLonBox.getElementsByTagName('north')[0]?.textContent || 0);
        const s = parseFloat(latLonBox.getElementsByTagName('south')[0]?.textContent || 0);
        const e = parseFloat(latLonBox.getElementsByTagName('east')[0]?.textContent || 0);
        const w = parseFloat(latLonBox.getElementsByTagName('west')[0]?.textContent || 0);
        rotation = parseFloat(latLonBox.getElementsByTagName('rotation')[0]?.textContent || 0);

        bounds = { ne: { lat: n, lng: e }, sw: { lat: s, lng: w } };
        corners = { sw: { lat: s, lng: w }, se: { lat: s, lng: e }, ne: { lat: n, lng: e }, nw: { lat: n, lng: w } };
        updateBounds(n, e);
        updateBounds(s, w);
      }

      if (blobUrl && corners && floorPlanManagerRef.current) {
        const id = 'fp-' + Date.now() + '-' + i;
        if (goName) floorPlanMap[goName] = id;

        // Use addFloorPlan to await image load, then lock
        const center = {
          lat: (bounds.sw.lat + bounds.ne.lat) / 2,
          lng: (bounds.sw.lng + bounds.ne.lng) / 2
        };
        const fpm = floorPlanManagerRef.current;
        await fpm.addFloorPlan(id, blobUrl, center, scale, rotation, 1, undefined, activeLayerId, distortedCorners, goName || `Floor Plan ${i + 1}`);
        fpm.toggleLock(id); // Triggers boundary reset correctly
      }
    }

    const placemarks = doc.getElementsByTagName('Placemark');
    for (let i = 0; i < placemarks.length; i++) {
      const pm = placemarks[i];
      const name = pm.getElementsByTagName('name')[0]?.textContent || `Imported ${i}`;

      // Check if it's inside a folder to match with a floorplan
      let floorPlanId = null;
      if (pm.parentNode && (pm.parentNode.tagName === 'Folder' || pm.parentNode.localName === 'Folder' || pm.parentNode.nodeName === 'Folder')) {
        const folderName = pm.parentNode.getElementsByTagName('name')[0]?.textContent?.trim();
        if (folderName && floorPlanMap[folderName]) {
          floorPlanId = floorPlanMap[folderName];
        }
      }

      // Parse colors from style
      const extractColor = (styleNode) => {
        if (!styleNode) return null;
        const colorNode = styleNode.getElementsByTagName('color')[0];
        if (!colorNode) return null;
        const aabbggrr = colorNode.textContent.trim();
        if (aabbggrr.length >= 8) {
          const bb = aabbggrr.substring(2, 4);
          const gg = aabbggrr.substring(4, 6);
          const rr = aabbggrr.substring(6, 8);
          return `#${rr}${gg}${bb}`;
        }
        return null;
      };

      let polyColor = extractColor(pm.getElementsByTagName('PolyStyle')[0])
        || extractColor(pm.getElementsByTagName('LineStyle')[0])
        || '#ff6b6b';

      const polygon = pm.getElementsByTagName('Polygon')[0];
      if (polygon) {
        const coordsStr = polygon.getElementsByTagName('coordinates')[0]?.textContent;
        if (coordsStr) {
          const path = coordsStr.trim().split(/\s+/).filter(Boolean).map(p => {
            const [lng, lat] = p.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) updateBounds(lat, lng);
            return { lat, lng };
          }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

          if (path.length > 0) {
            const ext = readExtendedData(pm);
            const ancestors = getAncestorFolderNames(pm);
            const inLandmarks = ancestors.includes('Landmarks');
            const inPlots = ancestors[0] === 'Plots';

            const category = ext.appCategory || (inLandmarks ? 'landmark' : (inPlots ? 'unit' : 'project'));
            const layerId = activeLayerId; // imported content always goes into the currently open/active layer, not the original exported layer

            // Find the actual floor-plan folder, skipping structural folder names.
            let fpFolderId = floorPlanId;
            if (!fpFolderId) {
              const structural = new Set(['Plots', 'Landmarks', 'Roads', 'Polygons', 'Pins', ...Object.values(LANDMARK_PIN_TYPE_LABELS)]);
              const fpName = ancestors.find(a => !structural.has(a) && floorPlanMap[a]);
              if (fpName) fpFolderId = floorPlanMap[fpName];
            }

            const isBoundary = category === 'project';
            const id = (isBoundary && fpFolderId) ? `floorplan-boundary-${fpFolderId}` : 'poly-' + Date.now() + '-' + i;
            const metadata = fpFolderId ? { floorPlanId: fpFolderId } : undefined;
            polygonManagerRef.current?.loadPolygon({
              id, name, category, path, color: polyColor, metadata, layerId
            });
          }
        }
      }

      const lineString = pm.getElementsByTagName('LineString')[0];
      if (lineString) {
        const coordsStr = lineString.getElementsByTagName('coordinates')[0]?.textContent;
        if (coordsStr) {
          const path = coordsStr.trim().split(/\s+/).filter(Boolean).map(p => {
            const [lng, lat] = p.split(',').map(Number);
            if (!isNaN(lat) && !isNaN(lng)) updateBounds(lat, lng);
            return { lat, lng };
          }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

          if (path.length > 0) {
            const ext = readExtendedData(pm);
            const id = 'road-' + Date.now() + '-' + i;
            const layerId = activeLayerId; // imported content always goes into the currently open/active layer, not the original exported layer
            const strokeWeight = parseFloat(ext.appLineWidth) || 3;
            const metadata = floorPlanId ? { floorPlanId } : undefined;
            let roadColor = extractColor(pm.getElementsByTagName('LineStyle')[0]) || '#FF9800';
            polygonManagerRef.current?.loadPolygon({
              id, name, category: 'road', path, color: roadColor, strokeWeight, metadata, layerId
            });
          }
        }
      }

      const point = pm.getElementsByTagName('Point')[0];
      if (point) {
        const coordsStr = point.getElementsByTagName('coordinates')[0]?.textContent;
        if (coordsStr) {
          const [lng, lat] = coordsStr.trim().split(',').map(Number);
          if (!isNaN(lat) && !isNaN(lng)) {
            updateBounds(lat, lng);

            const ext = readExtendedData(pm);
            const href = pm.getElementsByTagName('href')[0]?.textContent;
            const isStockIcon = href && href.includes('maps.google.com/mapfiles');
            const wantsCustom = ext.appStyleMode ? ext.appStyleMode === 'custom' : !isStockIcon;

            let imageDataUrl = null;
            if (href && wantsCustom && !isStockIcon) {
              if (zip) {
                const imageFile = zip.file(href);
                if (imageFile) {
                  // Use a base64 data: URL, not a blob: URL. The pin icon is
                  // rendered as an inline <image href="..."> inside an SVG
                  // that's itself wrapped in a data:image/svg+xml URI — and
                  // a blob: URL referenced from within a data: URI's opaque
                  // origin silently fails to load in most browsers. A
                  // self-contained base64 data: URL always works.
                  const base64 = await imageFile.async('base64');
                  const extMatch = /\.(png|jpe?g|gif|webp|svg)$/i.exec(href);
                  const mime = extMatch
                    ? { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[extMatch[1].toLowerCase()]
                    : 'image/png';
                  imageDataUrl = `data:${mime};base64,${base64}`;
                }
              } else {
                imageDataUrl = href;
              }
            }

            const pinColor = ext.appColor || extractColor(pm.getElementsByTagName('IconStyle')[0]) || '#00CED1';
            const customSize = parseFloat(ext.appCustomSize) || 1;
            const layerId = activeLayerId; // imported content always goes into the currently open/active layer, not the original exported layer

            const ancestors = getAncestorFolderNames(pm);
            const inLandmarks = ancestors.includes('Landmarks');
            const category = ext.appCategory || (inLandmarks ? 'landmark' : 'project');
            let landmarkType = ext.appLandmarkType || null;
            if (!landmarkType && category === 'landmark') {
              const typeFolder = ancestors.find(a => LANDMARK_PIN_LABEL_TO_TYPE[a.toLowerCase()]);
              landmarkType = typeFolder ? LANDMARK_PIN_LABEL_TO_TYPE[typeFolder.toLowerCase()] : 'other';
            }

            const resolvedStyleMode = ext.appStyleMode || (imageDataUrl ? 'custom' : 'default');
            const id = 'pin-' + Date.now() + '-' + i;
            const metadata = floorPlanId ? { floorPlanId } : undefined;
            pinManagerRef.current?.loadPin({
              id, name, color: pinColor, position: { lat, lng },
              styleMode: resolvedStyleMode, imageDataUrl, metadata, layerId,
              category, landmarkType, customSize
            });
          }
        }
      }
    }

    const map = polygonManagerRef.current?.map || floorPlanManagerRef.current?.map;
    if (map && window.google?.maps) {
      const lookAt = doc.getElementsByTagName('LookAt')[0];
      const camera = doc.getElementsByTagName('Camera')[0];
      const viewNode = lookAt || camera;
      if (viewNode) {
        const lat = parseFloat(viewNode.getElementsByTagName('latitude')[0]?.textContent || 0);
        const lng = parseFloat(viewNode.getElementsByTagName('longitude')[0]?.textContent || 0);
        map.panTo({ lat, lng });
      } else if (hasBounds) {
        const bnd = new window.google.maps.LatLngBounds(
          new window.google.maps.LatLng(minLat, minLng),
          new window.google.maps.LatLng(maxLat, maxLng)
        );
        map.fitBounds(bnd);
      }
    }
  };

  const handleImportKMZ = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const zip = await JSZip.loadAsync(ev.target.result);

        let kmlFile = null;
        zip.forEach((relativePath, zipEntry) => {
          if (relativePath.toLowerCase().endsWith('.kml')) {
            kmlFile = zipEntry;
          }
        });

        if (!kmlFile) {
          alert('No KML file found in KMZ.');
          return;
        }

        const kmlText = await kmlFile.async('string');
        const parser = new DOMParser();
        const doc = parser.parseFromString(kmlText, 'text/xml');

        await processKMLDoc(doc, zip);
      } catch (e) {
        console.error("KMZ import failed", e);
        alert("Failed to import KMZ");
      }

      e.target.value = null;
    };
    reader.readAsArrayBuffer(file);
  };

  const handleImportKML = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const kmlText = ev.target.result;
        const parser = new DOMParser();
        const doc = parser.parseFromString(kmlText, 'text/xml');

        await processKMLDoc(doc, null);
      } catch (e) {
        console.error("KML import failed", e);
        alert("Failed to import KML");
      }

      e.target.value = null;
    };
    reader.readAsText(file);
  };

  const handleExportProjectTagJSON = () => {
    const data = getExportProject();

    let lat = 0, lng = 0;
    if (data.polygons?.length > 0 && data.polygons[0].path?.length > 0) {
      const path = data.polygons[0].path;
      let sumLat = 0, sumLng = 0;
      path.forEach(p => { sumLat += p.lat; sumLng += p.lng; });
      lat = sumLat / path.length;
      lng = sumLng / path.length;
    } else if (data.pins?.length > 0) {
      lat = data.pins[0].position.lat;
      lng = data.pins[0].position.lng;
    }

    const polygon = data.polygons?.find(p => p.category === 'project')?.path || [{ lat: 0, lng: 0 }];
    const unitPolygonsList = data.polygons?.filter(p => p.category === 'unit' || p.category === 'pending-unit') || [];
    const unitPolygons = unitPolygonsList.map((p, i) => {
      const path = [...p.path];
      if (path.length > 0) {
        const first = path[0];
        const last = path[path.length - 1];
        if (first.lat !== last.lat || first.lng !== last.lng) {
          path.push({ lat: first.lat, lng: first.lng });
        }
      }
      return path; // Plot ${i + 1}
    });

    const units = unitPolygonsList.map((p, index) => {
      let areaSqMeters = 0;
      let lengthStr = "";
      let widthStr = "";

      if (p.path && p.path.length >= 3 && window.google?.maps?.geometry?.spherical) {
        const latLngs = p.path.map(pt => new window.google.maps.LatLng(pt.lat, pt.lng));
        areaSqMeters = polygonArea(latLngs);

        if (p.path.length === 4) {
          const d1 = window.google.maps.geometry.spherical.computeDistanceBetween(latLngs[0], latLngs[1]);
          const d2 = window.google.maps.geometry.spherical.computeDistanceBetween(latLngs[1], latLngs[2]);
          const d3 = window.google.maps.geometry.spherical.computeDistanceBetween(latLngs[2], latLngs[3]);
          const d4 = window.google.maps.geometry.spherical.computeDistanceBetween(latLngs[3], latLngs[0]);

          const maxL = Math.max(d1, d3);
          const maxW = Math.max(d2, d4);
          const formatFeet = (meters) => {
            const totalInches = meters * 39.3701;
            const feet = Math.floor(totalInches / 12);
            const inches = Math.round(totalInches % 12);
            return `${feet}'${inches}`;
          };

          lengthStr = formatFeet(Math.max(maxL, maxW));
          widthStr = formatFeet(Math.min(maxL, maxW));
        }
      }

      const sqyd = areaSqMeters > 0 ? (areaSqMeters * 1.19599).toFixed(2) : 0;

      return {
        id: isNaN(parseInt(p.name, 10)) ? p.name : parseInt(p.name, 10),
        sqyd: Number(sqyd),
        length: lengthStr,
        width: widthStr,
        status: "AVAILABLE",
        orientation: "",
        floorplanId: p.metadata?.floorPlanId || null
      };
    });

    const floorplanEntry = data.floorPlans?.[0] || {};
    const bounds = floorplanEntry.bounds || {
      sw: { lat: 0, lng: 0 },
      ne: { lat: 0, lng: 0 }
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
          areaText: "Kosad Surat, Surat",
          googleMapLink: "",
          mapEmbedUrl: ""
        },
        brochures: ["brochure1.pdf", "brochure2.pdf"],
        legal: ["legal1.pdf", "legal2.pdf"],
        photos: {
          albumName: ["image1.jpg", "image2.jpg"]
        },
        videos: ["video1.mp4", "video2.mp4"],
        floorplans: {
          albumName: ["image1.jpg", "image2.jpg"]
        },
        pinUrl: "External-Files/Assets/Pins",
        lat,
        lng,
        polygon,
        floorplan: "External-Files/Assets/Map-Floorplans",
        bounds,
        unitPolygonsGPS: true,
        unitPolygons,
        units
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


  // Any tool tap closes the polygon popup / side panel before switching tools.
  // Blocked entirely if a polygon/road draw is mid-progress and the tap targets
  // a different tool — same tool tap still passes through (it toggles off,
  // which correctly cancels the in-progress draw).
  const handleProjectTool = (id) => {
    if (isDrawingInProgressRef.current && id !== activeTool) {
      triggerBlockedMessage();
      return;
    }
    closeSidePopups();
    if (id === 'proj-floor-plan') {
      document.getElementById('fp-upload-input')?.click();
      return;
    }
    setActiveProjectTool((prev) => (prev === id ? null : id));
  };
  const handleLandmarkTool = (id) => {
    if (isDrawingInProgressRef.current && id !== activeTool) {
      triggerBlockedMessage();
      return;
    }
    closeSidePopups();
    setActiveLandmarkTool((prev) => (prev === id ? null : id));
  };

  // ── Collapsed — only show the hamburger ───────────────────────────────────
  // ── Always expanded, all tools visible ───────────────────────────────────
  return (
    <div className="tp-panel" id="tp-panel">

      {blockedMessage && (
        <div
          style={{
            position: 'fixed',
            top: '54px',
            left: '360px',
            background: '#1A202C',
            color: '#E2E8F0',
            border: '1px solid #2D3748',
            borderRadius: '6px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            zIndex: 1000000,
            pointerEvents: 'none',
          }}
        >
          {blockedMessage}
        </div>
      )}

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
            onClick={() => {
              if (id === 'radius') return;
              handleLandmarkTool(`lm-${id}`);
            }}
          />
        ))}
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
              <button className="tp-export-item" onClick={handleExportZIP}>Export as ZIP</button>
              <button className="tp-export-item" onClick={handleExportJSON}>Export as JSON</button>
              <button className="tp-export-item" onClick={handleExportProjectTagJSON}>Export Project Tag JSON</button>
            </div>
          )}
        </div>
        <ToolBtn
          id="save-project"
          label="Save"
          Icon={SaveIcon}
          onClick={() => {
            const data = getExportProject();
            setDefaultZipName(data.id || 'project');
            setSaveBundleDialogOpen(true);
          }}
        />

        <ToolBtn
          id="import-kmz"
          label="Import KMZ"
          Icon={FolderIcon}
          onClick={() => document.getElementById('kmz-upload-input')?.click()}
        />
        <ToolBtn
          id="import-kml"
          label="Import KML"
          Icon={FolderIcon}
          onClick={() => document.getElementById('kml-upload-input')?.click()}
        />
      </div>

      {/* Modals */}

      {saveBundleDialogOpen && (
        <SaveBundleDialog
          defaultName={defaultZipName}
          onClose={() => setSaveBundleDialogOpen(false)}
          onSave={handleSaveProject}
        />
      )}

      <input
        type="file"
        id="kmz-upload-input"
        accept=".kmz"
        style={{ display: 'none' }}
        onChange={handleImportKMZ}
      />
      <input
        type="file"
        id="kml-upload-input"
        accept=".kml"
        style={{ display: 'none' }}
        onChange={handleImportKML}
      />
    </div>
  );
}