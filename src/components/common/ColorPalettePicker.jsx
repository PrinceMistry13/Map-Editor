import React from 'react';
import './ColorPalettePicker.css';

const PRESET_COLORS = [
  '#000000', '#4b5563', '#9ca3af', '#e5e7eb',
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef',
  '#ff6b6b', '#f43f5e', '#14b8a6', '#0ea5e9'
];

export default function ColorPalettePicker({ color, onChange }) {
  return (
    <div className="color-palette-picker">
      <div className="color-palette-grid">
        {PRESET_COLORS.map(c => (
          <button
            key={c}
            type="button"
            className={`color-palette-swatch ${c === color ? 'color-palette-swatch--active' : ''}`}
            style={{ backgroundColor: c }}
            onClick={(e) => {
              e.stopPropagation();
              onChange(c);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            title={c}
          />
        ))}
      </div>
      <div className="color-palette-native">
        <label>Custom</label>
        <input
          type="color"
          value={color}
          onChange={(e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  );
}
