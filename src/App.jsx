import { BrowserRouter, Routes, Route } from "react-router-dom";
import MapWorkspace from "./components/MapWorkspace/MapWorkspace";
import PreviewMap from "./components/PreviewMap/PreviewMap";

export default function App() {
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