/**
 * Documents Route Handler
 * File upload to R2 and retrieval via Worker (no public access).
 *
 * POST /api/documents/upload   — Upload a document to R2
 * GET  /api/files/:key          — Retrieve file from R2 (signed access)
 * DELETE /api/files/:key        — Delete file from R2
 */

import { jsonResponse, errorResponse, createdResponse } from '../utils/response.js';

export async function handleDocuments(request, env, path) {
    const method = request.method;

    // POST /api/documents/upload
    if (path === '/api/documents/upload' && method === 'POST') {
        return uploadDocument(request, env);
    }

    // GET/DELETE /api/files/:key
    if (path.startsWith('/api/files/')) {
        const key = decodeURIComponent(path.replace('/api/files/', ''));
        if (!key) return errorResponse('File key required', 400);

        if (method === 'GET') return getFile(env, key);
        if (method === 'DELETE') return deleteFile(env, key);
        return errorResponse('Method Not Allowed', 405);
    }

    return errorResponse('Not Found', 404);
}

/**
 * Upload a document to R2 and record in D1.
 */
async function uploadDocument(request, env) {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return errorResponse('Content-Type must be multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const documentType = formData.get('document_type') || 'other';
    const workerId = formData.get('worker_id') || null;

    if (!file || !(file instanceof File)) {
        return errorResponse('No file provided', 400);
    }

    // Validate file type
    const allowedTypes = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!allowedTypes.includes(file.type)) {
        return errorResponse('File type not allowed', 400);
    }

    // Generate R2 key
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `${documentType}/${timestamp}_${sanitizedName}`;

    // Upload to R2 (NOT public — access only via Worker)
    const arrayBuffer = await file.arrayBuffer();
    await env.BUCKET.put(r2Key, arrayBuffer, {
        httpMetadata: { contentType: file.type },
        customMetadata: {
            originalName: file.name,
            documentType,
            workerId: String(workerId || ''),
        },
    });

    // Record in database
    await env.DB.prepare(`
        INSERT INTO documents (worker_id, document_type, r2_key, original_name, mime_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind(workerId, documentType, r2Key, file.name, file.type, arrayBuffer.byteLength).run();

    return createdResponse({
        r2_key: r2Key,
        worker_id: workerId,
        document_type: documentType,
        original_name: file.name,
        file_size: arrayBuffer.byteLength,
        file_url: `/api/files/${encodeURIComponent(r2Key)}`,
    });
}

/**
 * Get file from R2 via Worker (signed access — not public).
 */
async function getFile(env, key) {
    const object = await env.BUCKET.get(key);
    if (!object) return errorResponse('File not found', 404);

    const headers = new Headers();
    headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'private, max-age=3600');

    if (object.customMetadata?.originalName) {
        headers.set('Content-Disposition', `inline; filename="${object.customMetadata.originalName}"`);
    }

    return new Response(object.body, { headers });
}

/**
 * Delete file from R2 and database.
 */
async function deleteFile(env, key) {
    const object = await env.BUCKET.head(key);
    if (!object) return errorResponse('File not found', 404);

    await env.BUCKET.delete(key);
    await env.DB.prepare('DELETE FROM documents WHERE r2_key = ?').bind(key).run();

    return jsonResponse({ success: true, message: 'File deleted' });
}
