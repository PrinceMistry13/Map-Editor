// ── Legacy combined export (landmarks.js + proj-XX.js in one file) ─────────
// Produces the exact hand-authored JS structure used by the older
// site-template pipeline:
//   1. `locations`  — landmark pins, as { lat, lng, name, fname }
//   2. `polylines`  — landmark roads/bridges, as { name, fname, color, latlng }
//   3. `pinMap`     — landmark-type -> icon path
//   4. `projects`   — one project object per floorplan, in the
//                     proj-38-style shape: polygon / phaseNPolygon /
//                     unitPolygons (numbered) / units / floorplan / bounds
//
// This is intentionally plain string-building (not JSON.stringify) so we
// can keep the "// Plot N" inline comments the template relies on.

import { polygonArea } from './polygonMetrics';

// Internal landmarkType key (as stored on pins) -> display `fname` used by
// the legacy template's `locations`/pinMap. Edit this table if your pin
// icon set uses different labels.
const LANDMARK_FNAME_MAP = {
    brts: 'BRTS',
    metro: 'Metro',
    railway: 'Railway',
    roads: 'Roads',
    bridges: 'Bridge',
    circle: 'Circle',
    school: 'School',
    college: 'College',
    hospital: 'Hospital',
    grocery: 'Grocery',
    garden: 'Garden',
    lake: 'Lake',
    temple: 'Temple',
    multiplex: 'Multiplex',
    police: 'Police',
    textile: 'Textile Market',
};

// Default pin icon paths per landmark type. Point these at your real
// media assets — these are placeholders mirroring the template's naming.
const DEFAULT_PIN_MAP = {
    BRTS: 'media/pin-brts.webp',
    Railway: 'media/pin-railway.webp',
    Metro: 'media/pin-metro.webp',
    Roads: 'media/pin-roads.webp',
    Bridge: 'media/pin-bridge.webp',
    Circle: 'media/pin-circle.webp',
    School: 'media/pin-school.webp',
    College: 'media/pin-college.webp',
    Hospital: 'media/pin-hospital.webp',
    Grocery: 'media/pin-grocery.webp',
    Garden: 'media/pin-garden.webp',
    Lake: 'media/pin-lake.webp',
    Temple: 'media/pin-temple.webp',
    Multiplex: 'media/pin-multiplex.webp',
    Police: 'media/pin-police.webp',
    'Textile Market': 'media/pin-textile.webp',
};

function num(n, precision = 8) {
    return Number(n.toFixed(precision));
}

function closeRing(path) {
    if (!path.length) return path;
    const first = path[0];
    const last = path[path.length - 1];
    if (first.lat !== last.lat || first.lng !== last.lng) {
        return [...path, { lat: first.lat, lng: first.lng }];
    }
    return path;
}

function centroid(path) {
    if (!path.length) return { lat: 0, lng: 0 };
    let sumLat = 0, sumLng = 0;
    path.forEach(p => { sumLat += p.lat; sumLng += p.lng; });
    return { lat: sumLat / path.length, lng: sumLng / path.length };
}

function plotLengthWidth(path) {
    let lengthStr = '', widthStr = '', sqyd = 0;
    if (path && path.length >= 3 && window.google?.maps?.geometry?.spherical) {
        const latLngs = path.map(pt => new window.google.maps.LatLng(pt.lat, pt.lng));
        const areaSqMeters = polygonArea(latLngs);
        sqyd = areaSqMeters > 0 ? Number((areaSqMeters * 1.19599).toFixed(2)) : 0;

        if (path.length === 4) {
            const spherical = window.google.maps.geometry.spherical;
            const d1 = spherical.computeDistanceBetween(latLngs[0], latLngs[1]);
            const d2 = spherical.computeDistanceBetween(latLngs[1], latLngs[2]);
            const d3 = spherical.computeDistanceBetween(latLngs[2], latLngs[3]);
            const d4 = spherical.computeDistanceBetween(latLngs[3], latLngs[0]);
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
    return { sqyd, lengthStr, widthStr };
}

// ── locations / polylines / pinMap ──────────────────────────────────────

function buildLocationsSource(pins) {
    const landmarkPins = (pins || []).filter(p => p.category === 'landmark');
    const lines = landmarkPins.map(p => {
        const fname = LANDMARK_FNAME_MAP[p.landmarkType] || p.landmarkType || 'Other';
        const lat = num(p.position.lat);
        const lng = num(p.position.lng);
        const name = JSON.stringify(p.name || fname);
        return `    { lat: ${lat}, lng: ${lng}, name: ${name}, fname: "${fname}" },`;
    });
    return `let locations = [\n${lines.join('\n')}\n];`;
}

function buildPolylinesSource(roads) {
    const landmarkRoads = (roads || []).filter(r => r.category === 'road' || r.category === 'bridge');
    const entries = landmarkRoads.map(r => {
        const fname = r.category === 'bridge' ? 'Bridge' : 'Roads';
        const pts = (r.points || [])
            .map(p => `            { lng: ${num(p.lng)}, lat: ${num(p.lat)} },`)
            .join('\n');
        return `    {\n        name: ${JSON.stringify(r.name || fname)},\n        fname: "${fname}",\n        color: ${JSON.stringify(r.lineColor || '')},\n        latlng: [\n${pts}\n        ]\n    },`;
    });
    return `const polylines = [\n${entries.join('\n')}\n];`;
}

function buildPinMapSource() {
    const lines = Object.entries(DEFAULT_PIN_MAP)
        .map(([k, v]) => `    ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)},`);
    return `const pinMap = {\n${lines.join('\n')}\n};`;
}

// ── per-floorplan project object ────────────────────────────────────────

function buildProjectSource(floorPlan, allPolygons, index, totalFloorPlans) {
    const fpId = floorPlan.id;
    // A polygon with no floorPlanId tag (drawn without the floorplan's folder
    // selected) is still counted as belonging to this floorplan when it's the
    // only floorplan in the project — otherwise it'd silently vanish from export.
    const inThisFloorplan = (p) => {
        const tag = p.metadata?.floorPlanId ?? null;
        if (tag === fpId) return true;
        if (tag === null && totalFloorPlans === 1) return true;
        return false;
    };

    const projectPolys = allPolygons.filter(p => p.category === 'project' && inThisFloorplan(p));
    const unitPolysList = allPolygons
        .filter(p => (p.category === 'unit' || p.category === 'pending-unit') && inThisFloorplan(p))
        .sort((a, b) => {
            const an = parseInt(a.name, 10), bn = parseInt(b.name, 10);
            if (!isNaN(an) && !isNaN(bn)) return an - bn;
            return String(a.name).localeCompare(String(b.name));
        });

    // unitPolygons — closed rings, one `// Plot N` comment per entry, exact
    // template formatting (single-line array-of-objects per plot).
    const unitPolygonLines = unitPolysList.map(p => {
        const ring = closeRing(p.path);
        const ptsStr = ring.map(pt => `{ lat: ${num(pt.lat)}, lng: ${num(pt.lng)} }`).join(', ');
        return `                [${ptsStr}],  // Plot ${p.name}`;
    });

    const units = unitPolysList.map(p => {
        const { sqyd, lengthStr, widthStr } = plotLengthWidth(p.path);
        const id = isNaN(parseInt(p.name, 10)) ? JSON.stringify(p.name) : parseInt(p.name, 10);
        return `                { id: ${id}, sqyd: ${sqyd || 'null'}, length: ${lengthStr ? JSON.stringify(lengthStr) : 'null'}, width: ${widthStr ? JSON.stringify(widthStr) : 'null'}, status: "AVAILABLE", orientation: "east" },`;
    });

    // Phase boundaries: if there's exactly one 'project'-category boundary
    // under this floorplan, it goes in `polygon` (phaseN arrays omitted).
    // If there are 2+, `polygon` stays empty and each becomes phaseNPolygon,
    // in creation order.
    const singleBoundary = projectPolys.length === 1;

    const polygonField = singleBoundary
        ? (() => {
            const ring = closeRing(projectPolys[0].path);
            const ptsStr = ring.map(pt => `{ lat: ${num(pt.lat)}, lng: ${num(pt.lng)} }`).join(', ');
            return `[${ptsStr}]`;
        })()
        : '[]';

    const phaseBlocks = singleBoundary
        ? []
        : projectPolys.map((p, i) => {
            const ring = closeRing(p.path);
            const ptsStr = ring.map(pt => `{ lat: ${num(pt.lat)}, lng: ${num(pt.lng)} }`).join(', ');
            return `    phase${i + 1}Polygon: [${ptsStr}],`;
        });

    const centerSource = unitPolysList.length
        ? centroid(unitPolysList[0].path)
        : (projectPolys.length ? centroid(projectPolys[0].path) : { lat: 0, lng: 0 });

    const bounds = floorPlan.bounds || { sw: { lat: 0, lng: 0 }, ne: { lat: 0, lng: 0 } };

    return `{
    id: "proj-${index + 1}",
    name: ${JSON.stringify(floorPlan.name || `Project ${index + 1}`)},
    subTitle: "",
    thumbnailUrl: "",
    areaText: "",
    pinUrl: "",
    lat: ${num(centerSource.lat)},
    lng: ${num(centerSource.lng)},
    polygon: ${polygonField},
    unitPolygonsGPS: true,
    unitPolygons: [
${unitPolygonLines.join('\n')}
    ],
    units: [
${units.join('\n')}
    ],${phaseBlocks.length ? '\n' + phaseBlocks.join('\n') : ''}
    floorplan: ${JSON.stringify(floorPlan.floorplan || '')},
    bounds: {
    sw: { lat: ${num(bounds.sw.lat)}, lng: ${num(bounds.sw.lng)} },
    ne: { lat: ${num(bounds.ne.lat)}, lng: ${num(bounds.ne.lng)} }
  }
}`;
}

// ── top-level export ────────────────────────────────────────────────────

/**
 * Builds the full combined JS source (landmarks section first, then the
 * per-floorplan project structures) from getExportProject() data.
 * @param {Object} data - result of useWorkspace().getExportProject()
 * @returns {string} JS source text, ready to save as a .js file
 */
export function buildLegacyExportSource(data) {
    const pins = data.pins || [];
    const roads = data.roads || [];
    const polygons = data.polygons || [];
    const floorPlans = data.floorPlans || [];

    const locationsSrc = buildLocationsSource(pins);
    const polylinesSrc = buildPolylinesSource(roads);
    const pinMapSrc = buildPinMapSource();

    const projectSources = floorPlans.length
        ? floorPlans.map((fp, i) => buildProjectSource(fp, polygons, i, floorPlans.length))
        : [buildProjectSource({ id: null, name: 'Project 1', bounds: null, floorplan: '' }, polygons, 0, 1)];

    return `// ═══════════════════════════════════════════════════════════════════════
// LANDMARKS — pins, roads/bridges, icon map
// ═══════════════════════════════════════════════════════════════════════

${locationsSrc}

${polylinesSrc}

${pinMapSrc}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT DATA — one entry per floorplan
// ═══════════════════════════════════════════════════════════════════════

const projects = [
${projectSources.map(s => s.split('\n').map(l => '  ' + l).join('\n')).join(',\n')}
];

export { locations, polylines, pinMap, projects };
`;
}

/**
 * Triggers a browser download of the combined export.
 * @param {Object} data - result of getExportProject()
 * @param {string} filename
 */
export function downloadLegacyExport(data, filename = 'project-export.js') {
    const source = buildLegacyExportSource(data);
    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}