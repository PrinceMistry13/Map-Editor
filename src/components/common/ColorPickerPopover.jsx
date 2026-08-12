import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import ColorPalettePicker from './ColorPalettePicker';
import './ColorPickerPopover.css';

export default function ColorPickerPopover({ color, onChange, className, triggerElement, styleMode, onStyleModeChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const containerRef = useRef(null);

  useEffect(() => {
    const handleDocClick = (e) => {
      // Allow clicking inside the portal
      if (e.target.closest('.cpp-popover')) return;
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleScroll = () => setIsOpen(false);
    if (isOpen) {
      document.addEventListener('mousedown', handleDocClick);
      document.addEventListener('wheel', handleScroll, { passive: true });
    }
    return () => {
      document.removeEventListener('mousedown', handleDocClick);
      document.removeEventListener('wheel', handleScroll);
    };
  }, [isOpen]);

  const toggleOpen = () => {
    if (!isOpen && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 8, left: rect.left });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className={`cpp-container ${className || ''}`} ref={containerRef} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div onClick={toggleOpen}>
        {triggerElement ? (
          triggerElement
        ) : (
          <div 
            className="cpp-swatch" 
            style={{ backgroundColor: color }} 
            title="Change color"
          />
        )}
      </div>
      {isOpen && createPortal(
        <div 
          className="cpp-popover" 
          style={{ top: coords.top, left: coords.left, position: 'fixed' }}
          onClick={(e) => e.stopPropagation()} 
          onPointerDown={(e) => e.stopPropagation()} 
          onWheel={(e) => e.stopPropagation()}
        >
          {onStyleModeChange && (
            <div className="cpp-style-toggle">
              <button 
                className={`cpp-toggle-btn ${styleMode === 'individual' ? 'cpp-toggle-btn--active' : ''}`}
                onClick={() => onStyleModeChange('individual')}
              >
                Individual
              </button>
              <button 
                className={`cpp-toggle-btn ${styleMode === 'uniform' ? 'cpp-toggle-btn--active' : ''}`}
                onClick={() => onStyleModeChange('uniform')}
              >
                Uniform
              </button>
            </div>
          )}
          <ColorPalettePicker color={color} onChange={onChange} />
        </div>,
        document.body
      )}
    </div>
  );
}
