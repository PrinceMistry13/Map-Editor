import { supabase } from '../supabaseClient';
import { fetchAndHashImage, uploadAssetFromBlob, expectedFloorplanFileName } from './assets';

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
            // Store the raw source image, not a distortion/rotation-baked copy.
            // The live editor (and any other consumer) always renders a
            // floorplan as raw pixels + distorted_corners/rotation_deg
            // metadata applied on top — baking the warp into the stored
            // pixels here would make that metadata get applied a second
            // time on reload, double-warping the image.
            const { blob, hash } = await fetchAndHashImage(src);
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

async function replaceTableRows(table, projectId, rows) {
    const { error: delError } = await supabase.from(table).delete().eq('project_id', projectId);
    if (delError) throw new Error(`${table} delete failed: ` + delError.message);
    if (rows.length) {
        const { error: insError } = await supabase.from(table).insert(rows.map((r) => ({ ...r, project_id: projectId })));
        if (insError) throw new Error(`${table} insert failed: ` + insError.message);
    }
}

export async function saveProjectData(projectId, name, mapped) {
    const { layers, polygons, roads, pins, floorPlans, radii } = mapped;

    const { error: metaError } = await supabase.from('projects').update({ name, layers }).eq('id', projectId);
    if (metaError) throw new Error('project metadata update failed: ' + metaError.message);

    const existingPinAssets = await getExistingAssetMap(projectId, 'pins');
    const existingFloorplanAssets = await getExistingAssetMap(projectId, 'floorplans');

    const resolvedPins = await resolveImageAssets(projectId, pins, 'imageDataUrl', 'pin_icon', existingPinAssets, name);
    const resolvedFloorPlans = await resolveImageAssets(projectId, floorPlans, 'url', 'floorplan_image', existingFloorplanAssets, name);

    // Each table's delete+insert is paired so a failure on one table only
    // empties that table, rather than wiping every table up front (as a
    // single delete-all-then-insert-all pass would) before any failure.
    await replaceTableRows('polygons', projectId, [...polygons, ...roads]);
    await replaceTableRows('pins', projectId, resolvedPins);
    await replaceTableRows('floorplans', projectId, resolvedFloorPlans);
    await replaceTableRows('radii', projectId, radii);
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