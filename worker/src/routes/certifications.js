/**
 * Certifications Route Handler
 *
 * POST /api/certifications/create   — Create a certification
 * GET  /api/certifications/list     — List certifications
 * GET  /api/certifications/:id      — Get single certification
 * DELETE /api/certifications/:id    — Delete certification
 */

import { jsonResponse, errorResponse, createdResponse } from '../utils/response.js';
import { syncCertificationToSheet } from '../google-sync.js';

export async function handleCertifications(request, env, path) {
    const method = request.method;

    if (path === '/api/certifications/create' && method === 'POST') {
        return createCertification(request, env);
    }

    if (path === '/api/certifications/list' && method === 'GET') {
        return listCertifications(request, env);
    }

    const idMatch = path.match(/^\/api\/certifications\/(\d+)$/);
    if (idMatch && method === 'GET') {
        return getCertification(env, parseInt(idMatch[1], 10));
    }

    if (idMatch && method === 'DELETE') {
        return deleteCertification(env, parseInt(idMatch[1], 10));
    }

    return errorResponse('Not Found', 404);
}

/**
 * Create a new certification.
 * Links to worker by worker_id or fin_number.
 */
async function createCertification(request, env) {
    const body = await request.json();
    const { worker_id, fin_number, course_title, course_provider, cert_serial_no, course_duration, issue_date, expiry_date } = body;

    if (!course_title) {
        return errorResponse('course_title is required', 400);
    }

    // Resolve worker ID
    let resolvedWorkerId = worker_id;
    if (!resolvedWorkerId && fin_number) {
        const worker = await env.DB.prepare(
            'SELECT id FROM workers WHERE fin_number = ?'
        ).bind(fin_number.toUpperCase().trim()).first();
        if (worker) resolvedWorkerId = worker.id;
    }

    if (!resolvedWorkerId) {
        return errorResponse('Could not resolve worker. Provide worker_id or valid fin_number.', 400);
    }

    // Verify worker exists
    const workerExists = await env.DB.prepare(
        'SELECT id FROM workers WHERE id = ?'
    ).bind(resolvedWorkerId).first();
    if (!workerExists) {
        return errorResponse('Worker not found', 404);
    }

    const result = await env.DB.prepare(`
        INSERT INTO certifications (worker_id, course_title, course_provider, cert_serial_no, course_duration, issue_date, expiry_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
        resolvedWorkerId,
        course_title.trim(),
        course_provider ? course_provider.trim() : null,
        cert_serial_no ? cert_serial_no.trim() : null,
        course_duration ? course_duration.trim() : null,
        issue_date || null,
        expiry_date || null
    ).run();

    const cert = await env.DB.prepare(
        'SELECT * FROM certifications WHERE id = ?'
    ).bind(result.meta.last_row_id).first();

    // Sync to Google Sheets (fire-and-forget)
    try {
        const worker = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(resolvedWorkerId).first();
        await syncCertificationToSheet(env, worker, cert);
    } catch (err) {
        console.error('Google Sheets cert sync failed:', err.message);
    }

    return createdResponse(cert);
}

/**
 * List certifications with optional filters.
 */
async function listCertifications(request, env) {
    const url = new URL(request.url);
    const workerId = url.searchParams.get('worker_id');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    let query = `
        SELECT c.*, w.worker_name, w.fin_number
        FROM certifications c
        LEFT JOIN workers w ON c.worker_id = w.id
        WHERE 1=1
    `;
    const params = [];

    if (workerId) {
        query += ' AND c.worker_id = ?';
        params.push(workerId);
    }

    const countQuery = query.replace(/SELECT c\.\*, w\.worker_name, w\.fin_number/, 'SELECT COUNT(*) as count');
    const total = await env.DB.prepare(countQuery).bind(...params).first('count');

    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const { results } = await env.DB.prepare(query).bind(...params).all();

    return jsonResponse({
        data: results,
        pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
    });
}

/**
 * Get a single certification.
 */
async function getCertification(env, id) {
    const cert = await env.DB.prepare(`
        SELECT c.*, w.worker_name, w.fin_number
        FROM certifications c
        LEFT JOIN workers w ON c.worker_id = w.id
        WHERE c.id = ?
    `).bind(id).first();

    if (!cert) return errorResponse('Certification not found', 404);
    return jsonResponse(cert);
}

/**
 * Delete a certification.
 */
async function deleteCertification(env, id) {
    const existing = await env.DB.prepare('SELECT * FROM certifications WHERE id = ?').bind(id).first();
    if (!existing) return errorResponse('Certification not found', 404);

    // Delete associated file from R2
    if (existing.file_key) {
        try { await env.BUCKET.delete(existing.file_key); } catch (e) { /* ignore */ }
    }

    await env.DB.prepare('DELETE FROM certifications WHERE id = ?').bind(id).run();
    return jsonResponse({ success: true, message: 'Certification deleted' });
}
