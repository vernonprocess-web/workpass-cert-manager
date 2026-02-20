/**
 * WorkPass Cert Manager — Cloudflare Worker Entry Point
 * Routes all incoming requests to the appropriate handler.
 */

import { handleCors, addCorsHeaders } from './middleware/cors.js';
import { handleWorkers } from './routes/workers.js';
import { handleCertificates } from './routes/certificates.js';
import { handleUpload } from './routes/upload.js';
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
            if (path.startsWith('/api/workers')) {
                response = await handleWorkers(request, env, path);
            } else if (path.startsWith('/api/certificates')) {
                response = await handleCertificates(request, env, path);
            } else if (path.startsWith('/api/upload') || path.startsWith('/api/files')) {
                response = await handleUpload(request, env, path);
            } else if (path === '/api/stats') {
                response = await handleStats(request, env);
            } else if (path === '/api/health') {
                response = jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
            } else {
                response = errorResponse('Not Found', 404);
            }

            // Add CORS headers to all responses
            return addCorsHeaders(response, env);
        } catch (err) {
            console.error('Unhandled error:', err);
            return addCorsHeaders(
                errorResponse('Internal Server Error', 500),
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

    const totalWorkers = await env.DB.prepare('SELECT COUNT(*) as count FROM workers').first('count');
    const activeWorkers = await env.DB.prepare("SELECT COUNT(*) as count FROM workers WHERE permit_status = 'active'").first('count');
    const expiredWorkers = await env.DB.prepare("SELECT COUNT(*) as count FROM workers WHERE permit_status = 'expired'").first('count');
    const totalCerts = await env.DB.prepare('SELECT COUNT(*) as count FROM certificates').first('count');
    const validCerts = await env.DB.prepare("SELECT COUNT(*) as count FROM certificates WHERE cert_status = 'valid'").first('count');
    const expiredCerts = await env.DB.prepare("SELECT COUNT(*) as count FROM certificates WHERE cert_status = 'expired'").first('count');

    // Expiring soon (within 90 days)
    const expiringSoon = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM workers WHERE permit_status = 'active' AND expiry_date <= date('now', '+90 days') AND expiry_date >= date('now')"
    ).first('count');

    const certsExpiringSoon = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM certificates WHERE cert_status = 'valid' AND expiry_date <= date('now', '+90 days') AND expiry_date >= date('now')"
    ).first('count');

    return jsonResponse({
        workers: {
            total: totalWorkers,
            active: activeWorkers,
            expired: expiredWorkers,
            expiring_soon: expiringSoon,
        },
        certificates: {
            total: totalCerts,
            valid: validCerts,
            expired: expiredCerts,
            expiring_soon: certsExpiringSoon,
        },
    });
}
