import { supabase } from '../supabaseClient';
import { compressImage } from '../../utils/imageCompress';

async function resolveToBlob(imageSrc) {
    const res = await fetch(imageSrc);
    return await res.blob();
}

async function hashBlob(blob) {
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

export async function uploadAssetFromBlob(projectId, blob, type, hash, projectName) {
    const compressed = await compressImage(blob);
    const folder = sanitizeFolderName(projectName);
    const filePath = `${folder}/${type}/${Date.now()}.webp`;

    const { error: uploadError } = await supabase.storage
        .from('project-files')
        .upload(filePath, compressed, { contentType: 'image/webp' });
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