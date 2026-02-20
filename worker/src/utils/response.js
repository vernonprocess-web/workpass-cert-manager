/**
 * Response Utilities
 */

export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export function errorResponse(message, status = 400) {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export function createdResponse(data) {
    return jsonResponse(data, 201);
}

export function noContentResponse() {
    return new Response(null, { status: 204 });
}
