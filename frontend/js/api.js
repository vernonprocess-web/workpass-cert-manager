/**
 * API Client
 * Handles all communication with the Cloudflare Worker backend.
 */

const API = (() => {
    // In production, set this to your Worker URL
    // In development, the Worker runs on localhost:8787
    const BASE_URL = window.location.hostname === 'localhost'
        ? 'http://localhost:8787'
        : 'https://workpass-cert-manager-api.vernonprocess.workers.dev';

    async function request(endpoint, options = {}) {
        const url = `${BASE_URL}${endpoint}`;
        const config = {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
            ...options,
        };

        // Don't set Content-Type for FormData (browser sets boundary automatically)
        if (options.body instanceof FormData) {
            delete config.headers['Content-Type'];
        }

        try {
            const response = await fetch(url, config);

            if (response.status === 204) {
                return { success: true };
            }

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }

            return data;
        } catch (err) {
            if (err.name === 'TypeError' && err.message.includes('fetch')) {
                throw new Error('Cannot connect to API. Is the Worker running?');
            }
            throw err;
        }
    }

    return {
        // ─── Workers (Work Permits) ────────────────────────
        getWorkers(params = {}) {
            const query = new URLSearchParams(params).toString();
            return request(`/api/workers${query ? '?' + query : ''}`);
        },

        getWorker(id) {
            return request(`/api/workers/${id}`);
        },

        createWorker(data) {
            return request('/api/workers', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },

        updateWorker(id, data) {
            return request(`/api/workers/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            });
        },

        deleteWorker(id) {
            return request(`/api/workers/${id}`, {
                method: 'DELETE',
            });
        },

        // ─── Certificates ─────────────────────────────────
        getCertificates(params = {}) {
            const query = new URLSearchParams(params).toString();
            return request(`/api/certificates${query ? '?' + query : ''}`);
        },

        getCertificate(id) {
            return request(`/api/certificates/${id}`);
        },

        createCertificate(data) {
            return request('/api/certificates', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },

        updateCertificate(id, data) {
            return request(`/api/certificates/${id}`, {
                method: 'PUT',
                body: JSON.stringify(data),
            });
        },

        deleteCertificate(id) {
            return request(`/api/certificates/${id}`, {
                method: 'DELETE',
            });
        },

        // ─── Upload / Files ───────────────────────────────
        uploadFile(file, entityType, entityId) {
            const formData = new FormData();
            formData.append('file', file);
            if (entityType) formData.append('entity_type', entityType);
            if (entityId) formData.append('entity_id', entityId);

            return request('/api/upload', {
                method: 'POST',
                body: formData,
            });
        },

        getFileUrl(key) {
            return `${BASE_URL}/api/files/${encodeURIComponent(key)}`;
        },

        deleteFile(key) {
            return request(`/api/files/${encodeURIComponent(key)}`, {
                method: 'DELETE',
            });
        },

        // ─── Stats ────────────────────────────────────────
        getStats() {
            return request('/api/stats');
        },
    };
})();
