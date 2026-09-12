// Builds an export filename from a floorplan's Layer Panel name, e.g.
// "Royal Ethics" -> "Royal Ethics-floorplan". Strips only characters that
// are illegal in filenames; keeps spaces and case as-is.
export function floorplanFileSlug(fp) {
    const base = (fp.name || 'Floor Plan')
        .trim()
        .replace(/[\\/:*?"<>|]/g, '');
    return `${base}-floorplan`;
}