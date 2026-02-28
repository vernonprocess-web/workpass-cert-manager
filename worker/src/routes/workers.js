/**
 * Workers Route Handler
 * CRUD operations with FIN-based upsert (duplicate prevention).
 *
 * POST /api/workers/create          — Create or update worker by FIN
 * POST /api/workers/upload-document — Upload a document for a worker
 * GET  /api/workers/list            — List workers with search/pagination
 * GET  /api/workers/:id             — Get single worker with certs & docs
 */

import { jsonResponse, errorResponse, createdResponse } from '../utils/response.js';
import { syncWorkerToSheet } from '../google-sync.js';

export async function handleWorkers(request, env, path) {
    const method = request.method;

    // POST /api/workers/create
    if (path === '/api/workers/create' && method === 'POST') {
        return upsertWorker(request, env);
    }

    // POST /api/workers/upload-document
    if (path === '/api/workers/upload-document' && method === 'POST') {
        return uploadWorkerDocument(request, env);
    }

    // POST /api/workers/export
    if (path === '/api/workers/export' && method === 'POST') {
        return exportWorkers(request, env);
    }

    // GET /api/workers/list
    if (path === '/api/workers/list' && method === 'GET') {
        return listWorkers(request, env);
    }

    // GET /api/workers/:id
    const idMatch = path.match(/^\/api\/workers\/(\d+)$/);
    if (idMatch && method === 'GET') {
        return getWorker(env, parseInt(idMatch[1], 10));
    }

    // DELETE /api/workers/:id
    if (idMatch && method === 'DELETE') {
        return deleteWorker(env, parseInt(idMatch[1], 10));
    }

    return errorResponse('Not Found', 404);
}

/**
 * Create or update worker by FIN number (upsert).
 * If FIN exists → update existing record.
 * If FIN does not exist → create new record.
 */
async function upsertWorker(request, env) {
    const body = await request.json();
    const { fin_number, worker_name, work_permit_no, date_of_birth, nationality, sex, race, address, country_of_birth, employer_name, wp_expiry_date } = body;

    if (!fin_number || !worker_name) {
        return errorResponse('fin_number and worker_name are required', 400);
    }

    const cleanFin = fin_number.toUpperCase().trim();
    const cleanName = worker_name.toUpperCase().trim();

    // Check if worker with this FIN already exists
    const existing = await env.DB.prepare(
        'SELECT id FROM workers WHERE fin_number = ?'
    ).bind(cleanFin).first();

    let workerId;
    let isNew = false;

    if (existing) {
        // Update existing worker
        await env.DB.prepare(`
            UPDATE workers SET
                worker_name = ?,
                work_permit_no = COALESCE(?, work_permit_no),
                date_of_birth = COALESCE(?, date_of_birth),
                nationality = COALESCE(?, nationality),
                sex = COALESCE(?, sex),
                race = COALESCE(?, race),
                address = COALESCE(?, address),
                country_of_birth = COALESCE(?, country_of_birth),
                employer_name = COALESCE(?, employer_name),
                wp_expiry_date = COALESCE(?, wp_expiry_date),
                updated_at = datetime('now')
            WHERE fin_number = ?
        `).bind(
            cleanName,
            work_permit_no ? work_permit_no.toUpperCase().trim() : null,
            date_of_birth || null,
            nationality ? nationality.toUpperCase().trim() : null,
            sex ? sex.toUpperCase().trim() : null,
            race ? race.toUpperCase().trim() : null,
            address ? address.toUpperCase().trim() : null,
            country_of_birth ? country_of_birth.toUpperCase().trim() : null,
            employer_name ? employer_name.toUpperCase().trim() : null,
            wp_expiry_date || null,
            cleanFin
        ).run();

        workerId = existing.id;
    } else {
        // Create new worker
        const result = await env.DB.prepare(`
            INSERT INTO workers (fin_number, worker_name, work_permit_no, date_of_birth, nationality, sex, race, address, country_of_birth, employer_name, wp_expiry_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            cleanFin,
            cleanName,
            work_permit_no ? work_permit_no.toUpperCase().trim() : null,
            date_of_birth || null,
            nationality ? nationality.toUpperCase().trim() : null,
            sex ? sex.toUpperCase().trim() : null,
            race ? race.toUpperCase().trim() : null,
            address ? address.toUpperCase().trim() : null,
            country_of_birth ? country_of_birth.toUpperCase().trim() : null,
            employer_name ? employer_name.toUpperCase().trim() : null,
            wp_expiry_date || null
        ).run();

        workerId = result.meta.last_row_id;
        isNew = true;
    }

    // Fetch the full worker record
    const worker = await env.DB.prepare(
        'SELECT * FROM workers WHERE id = ?'
    ).bind(workerId).first();

    // Sync to Google Sheets (fire-and-forget)
    try {
        await syncWorkerToSheet(env, worker);
    } catch (err) {
        console.error('Google Sheets sync failed:', err.message);
    }

    return isNew ? createdResponse(worker) : jsonResponse(worker);
}

/**
 * Upload a document for a worker.
 * Accepts multipart/form-data with: file, fin_number, document_type
 */
async function uploadWorkerDocument(request, env) {
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return errorResponse('Content-Type must be multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const finNumber = formData.get('fin_number');
    const documentType = formData.get('document_type') || 'other';

    if (!file || !(file instanceof File)) {
        return errorResponse('No file provided', 400);
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
        return errorResponse('File type not allowed. Use JPEG, PNG, WebP, GIF, PDF, or Word documents.', 400);
    }

    // Find or determine worker
    let workerId = null;
    if (finNumber) {
        const worker = await env.DB.prepare(
            'SELECT id FROM workers WHERE fin_number = ?'
        ).bind(finNumber.toUpperCase().trim()).first();
        if (worker) workerId = worker.id;
    }

    // Generate R2 key
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const r2Key = `${documentType}/${timestamp}_${sanitizedName}`;

    // Upload to R2
    const arrayBuffer = await file.arrayBuffer();
    await env.BUCKET.put(r2Key, arrayBuffer, {
        httpMetadata: { contentType: file.type },
        customMetadata: {
            originalName: file.name,
            documentType,
            finNumber: finNumber || '',
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
 * List workers with search & pagination.
 */
async function listWorkers(request, env) {
    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM workers WHERE 1=1';
    const params = [];

    if (search) {
        query += ' AND (worker_name LIKE ? OR fin_number LIKE ? OR work_permit_no LIKE ? OR employer_name LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term);
    }

    // Count
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const total = await env.DB.prepare(countQuery).bind(...params).first('count');

    // Fetch page
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const { results } = await env.DB.prepare(query).bind(...params).all();

    return jsonResponse({
        data: results,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
}

/**
 * Get a single worker with their certifications and documents.
 */
async function getWorker(env, id) {
    const worker = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
    if (!worker) return errorResponse('Worker not found', 404);

    const { results: certifications } = await env.DB.prepare(
        'SELECT * FROM certifications WHERE worker_id = ? ORDER BY created_at DESC'
    ).bind(id).all();

    const { results: documents } = await env.DB.prepare(
        'SELECT * FROM documents WHERE worker_id = ? ORDER BY created_at DESC'
    ).bind(id).all();

    // Add signed file URLs to documents
    const docsWithUrls = documents.map(d => ({
        ...d,
        file_url: `/api/files/${encodeURIComponent(d.r2_key)}`,
    }));

    return jsonResponse({ ...worker, certifications, documents: docsWithUrls });
}

/**
 * Delete a worker and their associated data.
 */
async function deleteWorker(env, id) {
    const existing = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
    if (!existing) return errorResponse('Worker not found', 404);

    // Delete associated documents from R2
    const { results: docs } = await env.DB.prepare(
        'SELECT r2_key FROM documents WHERE worker_id = ?'
    ).bind(id).all();

    for (const doc of docs) {
        try { await env.BUCKET.delete(doc.r2_key); } catch (e) { /* ignore */ }
    }

    // Delete worker photo from R2 if exists
    if (existing.photo_key) {
        try { await env.BUCKET.delete(existing.photo_key); } catch (e) { /* ignore */ }
    }

    // Cascade deletes in DB
    await env.DB.prepare('DELETE FROM documents WHERE worker_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM certifications WHERE worker_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM workers WHERE id = ?').bind(id).run();

    return jsonResponse({ success: true, message: 'Worker deleted successfully' });
}

/**
 * Fetch selected workers raw records to be exported to CSV by the frontend.
 */
async function exportWorkers(request, env) {
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return errorResponse('Invalid JSON payload', 400);
    }

    const { workerIds } = body;

    if (!workerIds || !Array.isArray(workerIds) || workerIds.length === 0) {
        return errorResponse('No workers selected for export', 400);
    }

    try {
        // D1 query IN clause with bind parameters isn't native, must construct "?" list
        const placeholders = workerIds.map(() => '?').join(',');
        const query = `SELECT * FROM workers WHERE id IN (${placeholders})`;
        const { results } = await env.DB.prepare(query).bind(...workerIds).all();

        if (!results || results.length === 0) {
            return errorResponse('Selected workers not found', 404);
        }

        // Instead of exporting to sheets, we just return the raw records so the frontend can download a CSV
        return jsonResponse({
            success: true,
            data: results,
            message: `Successfully generated export payload for ${results.length} worker(s)!`
        });
    } catch (err) {
        console.error('Batch export failed:', err);
        return errorResponse('Failed to export workers: ' + err.message, 500);
    }
}
