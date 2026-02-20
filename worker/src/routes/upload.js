/**
 * Upload Route Handler
 * Handles file upload to R2 and file retrieval/deletion.
 */

import { jsonResponse, errorResponse, createdResponse, noContentResponse } from '../utils/response.js';

export async function handleUpload(request, env, path) {
    const method = request.method;

    // /api/upload — POST
    if (path === '/api/upload' && method === 'POST') {
        return uploadFile(request, env);
    }

    // /api/files/:key — GET, DELETE
    if (path.startsWith('/api/files/')) {
        const key = decodeURIComponent(path.replace('/api/files/', ''));
        if (!key) return errorResponse('File key required', 400);

        if (method === 'GET') return getFile(env, key);
        if (method === 'DELETE') return deleteFile(env, key);
        return errorResponse('Method Not Allowed', 405);
    }

    return errorResponse('Not Found', 404);
}

async function uploadFile(request, env) {
    const contentType = request.headers.get('Content-Type') || '';

    if (!contentType.includes('multipart/form-data')) {
        return errorResponse('Content-Type must be multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const entityType = formData.get('entity_type') || null;   // 'worker' or 'certificate'
    const entityId = formData.get('entity_id') || null;

    if (!file || !(file instanceof File)) {
        return errorResponse('No file provided', 400);
    }

    // Generate unique key
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${entityType || 'misc'}/${timestamp}_${sanitizedName}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await env.BUCKET.put(key, arrayBuffer, {
        httpMetadata: {
            contentType: file.type,
        },
        customMetadata: {
            originalName: file.name,
            entityType: entityType || '',
            entityId: String(entityId || ''),
        },
    });

    // Log in database
    await env.DB.prepare(
        `INSERT INTO uploads (file_key, original_name, mime_type, file_size, entity_type, entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(key, file.name, file.type, arrayBuffer.byteLength, entityType, entityId).run();

    return createdResponse({
        key,
        original_name: file.name,
        mime_type: file.type,
        file_size: arrayBuffer.byteLength,
        url: `/api/files/${encodeURIComponent(key)}`,
    });
}

async function getFile(env, key) {
    const object = await env.BUCKET.get(key);

    if (!object) {
        return errorResponse('File not found', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Length', object.size);
    headers.set('Cache-Control', 'public, max-age=31536000');

    if (object.customMetadata?.originalName) {
        headers.set('Content-Disposition', `inline; filename="${object.customMetadata.originalName}"`);
    }

    return new Response(object.body, { headers });
}

async function deleteFile(env, key) {
    const object = await env.BUCKET.head(key);
    if (!object) {
        return errorResponse('File not found', 404);
    }

    await env.BUCKET.delete(key);
    await env.DB.prepare('DELETE FROM uploads WHERE file_key = ?').bind(key).run();

    return noContentResponse();
}
