import { supabase } from '../supabaseClient';
import { compressImage } from '../../utils/imageCompress';

async function resolveToBlob(imageSrc) {
    const res = await fetch(imageSrc);
    return await res.blob();
}

export async function hashBlob(blob) {
    const buf = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Works for blob:, data:, and http(s) image sources alike.
export async function fetchAndHashImage(imageSrc) {
    const blob = await resolveToBlob(imageSrc);
    const hash = await hashBlob(blob);
    return { blob, hash };
}

function sanitizeFolderName(name) {
    return (name || 'project')
        .trim()
        .replace(/[^a-zA-Z0-9-_ ]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase() || 'project';
}

function sanitizeFileName(name) {
    return (name || '').trim().replace(/[\\/:*?"<>|]/g, '');
}

// floorplan images: named after the floorplan, with a short content-hash
// suffix so two floorplans with the same name never collide/overwrite.
export function expectedFloorplanFileName(assetName, hash) {
    return `${sanitizeFileName(assetName || 'Floor Plan')}-floorplan-${hash.slice(0, 8)}.webp`;
}

export async function uploadAssetFromBlob(projectId, blob, type, hash, projectName, assetName) {
    const compressed = await compressImage(blob);
    const folder = sanitizeFolderName(projectName);
    const fileName = type === 'floorplan_image' && assetName
        ? expectedFloorplanFileName(assetName, hash)
        : `${Date.now()}.webp`;
    const filePath = `${folder}/${type}/${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(filePath, compressed, { contentType: 'image/webp', upsert: true });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(filePath);

    const { data, error } = await supabase
        .from('project_assets')
        .insert({ project_id: projectId, type, file_path: filePath, file_url: urlData.publicUrl, image_hash: hash })
        .select()
        .single();
    if (error) throw error;
    return data;
}