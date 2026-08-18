import React, { useRef, useEffect, useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { computeGCPTransform } from '../../lib/HelmertTransform';
import './GCPSplitPanel.css';

export default function GCPSplitPanel() {
  const {
    floorPlanManagerRef,
    selectedFloorPlanId,
    gcpPoints,
    setGCPPoints,
    pendingImgPt,
    setPendingImgPt,
    setFloorPlanMode
  } = useWorkspace();

  const imgRef = useRef(null);
  
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const hasMoved = useRef(false);

  const fpEntry = floorPlanManagerRef.current?.overlays.get(selectedFloorPlanId);
  const imageUrl = fpEntry?.url;

  const handlePointerDown = (e) => {
    setIsDragging(true);
    hasMoved.current = false;
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    
    // Safety check: if mouse button is released outside and we re-enter, stop dragging
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      handlePointerUp(e);
      return;
    }
    
    if (Math.abs(e.clientX - (dragStart.current.x + pan.x)) > 3 || 
        Math.abs(e.clientY - (dragStart.current.y + pan.y)) > 3) {
      hasMoved.current = true;
    }
    
    setPan({ 
      x: e.clientX - dragStart.current.x, 
      y: e.clientY - dragStart.current.y 
    });
  };

  const handlePointerUp = (e) => {
    setIsDragging(false);
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch (err) {}
    
    if (!hasMoved.current && e.type === 'pointerup') {
      handleImageClick(e);
    }
  };

  const handleWheel = (e) => {
    const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newZoom = Math.min(Math.max(0.1, zoom * zoomFactor), 15);
    
    if (newZoom === zoom) return;

    // Get cursor position relative to the center of the image container
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const mouseX = e.clientX - centerX;
    const mouseY = e.clientY - centerY;

    // Calculate new pan to keep the point under the cursor stationary
    const scaleRatio = newZoom / zoom;
    const newPanX = mouseX - (mouseX - pan.x) * scaleRatio;
    const newPanY = mouseY - (mouseY - pan.y) * scaleRatio;

    setZoom(newZoom);
    setPan({ x: newPanX, y: newPanY });
  };

  const handleImageClick = (e) => {
    const imgElement = imgRef.current;
    if (!imgElement || e.target !== imgElement) return;
    
    // Calculate click position relative to the natural image dimensions
    // using offsetX/Y which are strictly relative to the image's content box,
    // avoiding any stale bounding rect or layout shifting bugs.
    const scaleX = imgElement.naturalWidth / imgElement.clientWidth;
    const scaleY = imgElement.naturalHeight / imgElement.clientHeight;
    
    const x = e.nativeEvent.offsetX * scaleX;
    const y = e.nativeEvent.offsetY * scaleY;
    
    setPendingImgPt({ x, y });
  };

  const removePoint = (id) => {
    setGCPPoints(gcpPoints.filter(p => p.id !== id));
  };

  const handleCompute = () => {
    if (gcpPoints.length < 2) return;
    if (!fpEntry) return;

    try {
      const sourcePts = gcpPoints.map(p => p.img);
      const destPts = gcpPoints.map(p => p.map);
      
      const result = computeGCPTransform(sourcePts, destPts, fpEntry.originalWidth, fpEntry.originalHeight);
      
      // Apply the result to the overlay
      floorPlanManagerRef.current.applyGCPTransform(selectedFloorPlanId, result);
      
      // Update errors in the table to show the user
      const updatedPoints = gcpPoints.map((p, i) => ({
        ...p,
        error: result.perPointErrors[i]
      }));
      setGCPPoints(updatedPoints);
      
      // Auto-switch back to manual mode on success
      setFloorPlanMode('manual');

    } catch (err) {
      console.error(err);
      alert('Error computing transform: ' + err.message);
    }
  };

  if (!imageUrl) {
    return (
      <div className="gcp-panel">
        <div className="gcp-empty">Select a Floor Plan to use GCP mode</div>
      </div>
    );
  }

  return (
    <div className="gcp-panel">
      <div className="gcp-header">
        <h3>Ground Control Points</h3>
        <button className="gcp-close" onClick={() => setFloorPlanMode('manual')}>×</button>
      </div>
      
      <div className="gcp-instructions">
        {pendingImgPt 
          ? <span className="gcp-hint highlight">Click on the map to match the point</span>
          : <span className="gcp-hint">Click on the image to add a control point</span>
        }
      </div>

      <div 
        className="gcp-image-container"
        style={{ overflow: 'hidden', position: 'relative' }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div className="gcp-zoom-controls" style={{ position: 'absolute', top: 10, right: 10, zIndex: 100, display: 'flex', gap: '4px' }}>
          <button type="button" onClick={() => setZoom(z => Math.min(z * 1.2, 15))} style={{ padding: '2px 8px', cursor: 'pointer' }}>+</button>
          <button type="button" onClick={() => setZoom(z => Math.max(z / 1.2, 0.1))} style={{ padding: '2px 8px', cursor: 'pointer' }}>-</button>
          <button type="button" onClick={() => { setZoom(1); setPan({x: 0, y: 0}); }} style={{ padding: '2px 8px', cursor: 'pointer' }}>Reset</button>
        </div>

        <div style={{ 
          position: 'relative', 
          aspectRatio: `${fpEntry.originalWidth} / ${fpEntry.originalHeight}`, 
          maxWidth: '100%', 
          maxHeight: '100%',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          cursor: isDragging ? 'grabbing' : 'crosshair'
        }}>
          <img 
            ref={imgRef}
            src={imageUrl} 
            alt="Floor Plan" 
            className={pendingImgPt ? 'gcp-img waiting' : 'gcp-img'}
            style={{ width: '100%', height: '100%', display: 'block' }}
            draggable={false}
          />
          {/* Render markers for points on image */}
          {gcpPoints.map((pt, i) => (
            <div 
              key={pt.id} 
              className="gcp-marker"
              style={{
                left: `${(pt.img.x / fpEntry.originalWidth) * 100}%`,
                top: `${(pt.img.y / fpEntry.originalHeight) * 100}%`,
                transform: `scale(${1 / zoom})`
              }}
            >
              {i + 1}
            </div>
          ))}
          {/* Render pending point */}
          {pendingImgPt && (
            <div 
              className="gcp-marker pending"
              style={{
                left: `${(pendingImgPt.x / fpEntry.originalWidth) * 100}%`,
                top: `${(pendingImgPt.y / fpEntry.originalHeight) * 100}%`,
                transform: `scale(${1 / zoom})`
              }}
            >
              ?
            </div>
          )}
        </div>
      </div>

      <div className="gcp-table-container">
        <table className="gcp-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Image (X, Y)</th>
              <th>Map (Lat, Lng)</th>
              <th>Error (m)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {gcpPoints.map((pt, i) => (
              <tr key={pt.id}>
                <td>{i + 1}</td>
                <td>{Math.round(pt.img.x)}, {Math.round(pt.img.y)}</td>
                <td>{pt.map.lat.toFixed(5)}, {pt.map.lng.toFixed(5)}</td>
                <td>{pt.error ? pt.error.toFixed(2) : '-'}</td>
                <td>
                  <button className="gcp-del-btn" onClick={() => removePoint(pt.id)}>×</button>
                </td>
              </tr>
            ))}
            {gcpPoints.length === 0 && (
              <tr>
                <td colSpan="5" className="gcp-empty-row">No points added</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      <div className="gcp-actions">
        <button 
          className="gcp-compute-btn" 
          disabled={gcpPoints.length < 2}
          onClick={handleCompute}
        >
          Compute Transform
        </button>
      </div>
    </div>
  );
}
