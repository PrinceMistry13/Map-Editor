// Translates in-app manager field names <-> DB column names.
// This is IO shape mapping only — createPolygon/createPin/addFloorPlan and
// their loadPolygon/loadPin/loadFloorPlan counterparts are never modified.

export function mapStateForSave(state) {
    const { layers, polygons, roads, pins, floorPlans, radii } = state;

    const polygonRows = (polygons || []).map((p) => ({
        feature_id: p.id,
        name: p.name,
        category: p.category,
        layer_id: p.layerId,
        color: p.color,
        fill_opacity: p.fillOpacity,
        stroke_weight: p.strokeWeight,
        points: p.path,
        metadata: { ...(p.metadata || {}), visible: p.visible }
    }));

    const roadRows = (roads || []).map((r) => ({
        feature_id: r.id,
        name: r.name,
        category: r.category,
        layer_id: r.layerId,
        color: r.lineColor,
        road_width: r.lineWidth,
        points: r.points,
        metadata: { ...(r.metadata || {}), visible: r.visible }
    }));

    const pinRows = (pins || []).map((p) => ({
        feature_id: p.id,
        name: p.name,
        color: p.color,
        position: p.position,
        style_mode: p.styleMode,
        imageDataUrl: p.imageDataUrl, // consumed + stripped by resolveImageAssets before insert
        layer_id: p.layerId,
        category: p.category,
        landmark_type: p.landmarkType,
        custom_size: p.customSize,
        metadata: { ...(p.metadata || {}), visible: p.visible }
    }));

    const floorPlanRows = (floorPlans || []).map((f) => ({
        feature_id: f.id,
        name: f.name,
        layer_id: f.layerId,
        url: f.floorplan, // consumed + stripped by resolveImageAssets before insert
        bounds: f.bounds,
        corners: f.corners,
        distorted_corners: f.distortedCorners,
        scale: f.scale,
        rotation_deg: f.rotation,
        opacity: f.opacity,
        mode: f.mode,
        is_locked: f.isLocked,
        timestamp: f.timestamp,
        center: f.center,
        width_meters: f.widthMeters,
        height_meters: f.heightMeters
    }));

    const radiusRows = (radii || []).map((r) => ({
        feature_id: r.id,
        center: r.center,
        rings: r.rings,
        ring_color: r.ringColor
    }));

    return {
        layers,
        polygons: polygonRows,
        roads: roadRows,
        pins: pinRows,
        floorPlans: floorPlanRows,
        radii: radiusRows
    };
}

export function mapProjectForLoad(dbProject) {
    const allPolys = dbProject.polygons || [];

    const polygons = allPolys
        .filter((p) => p.category !== 'road' && p.category !== 'bridge')
        .map((p) => ({
            id: p.feature_id,
            name: p.name,
            category: p.category,
            layerId: p.layer_id,
            color: p.color,
            fillOpacity: p.fill_opacity,
            strokeWeight: p.stroke_weight,
            points: p.points,
            metadata: p.metadata || {},
            visible: p.metadata?.visible !== false
        }));

    const roads = allPolys
        .filter((p) => p.category === 'road' || p.category === 'bridge')
        .map((p) => ({
            id: p.feature_id,
            name: p.name,
            category: p.category,
            layerId: p.layer_id,
            lineColor: p.color,
            lineWidth: p.road_width,
            points: p.points,
            metadata: p.metadata || {},
            visible: p.metadata?.visible !== false
        }));

    const pins = (dbProject.pins || []).map((p) => ({
        id: p.feature_id,
        name: p.name,
        color: p.color,
        position: p.position,
        styleMode: p.style_mode,
        imageDataUrl: p.project_assets?.file_url || null,
        layerId: p.layer_id,
        category: p.category,
        landmarkType: p.landmark_type,
        customSize: p.custom_size,
        metadata: p.metadata || {},
        visible: p.metadata?.visible !== false
    }));

    const floorPlans = (dbProject.floorplans || []).map((f) => ({
        id: f.feature_id,
        name: f.name,
        layerId: f.layer_id,
        floorplan: f.project_assets?.file_url || null,
        bounds: f.bounds,
        corners: f.corners,
        distortedCorners: f.distorted_corners,
        scale: f.scale,
        rotation: f.rotation_deg,
        opacity: f.opacity,
        mode: f.mode,
        isLocked: f.is_locked,
        timestamp: f.timestamp,
        center: f.center,
        widthMeters: f.width_meters,
        heightMeters: f.height_meters
    }));

    const radii = (dbProject.radii || []).map((r) => ({
        id: r.feature_id,
        center: r.center,
        rings: r.rings,
        ringColor: r.ring_color
    }));

    return {
        layers: dbProject.layers || [],
        polygons,
        roads,
        pins,
        floorPlans,
        radii
    };
}