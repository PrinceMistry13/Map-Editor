import { useWorkspace } from '../../context/WorkspaceContext';
import './PropertyPanel.css';

// Pin category grid removed — pins now carry only color + editable name,
// set per-pin via the map popup. This is just the default color for the
// NEXT pin you place.

// ─── PropertyPanel (root) ─────────────────────────────────────────────────────
export default function PropertyPanel({ toolProps, setToolProps }) {
  const { activeTool } = useWorkspace();

  // No panel for select mode, grid toggle, or polygon tool
  if (!activeTool || activeTool === 'grid') return null;

  const baseTool = activeTool.includes('-') ? activeTool.split('-').slice(1).join('-') : activeTool;

  // Polygon and Pin tools — no side panel, interaction happens directly on the map
  if (['polygon', 'pin'].includes(baseTool)) return null;

  // Partial updater per tool type
  const set = (tool) => (partial) =>
    setToolProps((prev) => ({ ...prev, [tool]: { ...prev[tool], ...partial } }));

  return (
    <div className="pp-panel" id="pp-panel" aria-label="Tool properties">
      {baseTool === 'pin' && <PinPanel v={toolProps.pin} set={set('pin')} />}
      {baseTool === 'road' && <RoadPanel v={toolProps.road} set={set('road')} />}
      {baseTool === 'radius' && <RadiusPanel v={toolProps.radius} set={set('radius')} />}
    </div>
  );
}

// ─── Pin ──────────────────────────────────────────────────────────────────────
function PinPanel({ v, set }) {
  return (
    <>
      <PpHeader>Pin</PpHeader>
      <PpRow label="Color">
        <input id="pp-pin-color" type="color" className="pp-color" value={v.color}
          onChange={(e) => set({ color: e.target.value })} />
      </PpRow>
      <p className="pp-hint">Click map to drop a pin. Click a placed pin to rename, recolor, or drag it.</p>
    </>
  );
}

// ─── Road ─────────────────────────────────────────────────────────────────────
function RoadPanel({ v, set }) {
  return (
    <>
      <PpHeader>Road</PpHeader>
      <PpRow label="Name">
        <input id="pp-road-name" type="text" className="pp-text" placeholder="Road name"
          value={v.roadName}
          onChange={(e) => set({ roadName: e.target.value })} />
      </PpRow>
      <PpRow label="Color">
        <input id="pp-road-color" type="color" className="pp-color" value={v.lineColor}
          onChange={(e) => set({ lineColor: e.target.value })} />
      </PpRow>
      <PpRow label="Line W">
        <input id="pp-road-lw" type="range" min="1" max="10" step="1" className="pp-slider"
          value={v.lineWidth}
          onChange={(e) => set({ lineWidth: Number(e.target.value) })} />
        <span className="pp-val">{v.lineWidth}px</span>
      </PpRow>
      <PpRow label="Road W">
        <input id="pp-road-rw" type="range" min="2" max="30" step="1" className="pp-slider"
          value={v.roadWidth}
          onChange={(e) => set({ roadWidth: Number(e.target.value) })} />
        <span className="pp-val">{v.roadWidth}m</span>
      </PpRow>
    </>
  );
}

// ─── Radius ───────────────────────────────────────────────────────────────────
function RadiusPanel({ v, set }) {
  const add = () => {
    const lastDist = v.rings[v.rings.length - 1]?.distance ?? 0;
    set({ rings: [...v.rings, { distance: lastDist + 100 }] });
  };
  const remove = (i) => set({ rings: v.rings.filter((_, idx) => idx !== i) });
  const update = (i, distance) => {
    const rings = v.rings.map((r, idx) =>
      idx === i ? { ...r, distance: Math.max(1, distance) } : r
    );
    set({ rings });
  };

  return (
    <>
      <PpHeader>Radius Rings</PpHeader>
      <div className="pp-sublabel">Click map: 1st = center, then each click = ring</div>
      {v.rings.map((r, i) => (
        <div key={i} className="pp-ring-row">
          <input
            id={`pp-ring-${i}`}
            type="number"
            min="1"
            className="pp-num"
            value={r.distance}
            onChange={(e) => update(i, parseInt(e.target.value) || 1)}
          />
          <span className="pp-ring-unit">m</span>
          <button className="pp-ring-del" onClick={() => remove(i)} aria-label="Remove ring">×</button>
        </div>
      ))}
      <button className="pp-add" id="pp-add-ring" onClick={add}>+ Add Ring</button>
    </>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
function PpHeader({ children }) {
  return <div className="pp-header">{children}</div>;
}

function PpRow({ label, children }) {
  return (
    <div className="pp-row">
      <span className="pp-row-label">{label}</span>
      <div className="pp-row-ctrl">{children}</div>
    </div>
  );
}
