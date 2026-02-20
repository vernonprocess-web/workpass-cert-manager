/**
 * Auth Middleware
 * Simple shared-secret authentication for API protection.
 */

export function authenticate(request, env) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.slice(7);
    return token === env.AUTH_SECRET;
}

export function requireAuth(request, env) {
    if (!env.AUTH_SECRET) {
        // No secret configured — allow all requests (dev mode)
        return null;
    }

    if (!authenticate(request, env)) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return null; // Auth passed
}
