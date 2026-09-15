import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import MapWorkspace from "./components/MapWorkspace/MapWorkspace";
import PreviewMap from "./components/PreviewMap/PreviewMap";

export default function App() {
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      // Most modern browsers ignore this custom text and show a generic warning,
      // but setting e.returnValue is required to trigger the confirmation dialog.
      e.returnValue = "Have you exported your project?";
      return "Have you exported your project?";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MapWorkspace />} />
        <Route path="/workspace" element={<MapWorkspace />} />
        <Route path="/preview" element={<PreviewMap />} />
      </Routes>
    </BrowserRouter>
  );
}