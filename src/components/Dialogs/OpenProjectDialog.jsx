import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import './Dialogs.css';

export default function OpenProjectDialog({ onClose }) {
  const { DUMMY_PORTFOLIOS, DUMMY_PROJECTS } = useWorkspace();
  const [expandedPortfolio, setExpandedPortfolio] = useState(null);
  
  const handleOpen = (targetName) => {
    // In a real app, this would fetch the project data and load it into state.
    console.log("Loading project:", targetName);
    alert(`Successfully loaded ${targetName}!`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-card">
        <div className="dialog-header">
          <h3>Open Project</h3>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>
        
        <div className="dialog-body">
          <div className="dialog-list">
            <h4>Standalone Projects</h4>
            {DUMMY_PROJECTS.map(p => (
              <button key={p.id} className="dialog-list-item" onClick={() => handleOpen(p.name)}>
                {p.name}
              </button>
            ))}
            
            <h4 style={{ marginTop: '16px' }}>Portfolios</h4>
            {DUMMY_PORTFOLIOS.map(port => (
              <div key={port.id} className="dialog-portfolio-group">
                <button 
                  className="dialog-list-item dialog-portfolio-header"
                  onClick={() => setExpandedPortfolio(expandedPortfolio === port.id ? null : port.id)}
                >
                  {port.name} {expandedPortfolio === port.id ? '▼' : '▶'}
                </button>
                
                {expandedPortfolio === port.id && (
                  <div className="dialog-portfolio-projects">
                    {port.projects.map(p => (
                      <button 
                        key={p.id} 
                        className="dialog-list-item dialog-list-subitem" 
                        onClick={() => handleOpen(`${port.name} / ${p.name}`)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
