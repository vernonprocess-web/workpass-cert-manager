/**
 * Workers (Work Permits) Route Handler
 * CRUD operations for work permit records.
 */

import { jsonResponse, errorResponse, createdResponse, noContentResponse } from '../utils/response.js';

export async function handleWorkers(request, env, path) {
    const method = request.method;

    // Parse ID from path: /api/workers/:id
    const segments = path.split('/').filter(Boolean); // ['api', 'workers', ':id?']
    const id = segments.length >= 3 ? segments[2] : null;

    switch (method) {
        case 'GET':
            return id ? getWorker(env, id) : listWorkers(request, env);
        case 'POST':
            return createWorker(request, env);
        case 'PUT':
            return id ? updateWorker(request, env, id) : errorResponse('Worker ID required', 400);
        case 'DELETE':
            return id ? deleteWorker(env, id) : errorResponse('Worker ID required', 400);
        default:
            return errorResponse('Method Not Allowed', 405);
    }
}

async function listWorkers(request, env) {
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const search = url.searchParams.get('search');
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM workers WHERE 1=1';
    const params = [];

    if (status) {
        query += ' AND permit_status = ?';
        params.push(status);
    }

    if (search) {
        query += ' AND (name LIKE ? OR fin LIKE ? OR work_permit_no LIKE ? OR employer LIKE ?)';
        const searchTerm = `%${search}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as count');
    const totalResult = await env.DB.prepare(countQuery).bind(...params).first('count');

    // Fetch page
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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

async function getWorker(env, id) {
    const worker = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();

    if (!worker) {
        return errorResponse('Worker not found', 404);
    }

    // Also fetch associated certificates
    const { results: certificates } = await env.DB.prepare(
        'SELECT * FROM certificates WHERE worker_id = ? ORDER BY created_at DESC'
    ).bind(id).all();

    return jsonResponse({ ...worker, certificates });
}

async function createWorker(request, env) {
    const body = await request.json();
    const { fin, name, work_permit_no, employer, sector, nationality, date_of_birth, occupation, permit_status, issue_date, expiry_date, remarks } = body;

    if (!fin || !name) {
        return errorResponse('FIN and Name are required', 400);
    }

    try {
        const result = await env.DB.prepare(
            `INSERT INTO workers (fin, name, work_permit_no, employer, sector, nationality, date_of_birth, occupation, permit_status, issue_date, expiry_date, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
            fin.toUpperCase(),
            name.toUpperCase(),
            work_permit_no || null,
            employer ? employer.toUpperCase() : null,
            sector || null,
            nationality || null,
            date_of_birth || null,
            occupation || null,
            permit_status || 'active',
            issue_date || null,
            expiry_date || null,
            remarks || null
        ).run();

        const newWorker = await env.DB.prepare('SELECT * FROM workers WHERE id = ?')
            .bind(result.meta.last_row_id).first();

        return createdResponse(newWorker);
    } catch (err) {
        if (err.message.includes('UNIQUE')) {
            return errorResponse('A worker with this FIN or Work Permit No already exists', 409);
        }
        throw err;
    }
}

async function updateWorker(request, env, id) {
    const existing = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
    if (!existing) {
        return errorResponse('Worker not found', 404);
    }

    const body = await request.json();
    const fields = ['fin', 'name', 'work_permit_no', 'employer', 'sector', 'nationality', 'date_of_birth', 'occupation', 'permit_status', 'issue_date', 'expiry_date', 'photo_key', 'remarks'];

    const updates = [];
    const values = [];

    for (const field of fields) {
        if (body[field] !== undefined) {
            updates.push(`${field} = ?`);
            const val = body[field];
            // Uppercase text fields
            if (['fin', 'name', 'employer'].includes(field) && typeof val === 'string') {
                values.push(val.toUpperCase());
            } else {
                values.push(val);
            }
        }
    }

    if (updates.length === 0) {
        return errorResponse('No fields to update', 400);
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    await env.DB.prepare(
        `UPDATE workers SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();

    const updated = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
    return jsonResponse(updated);
}

async function deleteWorker(env, id) {
    const existing = await env.DB.prepare('SELECT * FROM workers WHERE id = ?').bind(id).first();
    if (!existing) {
        return errorResponse('Worker not found', 404);
    }

    await env.DB.prepare('DELETE FROM workers WHERE id = ?').bind(id).run();
    return noContentResponse();
}
