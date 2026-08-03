import React, { useState } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import './Dialogs.css';

export default function SaveProjectDialog({ onClose }) {
  const { DUMMY_PORTFOLIOS, DUMMY_PROJECTS, getExportProject } = useWorkspace();
  
  // 'initial' | 'project' | 'portfolio' | 'portfolio-projects'
  const [step, setStep] = useState('initial');
  const [selectedPortfolio, setSelectedPortfolio] = useState(null);
  
  const handleSave = (targetName) => {
    // In a real app, we'd POST getExportProject() to the backend.
    const data = getExportProject();
    console.log("Saving project data to:", targetName, data);
    alert(`Successfully saved to ${targetName}!`);
    onClose();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-card">
        <div className="dialog-header">
          <h3>Save Project</h3>
          <button className="dialog-close" onClick={onClose}>×</button>
        </div>
        
        <div className="dialog-body">
          {step === 'initial' && (
            <div className="dialog-options">
              <button className="dialog-btn" onClick={() => setStep('project')}>
                Save to Project
              </button>
              <button className="dialog-btn" onClick={() => setStep('portfolio')}>
                Save to Portfolio
              </button>
            </div>
          )}
          
          {step === 'project' && (
            <div className="dialog-list">
              <h4>Select a Project</h4>
              {DUMMY_PROJECTS.map(p => (
                <button key={p.id} className="dialog-list-item" onClick={() => handleSave(p.name)}>
                  {p.name}
                </button>
              ))}
              <button className="dialog-btn-secondary" onClick={() => setStep('initial')}>Back</button>
            </div>
          )}
          
          {step === 'portfolio' && (
            <div className="dialog-list">
              <h4>Select a Portfolio</h4>
              {DUMMY_PORTFOLIOS.map(p => (
                <button 
                  key={p.id} 
                  className="dialog-list-item" 
                  onClick={() => {
                    setSelectedPortfolio(p);
                    setStep('portfolio-projects');
                  }}
                >
                  {p.name}
                </button>
              ))}
              <button className="dialog-btn-secondary" onClick={() => setStep('initial')}>Back</button>
            </div>
          )}
          
          {step === 'portfolio-projects' && selectedPortfolio && (
            <div className="dialog-list">
              <h4>Select Project in {selectedPortfolio.name}</h4>
              {selectedPortfolio.projects.map(p => (
                <button key={p.id} className="dialog-list-item" onClick={() => handleSave(`${selectedPortfolio.name} / ${p.name}`)}>
                  {p.name}
                </button>
              ))}
              <button className="dialog-btn-secondary" onClick={() => setStep('portfolio')}>Back</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
