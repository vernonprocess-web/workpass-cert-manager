/**
 * CORS Middleware
 * Allows requests from the configured origin or any workpass-cert-manager.pages.dev subdomain.
 */

function getAllowedOrigin(request, env) {
    const requestOrigin = request.headers.get('Origin') || '';
    const configuredOrigin = env.CORS_ORIGIN || '*';

    // Allow exact match
    if (configuredOrigin === '*' || requestOrigin === configuredOrigin) {
        return requestOrigin || '*';
    }

    // Allow any pages.dev subdomain for this project
    if (requestOrigin.endsWith('.workpass-cert-manager.pages.dev') ||
        requestOrigin === 'https://workpass-cert-manager.pages.dev') {
        return requestOrigin;
    }

    // Fallback to configured origin
    return configuredOrigin;
}

export function handleCors(request, env) {
    const origin = getAllowedOrigin(request, env);
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '86400',
        },
    });
}

export function addCorsHeaders(response, env, request) {
    const origin = request ? getAllowedOrigin(request, env) : (env.CORS_ORIGIN || '*');
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', origin);
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    newResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return newResponse;
}
