/**
 * Certificates Route Handler
 * CRUD operations for certificate records.
 */

import { jsonResponse, errorResponse, createdResponse, noContentResponse } from '../utils/response.js';

export async function handleCertificates(request, env, path) {
    const method = request.method;

    const segments = path.split('/').filter(Boolean);
    const id = segments.length >= 3 ? segments[2] : null;

    switch (method) {
        case 'GET':
            return id ? getCertificate(env, id) : listCertificates(request, env);
        case 'POST':
            return createCertificate(request, env);
        case 'PUT':
            return id ? updateCertificate(request, env, id) : errorResponse('Certificate ID required', 400);
        case 'DELETE':
            return id ? deleteCertificate(env, id) : errorResponse('Certificate ID required', 400);
        default:
            return errorResponse('Method Not Allowed', 405);
    }
}

async function listCertificates(request, env) {
    const url = new URL(request.url);
    const workerId = url.searchParams.get('worker_id');
    const certType = url.searchParams.get('type');
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    let query = `
    SELECT c.*, w.name as worker_name, w.fin as worker_fin
    FROM certificates c
    LEFT JOIN workers w ON c.worker_id = w.id
    WHERE 1=1
  `;
    const params = [];

    if (workerId) {
        query += ' AND c.worker_id = ?';
        params.push(workerId);
    }

    if (certType) {
        query += ' AND c.cert_type = ?';
        params.push(certType);
    }

    if (status) {
        query += ' AND c.cert_status = ?';
        params.push(status);
    }

    const countQuery = query.replace(/SELECT c\.\*, w\.name as worker_name, w\.fin as worker_fin/, 'SELECT COUNT(*) as count');
    const totalResult = await env.DB.prepare(countQuery).bind(...params).first('count');

    query += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await env.DB.prepare(query).bind(...params).all();

    return jsonResponse({
        data: results,
        pagination: {
            page,
            limit,
            total: totalResult,
            total_pages: Math.ceil(totalResult / limit),
        },
    });
}

async function getCertificate(env, id) {
    const cert = await env.DB.prepare(`
    SELECT c.*, w.name as worker_name, w.fin as worker_fin
    FROM certificates c
    LEFT JOIN workers w ON c.worker_id = w.id
    WHERE c.id = ?
  `).bind(id).first();

    if (!cert) {
        return errorResponse('Certificate not found', 404);
    }

    return jsonResponse(cert);
}

async function createCertificate(request, env) {
    const body = await request.json();
    const { worker_id, cert_type, cert_number, cert_name, issuing_body, issue_date, expiry_date, cert_status, remarks } = body;

    if (!worker_id || !cert_type || !cert_name) {
        return errorResponse('worker_id, cert_type, and cert_name are required', 400);
    }

    // Verify worker exists
    const worker = await env.DB.prepare('SELECT id FROM workers WHERE id = ?').bind(worker_id).first();
    if (!worker) {
        return errorResponse('Worker not found', 404);
    }

    const result = await env.DB.prepare(
        `INSERT INTO certificates (worker_id, cert_type, cert_number, cert_name, issuing_body, issue_date, expiry_date, cert_status, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
        worker_id,
        cert_type,
        cert_number || null,
        cert_name,
        issuing_body || null,
        issue_date || null,
        expiry_date || null,
        cert_status || 'valid',
        remarks || null
    ).run();

    const newCert = await env.DB.prepare('SELECT * FROM certificates WHERE id = ?')
        .bind(result.meta.last_row_id).first();

    return createdResponse(newCert);
}

async function updateCertificate(request, env, id) {
    const existing = await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(id).first();
    if (!existing) {
        return errorResponse('Certificate not found', 404);
    }

    const body = await request.json();
    const fields = ['worker_id', 'cert_type', 'cert_number', 'cert_name', 'issuing_body', 'issue_date', 'expiry_date', 'cert_status', 'file_key', 'remarks'];

    const updates = [];
    const values = [];

    for (const field of fields) {
        if (body[field] !== undefined) {
            updates.push(`${field} = ?`);
            values.push(body[field]);
        }
    }

    if (updates.length === 0) {
        return errorResponse('No fields to update', 400);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await env.DB.prepare(
        `UPDATE certificates SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const updated = await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(id).first();
    return jsonResponse(updated);
}

async function deleteCertificate(env, id) {
    const existing = await env.DB.prepare('SELECT * FROM certificates WHERE id = ?').bind(id).first();
    if (!existing) {
        return errorResponse('Certificate not found', 404);
    }

    await env.DB.prepare('DELETE FROM certificates WHERE id = ?').bind(id).run();
    return noContentResponse();
}
