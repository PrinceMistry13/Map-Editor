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

// Fixed landmark icon set bundled with every standalone export (see
// public/landmark-icons/ — copy the provided PNGs there). Keyed by the same
// `fname` labels as LANDMARK_FNAME_MAP/DEFAULT_PIN_MAP above, so pinMap's
// key list stays identical to the real legacy export; only the values point
// at real local files instead of the "media/pin-*.webp" placeholders. A few
// types without a dedicated icon fall back to the closest available one.
const LANDMARK_ICON_FILES = {
    BRTS: 'BRTS.png',
    Railway: 'Metro.png',
    Metro: 'Metro.png',
    Roads: 'Road.png',
    Bridge: 'Bridges.png',
    Circle: 'Circle.png',
    School: 'School.png',
    College: 'College.png',
    Hospital: 'Hospital.png',
    Grocery: 'Grocery.png',
    Garden: 'Garden.png',
    Lake: 'Lake.png',
    Temple: 'Circle.png',
    Multiplex: 'Multiplex.png',
    Police: 'Circle.png',
    'Textile Market': 'Grocery.png',
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

// Finds the single custom (non-landmark) pin belonging to this floorplan/
// project — matched purely by NAME equality (case-insensitive, trimmed)
// between the pin's name and the floorplan's own name. metadata.floorPlanId
// is ignored entirely for this match.
function findProjectPin(pins, floorPlanName) {
    if (!floorPlanName) return null;
    const target = String(floorPlanName).trim().toLowerCase();
    return (pins || []).find(p =>
        p.category !== 'landmark' &&
        p.position &&
        (p.imageDataUrl || p.imageUrl) &&
        p.name && String(p.name).trim().toLowerCase() === target
    ) || null;
}

function buildProjectSource(floorPlan, allPolygons, index, totalFloorPlans, floorplanUrlOverride = undefined, projectPin = null, pinUrlValue = '') {
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

    // lat/lng come only from a custom-uploaded project pin, if one exists —
    // no more centroid-of-Plot-1 fallback guess.
    const centerSource = projectPin ? projectPin.position : { lat: 0, lng: 0 };

    const bounds = floorPlan.bounds || { sw: { lat: 0, lng: 0 }, ne: { lat: 0, lng: 0 } };

    return `{
    id: "proj-${index + 1}",
    name: ${JSON.stringify(floorPlan.name || `Project ${index + 1}`)},
    subTitle: "",
    thumbnailUrl: "",
    areaText: "",
    pinUrl: ${JSON.stringify(pinUrlValue || '')},
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
    floorplan: ${JSON.stringify(floorplanUrlOverride !== undefined ? floorplanUrlOverride : (floorPlan.floorplan || ''))},
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
        ? floorPlans.map((fp, i) => {
            const pin = findProjectPin(pins, fp.name);
            // No zip here — the image just points at whatever URL the pin
            // already has (data: or blob:).
            const pinUrl = pin ? (pin.imageDataUrl || pin.imageUrl || '') : '';
            return buildProjectSource(fp, polygons, i, floorPlans.length, undefined, pin, pinUrl);
        })
        : [(() => {
            const pin = findProjectPin(pins, 'Project 1');
            const pinUrl = pin ? (pin.imageDataUrl || pin.imageUrl || '') : '';
            return buildProjectSource({ id: null, name: 'Project 1', bounds: null, floorplan: '' }, polygons, 0, 1, undefined, pin, pinUrl);
        })()];

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

// ── Standalone "Download Map" package (Preview screen) ─────────────────
// Builds a self-contained { index.html, main.js } pair that reads the
// exact same locations/polylines/pinMap/projects structure as the legacy
// export above, plus a small Google Maps render engine, so the zip works
// standalone when opened in a browser. Floorplan images and any custom
// landmark pin icons are bundled as local files under images/floorplan/
// and images/locationsPin/ — the caller is responsible for writing those
// files into the zip; this module only needs to know their relative paths
// and file names so `main.js` references match.

// Which custom project pins (one per floorplan, or one default when there's
// no floorplan) need their image bundled into images/pin/ for the standalone
// zip export. Returns [{ fpId, fileName, pin }].
export function getUsedProjectPinFiles(pins, floorPlans) {
    const result = [];
    if (floorPlans && floorPlans.length) {
        floorPlans.forEach(fp => {
            const pin = findProjectPin(pins, fp.name);
            if (pin && (pin.imageDataUrl || pin.imageUrl)) {
                result.push({ fpId: fp.id, fileName: `pin-${fp.id}.png`, pin });
            }
        });
    } else {
        const pin = findProjectPin(pins, 'Project 1');
        if (pin && (pin.imageDataUrl || pin.imageUrl)) {
            result.push({ fpId: 'default', fileName: 'pin-default.png', pin });
        }
    }
    return result;
}

// Which of the fixed bundled icon files are actually needed for this
// project's pins — used by the caller to only zip the files that matter,
// instead of the entire icon set every time.
export function getUsedLandmarkIconFiles(pins) {
    const landmarkPins = (pins || []).filter(p => p.category === 'landmark');
    const seen = new Set();
    const result = [];
    landmarkPins.forEach(p => {
        const fname = LANDMARK_FNAME_MAP[p.landmarkType] || p.landmarkType || 'Other';
        const fileName = LANDMARK_ICON_FILES[fname];
        if (!fileName || seen.has(fileName)) return;
        seen.add(fileName);
        result.push({ fname, fileName });
    });
    return result;
}

// Identical key list/format to buildPinMapSource() above — same `fname`
// keys, same object shape — just pointed at the real bundled icon files
// under images/locationsPin/ instead of the "media/pin-*.webp" placeholders.
function buildStandalonePinMapSource() {
    const lines = Object.entries(LANDMARK_ICON_FILES)
        .map(([k, fileName]) => `    ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(`images/locationsPin/${fileName}`)},`);
    return `const pinMap = {\n${lines.join('\n')}\n};`;
}

function standaloneRenderEngineSource(apiKey) {
    return `
/* ---------------------------------------------------------------------
 * Map render engine — draws floorplans, project boundaries, unit plots,
 * landmark pins and roads from the data above onto a Google Map.
 * ------------------------------------------------------------------- */
let mapInstance = null;
const makeInfoWindow = () => new google.maps.InfoWindow();

function formatUnit(unit) {
    if (!unit) return '';
    const parts = [];
    if (unit.id !== undefined) parts.push('Plot ' + unit.id);
    if (unit.sqyd) parts.push(unit.sqyd + ' sq.yd');
    if (unit.length && unit.width) parts.push(unit.length + ' x ' + unit.width);
    if (unit.status) parts.push(unit.status);
    return parts.join(' &middot; ');
}

function drawProject(project) {
    const bounds = new google.maps.LatLngBounds();

    if (project.pinUrl && project.lat && project.lng) {
        // Matches the editor's project-pin look: a 120x80 image with its
        // bottom edge anchored exactly at the coordinate (like a map pin
        // tip), not centered on it.
        new google.maps.Marker({
            map: mapInstance,
            position: { lat: project.lat, lng: project.lng },
            icon: {
                url: project.pinUrl,
                scaledSize: new google.maps.Size(120, 80),
                anchor: new google.maps.Point(60, 80)
            },
            zIndex: 50
        });
        bounds.extend({ lat: project.lat, lng: project.lng });
    }

    if (project.floorplan && project.bounds) {
        const swLL = new google.maps.LatLng(project.bounds.sw.lat, project.bounds.sw.lng);
        const neLL = new google.maps.LatLng(project.bounds.ne.lat, project.bounds.ne.lng);
        new google.maps.GroundOverlay(project.floorplan, new google.maps.LatLngBounds(swLL, neLL), { map: mapInstance, opacity: 1 });
        bounds.extend(swLL);
        bounds.extend(neLL);
    }

    if (project.polygon && project.polygon.length) {
        new google.maps.Polygon({
            map: mapInstance,
            paths: project.polygon,
            strokeColor: '#00d4ff',
            strokeWeight: 2,
            fillOpacity: 0.05
        });
        project.polygon.forEach(pt => bounds.extend(pt));
    }

    (project.unitPolygons || []).forEach((path, i) => {
        const unit = (project.units || [])[i];
        const poly = new google.maps.Polygon({
            map: mapInstance,
            paths: path,
            strokeColor: '#ff9800',
            strokeWeight: 1.5,
            fillColor: '#ff9800',
            fillOpacity: 0.25
        });
        path.forEach(pt => bounds.extend(pt));
        poly.addListener('click', function (e) {
            const iw = makeInfoWindow();
            iw.setContent('<div style="font-family:sans-serif;font-size:13px">' + formatUnit(unit) + '</div>');
            iw.setPosition(e.latLng);
            iw.open(mapInstance);
        });
    });

    return bounds;
}

const landmarkCategoryEntries = {};

function drawLandmarks() {
    const bounds = new google.maps.LatLngBounds();

    (typeof polylines !== 'undefined' ? polylines : []).forEach(function (line) {
        const poly = new google.maps.Polyline({
            map: mapInstance,
            path: line.latlng,
            strokeColor: line.color || '#00d4ff',
            strokeWeight: 3
        });
        const cat = line.fname || 'Roads';
        if (!landmarkCategoryEntries[cat]) landmarkCategoryEntries[cat] = [];
        landmarkCategoryEntries[cat].push(poly);
        line.latlng.forEach(function (pt) { bounds.extend(pt); });
    });

        (typeof locations !== 'undefined' ? locations : []).forEach(function (loc) {
        const iconUrl = (typeof pinMap !== 'undefined' && pinMap[loc.fname]) || null;
        const marker = createTextPinOverlay(loc, iconUrl);
        marker.setMap(mapInstance);
        const cat = loc.fname || 'Other';
        if (!landmarkCategoryEntries[cat]) landmarkCategoryEntries[cat] = [];
        landmarkCategoryEntries[cat].push(marker);
        bounds.extend(new google.maps.LatLng(loc.lat, loc.lng));
    });

    return bounds;
}

/* Custom OverlayView pin matching the editor's .textPin style exactly:
 * icon + label pill with an arrow pointing down at the coordinate. Text
 * is the pin's exact editor-entered name (loc.name), never a placeholder. */
function createTextPinOverlay(loc, iconUrl) {
    function TextPinOverlay() {
        this.position = new google.maps.LatLng(loc.lat, loc.lng);
        this.div = null;
        this.visible = true;
    }
    TextPinOverlay.prototype = new google.maps.OverlayView();

    TextPinOverlay.prototype.onAdd = function () {
        const div = document.createElement('div');
        div.className = 'textPin';
        div.style.cssText = 'pointer-events:auto; font:400 11px Roboto, Arial, sans-serif; position:absolute; background-color:rgba(0,0,0,0.8); color:#ffffff; padding:4px 5px; border-radius:8px; font-size:10px; box-shadow:0 2px 6px rgba(0,0,0,0.3); cursor:pointer; display:flex; align-items:center; gap:6px; max-width:200px; white-space:pre-wrap; transform:translate(-50%, -100%);';

        if (iconUrl) {
            const img = document.createElement('img');
            img.src = iconUrl;
            img.style.cssText = 'width:20px; height:20px; flex-shrink:0;';
            div.appendChild(img);
        }

        const span = document.createElement('span');
        span.textContent = loc.name;
        div.appendChild(span);

        const arrow = document.createElement('div');
        arrow.className = 'arrowDiv';
        arrow.style.cssText = 'position:absolute; top:100%; left:50%; transform:translateX(-50%); border-left:8px solid transparent; border-right:8px solid transparent; border-top:10px solid rgba(0,0,0,0.8);';
        div.appendChild(arrow);

        div.addEventListener('click', function () {
            window.open('https://www.google.com/maps?q=' + loc.lat + ',' + loc.lng, '_blank');
        });

        this.div = div;
        this.getPanes().overlayMouseTarget.appendChild(div);
    };

    TextPinOverlay.prototype.draw = function () {
        if (!this.div) return;
        const pos = this.getProjection().fromLatLngToDivPixel(this.position);
        this.div.style.left = pos.x + 'px';
        this.div.style.top = pos.y + 'px';
        this.div.style.display = this.visible ? 'flex' : 'none';
    };

    TextPinOverlay.prototype.onRemove = function () {
        if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
        this.div = null;
    };

    TextPinOverlay.prototype.setVisible = function (v) {
        this.visible = v;
        if (this.div) this.div.style.display = v ? 'flex' : 'none';
    };

    return new TextPinOverlay();
}

function setLandmarkCategoryVisible(category, visible) {
    (landmarkCategoryEntries[category] || []).forEach(function (obj) {
        if (obj.setVisible) obj.setVisible(visible);
        else if (obj.setMap) obj.setMap(visible ? mapInstance : null);
    });
}

function injectLandmarkFilterCss() {
    if (document.getElementById('lm-filter-style')) return;
    const style = document.createElement('style');
    style.id = 'lm-filter-style';
    style.textContent = \`
        #lm-filter-panel {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        position: fixed;
        left: 20px;
        bottom: 20px;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border-radius: 12px;
        padding: 8px 16px;
        display: flex;
        flex-direction: column;
        transition: opacity 0.4s ease-in-out;
        z-index: 5;
        opacity: 1;
        pointer-events: auto;
    }
    .lm-landmarkTitle { font-size: 12px; color: #f0f0f0; margin-top: 6px; }
    .lm-filter-toggle { display: flex; justify-content: flex-start; align-items: center; gap: 5px; margin: 10px 0px; }
    .lm-filter-toggle span { color: #f0f0f0; font-weight: 500; font-size: 0.9rem; }
    .lm-switch { position: relative; display: inline-block; width: 40px; height: 22px; }
    .lm-switch input { opacity: 0; width: 0; height: 0; }
    .lm-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(80, 80, 80, 0.8); transition: .4s; border-radius: 22px; }
    .lm-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
    .lm-switch input:checked + .lm-slider { background-color: #dadadad5; border: 1px solid rgba(255, 255, 255, 0.1); }
    .lm-switch input:checked + .lm-slider:before { transform: translateX(18px); }
    .lm-filter-divider { border: none; height: 1px; background-color: #ccc; margin: 0; }
    #lm-category-filters { overflow: hidden; transition: max-height 0.35s ease, opacity 0.35s ease; }
    .lm-arrow { color: #f0f0f0; cursor: pointer; }
    \`;
    document.head.appendChild(style);
}

function buildLandmarkFilterPanel() {
    const categories = Object.keys(landmarkCategoryEntries).sort();
    if (categories.length === 0) return;

    injectLandmarkFilterCss();
    categories.forEach(function (cat) { setLandmarkCategoryVisible(cat, false); });

    const panel = document.createElement('div');
    panel.id = 'lm-filter-panel';

    let html = '<div class="lm-landmarkTitle">Landmark Filter</div>';
    html += \`
        <div class="lm-filter-toggle" id="lm-show-all-container">
            <label class="lm-switch">
                <input type="checkbox" id="lm-show-all-toggle">
                <span class="lm-slider"></span>
            </label>
            <span>Show All</span>
            <svg class="lm-arrow" id="lm-up-arrow" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="m6 9 6 6 6-6"/></svg>
            <svg class="lm-arrow" id="lm-down-arrow" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="m18 15-6-6-6 6"/></svg>
        </div>
        <hr class="lm-filter-divider" id="lm-filter-divider">
        <div id="lm-category-filters">
    \`;

    categories.forEach(function (cat) {
        const safeId = 'lm-cat-' + cat.replace(/[^a-zA-Z0-9]/g, '');
        html += \`
            <div class="lm-filter-toggle" id="\${safeId}-row">
                <label class="lm-switch">
                    <input type="checkbox" class="lm-cat-toggle" data-cat="\${cat}" id="\${safeId}">
                    <span class="lm-slider"></span>
                </label>
                <span>\${cat}</span>
            </div>
        \`;
    });

    html += '</div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);

    const catToggles = panel.querySelectorAll('.lm-cat-toggle');
    const showAllToggle = document.getElementById('lm-show-all-toggle');
    const categoryFilters = document.getElementById('lm-category-filters');
    const upArrow = document.getElementById('lm-up-arrow');
    const downArrow = document.getElementById('lm-down-arrow');
    const divider = document.getElementById('lm-filter-divider');

    catToggles.forEach(function (input) {
        input.addEventListener('change', function () {
            setLandmarkCategoryVisible(input.dataset.cat, input.checked);
            showAllToggle.checked = Array.from(catToggles).every(function (t) { return t.checked; });
        });
    });

    showAllToggle.addEventListener('change', function () {
        const checked = showAllToggle.checked;
        catToggles.forEach(function (input) {
            input.checked = checked;
            setLandmarkCategoryVisible(input.dataset.cat, checked);
        });
    });

    let expanded = true;
    function setExpanded(isOpen) {
        expanded = isOpen;
        if (isOpen) {
            categoryFilters.style.display = 'block';
            divider.style.display = 'block';
            categoryFilters.style.maxHeight = categoryFilters.scrollHeight + 'px';
            categoryFilters.style.opacity = '1';
            upArrow.style.display = 'block';
            downArrow.style.display = 'none';
        } else {
            categoryFilters.style.maxHeight = '0px';
            categoryFilters.style.opacity = '0';
            upArrow.style.display = 'none';
            downArrow.style.display = 'block';
            setTimeout(function () {
                if (!expanded) {
                    categoryFilters.style.display = 'none';
                    divider.style.display = 'none';
                }
            }, 350);
        }
    }
    upArrow.addEventListener('click', function () { setExpanded(false); });
    downArrow.addEventListener('click', function () { setExpanded(true); });
    setExpanded(true);
}

function initMap() {
    const mapDiv = document.getElementById('map');
    mapInstance = new google.maps.Map(mapDiv, {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        mapTypeId: 'hybrid'
    });

        const overallBounds = new google.maps.LatLngBounds();
    projects.forEach(function (project) {
        const b = drawProject(project);
        if (!b.isEmpty()) overallBounds.union(b);
    });
    const landmarkBounds = drawLandmarks();
    buildLandmarkFilterPanel();
    if (!landmarkBounds.isEmpty()) overallBounds.union(landmarkBounds);

    if (!overallBounds.isEmpty()) mapInstance.fitBounds(overallBounds);
}

(function loadGoogleMaps() {
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap';
    script.async = true;
    document.head.appendChild(script);
    window.initMap = initMap;
})();
`;
}

/**
 * Builds the standalone main.js source for the Preview screen's "Download
 * Map" button: same locations/polylines/pinMap/projects data shape as the
 * legacy export, with floorplan URLs pointed at local files under
 * images/floorplan/, plus a small render engine that boots a live Google
 * Map from that data.
 * @param {Object} data - result of getExportProject() / preview_project_data
 * @param {Object} opts - { apiKey }
 */
export function buildStandaloneMainJs(data, opts = {}) {
    const apiKey = opts.apiKey || '';
    const pins = data.pins || [];
    const roads = data.roads || [];
    const polygons = data.polygons || [];
    const floorPlans = data.floorPlans || [];

    const locationsSrc = buildLocationsSource(pins);
    const polylinesSrc = buildPolylinesSource(roads);
    const pinMapSrc = buildStandalonePinMapSource();

    const projectSources = floorPlans.length
        ? floorPlans.map((fp, i) => {
            const pin = findProjectPin(pins, fp.name);
            const pinUrl = (pin && (pin.imageDataUrl || pin.imageUrl)) ? `images/pin/pin-${fp.id}.png` : '';
            return buildProjectSource(
                fp, polygons, i, floorPlans.length,
                fp.floorplan ? `images/floorplan/floorplan-${fp.id}.png` : '',
                pin, pinUrl
            );
        })
        : [(() => {
            const pin = findProjectPin(pins, 'Project 1');
            const pinUrl = (pin && (pin.imageDataUrl || pin.imageUrl)) ? 'images/pin/pin-default.png' : '';
            return buildProjectSource({ id: null, name: 'Project 1', bounds: null, floorplan: '' }, polygons, 0, 1, '', pin, pinUrl);
        })()];

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
${standaloneRenderEngineSource(apiKey)}`;
}

/**
 * Builds the index.html that loads main.js for the standalone Download
 * Map package.
 */
export function buildStandaloneIndexHtml(title = 'Map Export') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>html, body, #map { height: 100%; margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="map"></div>
  <script src="main.js"></script>
</body>
</html>
`;
}