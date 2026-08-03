# Floor Plan Georeferencing (Manual Mode)

## Setup
```
npm install
cp .env.example .env      # put your Google Maps API key in VITE_GOOGLE_MAPS_API_KEY
npm run dev
```
API key needs: Maps JavaScript API, Places API. Enable billing.

## Folder structure
```
src/
  components/
    HomePage.jsx                    "Manual Mode" entry button
    UploadPanel/
      ManualModePage.jsx             upload -> preview -> "Export to Maps"
      FloorPlanUploader.jsx          file input, reads PNG/JPG -> dataURL
      FloorPlanPreview.jsx           preview panel (not on map)
    MapEditor/
      MapEditorPage.jsx              fullscreen Google Map + search + toolbar
      FloorPlanOverlay.jsx           custom OverlayView + Moveable (drag/resize/rotate)
      OverlayToolbar.jsx             opacity slider, aspect-lock, Lock&Save, Load
  context/
    FloorPlanContext.jsx             shared state: image + overlay geometry
  utils/
    coordinateTransforms.js          meters<->pixels, rotated-corner math
    overlayIO.js                     build/save/parse the georef JSON
  App.jsx                            routes: / , /manual , /editor
  main.jsx
```

## Two georeferencing modes
- **Manual** — drag/resize/rotate the overlay directly on the map (original workflow).
- **Ground Control Points (GCP)** — QGIS-Georeferencer-style: click a point on
  the floor plan panel, then click its matching real-world point on the map;
  repeat for 2+ pairs. "Compute Transform" fits a least-squares similarity
  transform (uniform scale + rotation + translation — same class of transform
  as QGIS's Helmert option) and reports an RMS fit error in meters, same idea
  as QGIS's GCP table. Math lives in `src/utils/gcpTransform.js`. The result
  feeds into the same `overlayState` the manual mode uses, so you can compute
  a rough fit via GCPs then fine-tune by hand.

## Flow
1. `/` -> Manual Mode -> `/manual`
2. Upload PNG/JPG -> shown in a plain `<img>` preview panel, not on any map
3. "Export to Maps" -> `/editor`, a fullscreen `GoogleMap` with default UI
   (Places search, map/satellite toggle, zoom, fullscreen, Street View, native
   gestures) via `@react-google-maps/api`
4. Floor plan renders as a custom `OverlayView` (not `GroundOverlay`, since
   that API can't rotate). A `react-moveable` handle set drives drag/resize/
   rotate directly on the DOM node in edit mode; "aspect ratio" checkbox maps
   to Moveable's `keepRatio`.
5. Each Moveable commit converts the on-screen box back to real-world
   center (lat/lng) + width/height (meters) + rotation via the map's own
   `OverlayView` projection (`fromDivPixelToLatLng` / `fromLatLngToDivPixel`),
   so panning/zooming afterward keeps the overlay locked to the ground.
6. "Lock & Save" freezes editing and downloads a JSON file with:
   `center, widthMeters, heightMeters, rotationDeg, opacity, sw, ne, corners`.
   `corners` (exact rotated quad) is what downstream code should use to map
   CAD-unit polygons to GPS; `sw`/`ne` is a convenience bounding box.
7. "Load saved overlay" on the editor re-reads that JSON and reproduces the
   overlay exactly, since geometry is stored in real-world units (meters +
   lat/lng), not screen pixels.

## Why these libraries
- `@react-google-maps/api` — thin, well-maintained React wrapper over the
  official Maps JS SDK; using it (rather than hand-rolling `<script>` loading)
  gets you the full native Maps UI (search box, controls, Street View) for
  free, and still hands you the raw `google.maps.Map` instance for the
  custom overlay.
- `react-moveable` — the standard choice for combined drag+resize+rotate
  with aspect-ratio locking in React; used by most browser-based design/GIS
  editors for this exact interaction set.
- Custom `OverlayView` instead of `GroundOverlay` — only way to get rotation;
  `GroundOverlay` is bounds-only and cannot rotate.
