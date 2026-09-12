import { supabase } from '../supabaseClient';
import { fetchAndHashImage, uploadAssetFromBlob, expectedFloorplanFileName, hashBlob } from './assets';
import { bakeFloorplanImage } from '../../utils/imageBake';

function loadImageElement(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    });
}

async function getExistingAssetMap(projectId, table) {
    const { data } = await supabase
        .from(table)
        .select('feature_id, image_asset_id, project_assets(id, image_hash, file_path)')
        .eq('project_id', projectId);
    const map = {};
    (data || []).forEach((row) => {
        if (row.image_asset_id) {
            map[row.feature_id] = {
                assetId: row.image_asset_id,
                hash: row.project_assets?.image_hash,
                filePath: row.project_assets?.file_path
            };
        }
    });
    return map;
}

async function resolveImageAssets(projectId, items, imageField, assetType, existingMap, projectName) {
    const resolved = [];
    for (const item of items) {
        const src = item[imageField];
        let assetId = null;
        if (src) {
            let blob, hash;
            if (assetType === 'floorplan_image') {
                // Bake distortion/rotation into pixels before storing — DB
                // asset must match what's shown in the editor, not the raw upload.
                // item is the DB-shaped row (snake_case); bakeFloorplanImage
                // expects the in-app camelCase shape — adapt here.
                const bakeInput = {
                    distortedCorners: item.distorted_corners,
                    rotation: item.rotation_deg,
                    opacity: item.opacity
                };
                const img = await loadImageElement(src);
                const baked = await bakeFloorplanImage(img, bakeInput);
                if (baked) {
                    blob = baked;
                    hash = await hashBlob(baked); // hash the baked output, so distortion-only edits still trigger re-upload
                } else {
                    ({ blob, hash } = await fetchAndHashImage(src)); // bake failed (e.g. tainted canvas) — fall back to raw
                }
            } else {
                ({ blob, hash } = await fetchAndHashImage(src));
            }
            const existing = existingMap[item.feature_id];
            const currentFileName = existing?.filePath?.split('/').pop();
            const needsRename = assetType === 'floorplan_image'
                && existing
                && currentFileName !== expectedFloorplanFileName(item.name, hash);
            if (existing && existing.hash === hash && !needsRename) {
                assetId = existing.assetId; // unchanged, correctly named — skip upload
            } else {
                const uploaded = await uploadAssetFromBlob(projectId, blob, assetType, hash, projectName, item.name);
                assetId = uploaded.id;
                if (existing?.filePath) {
                    await supabase.storage.from('project-files').remove([existing.filePath]);
                    await supabase.from('project_assets').delete().eq('id', existing.assetId);
                }
            }
        }
        const { [imageField]: _drop, ...rest } = item;
        resolved.push({ ...rest, image_asset_id: assetId });
    }
    return resolved;
}

export async function createProject(name, layers) {
    const { data, error } = await supabase.from('projects').insert({ name, layers }).select().single();
    if (error) throw error;
    return data.id;
}

export async function saveProjectData(projectId, name, mapped) {
    const { layers, polygons, roads, pins, floorPlans, radii } = mapped;

    await supabase.from('projects').update({ name, layers }).eq('id', projectId);

    const existingPinAssets = await getExistingAssetMap(projectId, 'pins');
    const existingFloorplanAssets = await getExistingAssetMap(projectId, 'floorplans');

    const resolvedPins = await resolveImageAssets(projectId, pins, 'imageDataUrl', 'pin_icon', existingPinAssets, name);
    const resolvedFloorPlans = await resolveImageAssets(projectId, floorPlans, 'url', 'floorplan_image', existingFloorplanAssets, name);

    await supabase.from('polygons').delete().eq('project_id', projectId);
    await supabase.from('pins').delete().eq('project_id', projectId);
    await supabase.from('floorplans').delete().eq('project_id', projectId);
    await supabase.from('radii').delete().eq('project_id', projectId);

    const allPolys = [...polygons, ...roads];
    if (allPolys.length) {
        const { error: e1 } = await supabase.from('polygons').insert(allPolys.map((p) => ({ ...p, project_id: projectId })));
        if (e1) throw new Error('polygons insert failed: ' + e1.message);
    }
    if (resolvedPins.length) {
        const { error: e2 } = await supabase.from('pins').insert(resolvedPins.map((p) => ({ ...p, project_id: projectId })));
        if (e2) throw new Error('pins insert failed: ' + e2.message);
    }
    if (resolvedFloorPlans.length) {
        const { error: e3 } = await supabase.from('floorplans').insert(resolvedFloorPlans.map((f) => ({ ...f, project_id: projectId })));
        if (e3) throw new Error('floorplans insert failed: ' + e3.message);
    }
    if (radii.length) {
        const { error: e4 } = await supabase.from('radii').insert(radii.map((r) => ({ ...r, project_id: projectId })));
        if (e4) throw new Error('radii insert failed: ' + e4.message);
    }
}

export async function listProjects() {
    const { data, error } = await supabase
        .from('projects')
        .select('id, name, updated_at')
        .order('updated_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function loadProject(projectId) {
    const { data: proj, error } = await supabase.from('projects').select('*').eq('id', projectId).single();
    if (error) throw error;

    const results = await Promise.all([
        supabase.from('polygons').select('*').eq('project_id', projectId),
        supabase.from('pins').select('*, project_assets(file_url)').eq('project_id', projectId),
        supabase.from('floorplans').select('*, project_assets(file_url)').eq('project_id', projectId),
        supabase.from('radii').select('*').eq('project_id', projectId)
    ]);

    const [polygonsRes, pinsRes, floorplansRes, radiiRes] = results;

    if (polygonsRes.error) console.error('loadProject: polygons query failed:', polygonsRes.error);
    if (pinsRes.error) console.error('loadProject: pins query failed:', pinsRes.error);
    if (floorplansRes.error) console.error('loadProject: floorplans query failed:', floorplansRes.error);
    if (radiiRes.error) console.error('loadProject: radii query failed:', radiiRes.error);

    return {
        ...proj,
        polygons: polygonsRes.data || [],
        pins: pinsRes.data || [],
        floorplans: floorplansRes.data || [],
        radii: radiiRes.data || []
    };
}