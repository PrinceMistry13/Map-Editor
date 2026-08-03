export function polygonArea(path) {
  if (!window.google?.maps?.geometry?.spherical || !path || path.length < 3) return 0;
  return window.google.maps.geometry.spherical.computeArea(path);
}

export function polygonPerimeter(path) {
  if (!window.google?.maps?.geometry?.spherical || !path || path.length < 2) return 0;
  return window.google.maps.geometry.spherical.computeLength(path);
}
