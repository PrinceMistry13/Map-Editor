import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import './FloorPlanBottomPanel.css';
import '../Dialogs/Dialogs.css'; // For the confirmation dialog styles

export default function FloorPlanBottomPanel() {
  const { floorPlanMode, setFloorPlanMode, selectedFloorPlanId, setSelectedFloorPlanId, floorPlanManagerRef } = useWorkspace();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  const fpEntry = selectedFloorPlanId ? floorPlanManagerRef.current?.overlays.get(selectedFloorPlanId) : null;
  
  const [opacity, setOpacity] = React.useState(fpEntry?.overlay.opacity ?? 1);
  const [isLocked, setIsLocked] = React.useState(fpEntry?.overlay.isLocked ?? false);
  const [isAspectLocked, setIsAspectLocked] = React.useState(fpEntry?.overlay.isAspectLocked ?? true);

  React.useEffect(() => {
    if (fpEntry) {
      setOpacity(fpEntry.overlay.opacity);
      setIsLocked(fpEntry.overlay.isLocked);
      setIsAspectLocked(fpEntry.overlay.isAspectLocked);
    }
  }, [selectedFloorPlanId, fpEntry]);

  if (!selectedFloorPlanId) return null;

  const handleOpacityChange = (e) => {
    const val = parseFloat(e.target.value);
    setOpacity(val);
    floorPlanManagerRef.current?.updateOpacity(selectedFloorPlanId, val);
  };

  const handleReset = () => {
    floorPlanManagerRef.current?.reset(selectedFloorPlanId);
    if (fpEntry) {
      setOpacity(fpEntry.overlay.opacity);
      setIsLocked(fpEntry.overlay.isLocked);
      setIsAspectLocked(fpEntry.overlay.isAspectLocked);
    }
  };

  const handleToggleLock = () => {
    setIsLocked(!isLocked);
    floorPlanManagerRef.current?.toggleLock(selectedFloorPlanId);
  };

  const handleToggleAspectLock = () => {
    setIsAspectLocked(!isAspectLocked);
    floorPlanManagerRef.current?.toggleAspectLock(selectedFloorPlanId);
  };

  const handleSave = () => {
    floorPlanManagerRef.current?.downloadSave(selectedFloorPlanId);
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    if (floorPlanManagerRef.current) {
      floorPlanManagerRef.current.delete(selectedFloorPlanId);
    }
    setSelectedFloorPlanId(null);
    setShowDeleteConfirm(false);
  };

  return (
    <>
      <div className="fp-bottom-panel">
      <div className="fp-bp-mode-switch">
        <button
          className={`fp-bp-btn ${floorPlanMode === 'manual' ? 'active' : ''}`}
          onClick={() => setFloorPlanMode('manual')}
        >
          Manual
        </button>
        <button
          className={`fp-bp-btn ${floorPlanMode === 'gcp' ? 'active' : ''}`}
          onClick={() => setFloorPlanMode('gcp')}
        >
          GCP Mode
        </button>
        <button
          className={`fp-bp-btn ${floorPlanMode === 'distort' ? 'active' : ''}`}
          onClick={() => setFloorPlanMode('distort')}
        >
          Distort
        </button>
      </div>

      <div className="fp-bp-divider" />

      {/* Container for all dynamic content to ensure constant width */}
      <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
        
        {/* Manual controls (always rendered to reserve width, but hidden when not in manual mode/distort) */}
        <div style={{
          display: 'flex', 
          alignItems: 'center', 
          gap: '16px',
          visibility: (floorPlanMode === 'manual' || floorPlanMode === 'distort') ? 'visible' : 'hidden',
          pointerEvents: (floorPlanMode === 'manual' || floorPlanMode === 'distort') ? 'auto' : 'none'
        }}>
          <div className="fp-bp-group">
            <span className="fp-bp-label">Opacity</span>
            <input type="range" min="0" max="1" step="0.01" value={opacity} onChange={handleOpacityChange} />
          </div>
          
          <div className="fp-bp-group">
            <label className="fp-bp-checkbox-label">
              <input type="checkbox" checked={isAspectLocked} onChange={handleToggleAspectLock} />
              Lock Aspect
            </label>
          </div>
          
          <div className="fp-bp-group fp-bp-actions">
            <button className="fp-bp-action-btn" onClick={handleReset}>Reset</button>
            <button className="fp-bp-action-btn" onClick={handleToggleLock}>{isLocked ? "Unlock" : "Lock"}</button>
            <button className="fp-bp-action-btn" onClick={handleSave}>Save</button>
          </div>
        </div>

        {/* Hint overlays */}
        {floorPlanMode === 'gcp' && (
          <div className="fp-bp-gcp-hint" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)' }}>
            Use the left panel to place Ground Control Points.
          </div>
        )}
      </div>

      {/* Always visible actions */}
      <div className="fp-bp-group fp-bp-actions">
        <button className="fp-bp-action-btn fp-bp-action-btn--danger" onClick={handleDeleteClick}>Delete</button>
        <button className="fp-bp-action-btn fp-bp-action-btn--primary" onClick={() => setSelectedFloorPlanId(null)}>Done</button>
      </div>

      </div>

      {showDeleteConfirm && (
        <div className="dialog-overlay">
          <div className="dialog-card" style={{ width: '320px' }}>
            <div className="dialog-header">
              <h3>Delete Floor Plan</h3>
              <button className="dialog-close" onClick={() => setShowDeleteConfirm(false)}>×</button>
            </div>
            <div className="dialog-body">
              <p style={{ margin: 0, fontSize: '14px', color: '#ccc' }}>
                Delete this floor plan? This cannot be undone.
              </p>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
                <button className="dialog-btn-secondary" style={{ marginTop: 0 }} onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                <button className="dialog-btn" style={{ background: '#d32f2f', borderColor: '#b71c1c' }} onClick={handleDeleteConfirm}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
