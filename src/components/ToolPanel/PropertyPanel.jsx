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

  // Polygon, Pin, and Road tools — no side panel, interaction happens directly on the map
  if (['polygon', 'pin', 'road'].includes(baseTool)) return null;

  // Partial updater per tool type
  const set = (tool) => (partial) =>
    setToolProps((prev) => ({ ...prev, [tool]: { ...prev[tool], ...partial } }));

  return (
    <div className="pp-panel" id="pp-panel" aria-label="Tool properties">
      {baseTool === 'pin' && <PinPanel v={toolProps.pin} set={set('pin')} />}
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
