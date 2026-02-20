/**
 * WorkPass & Cert Manager — Cloudflare Worker Entry Point
 * Routes all incoming requests to the appropriate handler.
 */

import { handleCors, addCorsHeaders } from './middleware/cors.js';
import { handleWorkers } from './routes/workers.js';
import { handleCertifications } from './routes/certifications.js';
import { handleDocuments } from './routes/documents.js';
import { handleOCR } from './routes/ocr.js';
import { jsonResponse, errorResponse } from './utils/response.js';

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleCors(request, env);
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            let response;

            // ─── API Routes ──────────────────────────────────────
            if (path.startsWith('/api/ocr')) {
                response = await handleOCR(request, env, path);
            } else if (path.startsWith('/api/workers')) {
                response = await handleWorkers(request, env, path);
            } else if (path.startsWith('/api/certifications')) {
                response = await handleCertifications(request, env, path);
            } else if (path.startsWith('/api/documents') || path.startsWith('/api/files')) {
                response = await handleDocuments(request, env, path);
            } else if (path === '/api/stats') {
                response = await handleStats(request, env);
            } else if (path === '/api/health') {
                response = jsonResponse({
                    status: 'ok',
                    system: 'workpass-cert-manager',
                    timestamp: new Date().toISOString(),
                });
            } else {
                response = errorResponse('Not Found', 404);
            }

            return addCorsHeaders(response, env);
        } catch (err) {
            console.error('Unhandled error:', err.message, err.stack);
            return addCorsHeaders(
                errorResponse('Internal Server Error: ' + err.message, 500),
                env
            );
        }
    },
};

/**
 * Dashboard statistics
 */
async function handleStats(request, env) {
    if (request.method !== 'GET') {
        return errorResponse('Method Not Allowed', 405);
    }

    const totalWorkers = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM workers'
    ).first('count');

    const totalCerts = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM certifications'
    ).first('count');

    const totalDocs = await env.DB.prepare(
        'SELECT COUNT(*) as count FROM documents'
    ).first('count');

    // Certs expiring within 90 days
    const certsExpiringSoon = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM certifications WHERE expiry_date <= date('now', '+90 days') AND expiry_date >= date('now')"
    ).first('count');

    // Certs already expired
    const certsExpired = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM certifications WHERE expiry_date < date('now')"
    ).first('count');

    // Recent workers (last 5)
    const { results: recentWorkers } = await env.DB.prepare(
        'SELECT id, fin_number, worker_name, employer_name, created_at FROM workers ORDER BY created_at DESC LIMIT 5'
    ).all();

    return jsonResponse({
        workers: {
            total: totalWorkers,
        },
        certifications: {
            total: totalCerts,
            expiring_soon: certsExpiringSoon,
            expired: certsExpired,
        },
        documents: {
            total: totalDocs,
        },
        recent_workers: recentWorkers,
    });
}
