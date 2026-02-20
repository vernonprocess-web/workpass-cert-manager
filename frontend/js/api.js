/**
 * API Client
 * Handles all communication with the Cloudflare Worker backend.
 */

const API = (() => {
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

        // Don't set Content-Type for FormData
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
        // ─── Stats ────────────────────────────────────────
        getStats() {
            return request('/api/stats');
        },

        // ─── Workers ─────────────────────────────────────
        listWorkers(params = {}) {
            const query = new URLSearchParams(params).toString();
            return request(`/api/workers/list${query ? '?' + query : ''}`);
        },

        getWorker(id) {
            return request(`/api/workers/${id}`);
        },

        createWorker(data) {
            return request('/api/workers/create', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },

        deleteWorker(id) {
            return request(`/api/workers/${id}`, {
                method: 'DELETE',
            });
        },

        uploadWorkerDocument(file, finNumber, documentType) {
            const formData = new FormData();
            formData.append('file', file);
            if (finNumber) formData.append('fin_number', finNumber);
            if (documentType) formData.append('document_type', documentType);
            return request('/api/workers/upload-document', {
                method: 'POST',
                body: formData,
            });
        },

        // ─── Certifications ──────────────────────────────
        listCertifications(params = {}) {
            const query = new URLSearchParams(params).toString();
            return request(`/api/certifications/list${query ? '?' + query : ''}`);
        },

        createCertification(data) {
            return request('/api/certifications/create', {
                method: 'POST',
                body: JSON.stringify(data),
            });
        },

        deleteCertification(id) {
            return request(`/api/certifications/${id}`, {
                method: 'DELETE',
            });
        },

        // ─── OCR ─────────────────────────────────────────
        processOCR(file, documentType) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('document_type', documentType || 'auto');
            return request('/api/ocr/process', {
                method: 'POST',
                body: formData,
            });
        },

        // ─── Documents / Files ───────────────────────────
        uploadDocument(file, workerId, documentType) {
            const formData = new FormData();
            formData.append('file', file);
            if (workerId) formData.append('worker_id', workerId);
            if (documentType) formData.append('document_type', documentType);
            return request('/api/documents/upload', {
                method: 'POST',
                body: formData,
            });
        },

        getFileUrl(r2Key) {
            return `${BASE_URL}/api/files/${encodeURIComponent(r2Key)}`;
        },

        deleteFile(r2Key) {
            return request(`/api/files/${encodeURIComponent(r2Key)}`, {
                method: 'DELETE',
            });
        },
    };
})();
