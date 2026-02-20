/**
 * WorkPass Cert Manager — Main Application Logic
 */

const App = (() => {
    // ─── State ──────────────────────────────────────────────
    let currentPage = 'dashboard';
    let selectedFiles = [];

    // ─── Initialize ─────────────────────────────────────────
    function init() {
        Router.init();
        setupMobileMenu();
        setupUpload();
        setupModals();
        setupFilters();
    }

    // ─── Page Change Callback ───────────────────────────────
    function onPageChange(page) {
        currentPage = page;
        switch (page) {
            case 'dashboard': loadDashboard(); break;
            case 'workers': loadWorkers(); break;
            case 'certificates': loadCertificates(); break;
            case 'upload': break; // Static page
        }
    }

    // ─── Mobile Menu ────────────────────────────────────────
    function setupMobileMenu() {
        const toggle = document.getElementById('menu-toggle');
        const sidebar = document.getElementById('sidebar');

        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768 &&
                sidebar.classList.contains('open') &&
                !sidebar.contains(e.target) &&
                !toggle.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });
    }

    // ═══════════════════════════════════════════════════════
    //  DASHBOARD
    // ═══════════════════════════════════════════════════════

    async function loadDashboard() {
        try {
            const stats = await API.getStats();

            document.getElementById('stat-total-workers').textContent = stats.workers.total;
            document.getElementById('stat-active-workers').textContent = stats.workers.active;
            document.getElementById('stat-expiring-soon').textContent = stats.workers.expiring_soon;
            document.getElementById('stat-expired-workers').textContent = stats.workers.expired;
            document.getElementById('stat-total-certs').textContent = stats.certificates.total;
            document.getElementById('stat-valid-certs').textContent = stats.certificates.valid;

            // Load recent workers for dashboard table
            const workersData = await API.getWorkers({ limit: 5 });
            renderDashboardTable(workersData.data || []);
        } catch (err) {
            console.error('Failed to load dashboard:', err);
            showToast('Failed to load dashboard data', 'error');
            // Show zeros on error
            ['stat-total-workers', 'stat-active-workers', 'stat-expiring-soon',
                'stat-expired-workers', 'stat-total-certs', 'stat-valid-certs'].forEach(id => {
                    document.getElementById(id).textContent = '0';
                });
        }
    }

    function renderDashboardTable(workers) {
        const tbody = document.getElementById('dashboard-workers-tbody');
        if (workers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No work permits found. Add your first worker!</td></tr>';
            return;
        }

        tbody.innerHTML = workers.map(w => `
      <tr>
        <td><strong>${escHtml(w.fin)}</strong></td>
        <td>${escHtml(w.name)}</td>
        <td>${escHtml(w.employer || '—')}</td>
        <td>${escHtml(w.sector || '—')}</td>
        <td><span class="badge badge--${w.permit_status}">${w.permit_status}</span></td>
        <td>${w.expiry_date || '—'}</td>
      </tr>
    `).join('');
    }

    // ═══════════════════════════════════════════════════════
    //  WORKERS
    // ═══════════════════════════════════════════════════════

    let workersPage = 1;

    async function loadWorkers(page = 1) {
        workersPage = page;
        const search = document.getElementById('workers-search').value;
        const status = document.getElementById('workers-status-filter').value;

        try {
            const params = { page, limit: 15 };
            if (search) params.search = search;
            if (status) params.status = status;

            const result = await API.getWorkers(params);
            renderWorkersTable(result.data || []);
            renderPagination('workers-pagination', result.pagination, loadWorkers);
        } catch (err) {
            console.error('Failed to load workers:', err);
            showToast('Failed to load workers', 'error');
        }
    }

    function renderWorkersTable(workers) {
        const tbody = document.getElementById('workers-tbody');
        if (workers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No workers found</td></tr>';
            return;
        }

        tbody.innerHTML = workers.map(w => `
      <tr>
        <td><strong>${escHtml(w.fin)}</strong></td>
        <td>${escHtml(w.name)}</td>
        <td>${escHtml(w.work_permit_no || '—')}</td>
        <td>${escHtml(w.employer || '—')}</td>
        <td>${escHtml(w.sector || '—')}</td>
        <td>${escHtml(w.nationality || '—')}</td>
        <td><span class="badge badge--${w.permit_status}">${w.permit_status}</span></td>
        <td>${w.expiry_date || '—'}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn" onclick="App.editWorker(${w.id})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn action-btn--danger" onclick="App.confirmDeleteWorker(${w.id}, '${escHtml(w.name)}')" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    }

    function setupFilters() {
        // Workers filters
        let debounce;
        document.getElementById('workers-search').addEventListener('input', () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => loadWorkers(1), 400);
        });

        document.getElementById('workers-status-filter').addEventListener('change', () => loadWorkers(1));

        // Certificates filters
        document.getElementById('certs-type-filter').addEventListener('change', () => loadCertificates(1));
        document.getElementById('certs-status-filter').addEventListener('change', () => loadCertificates(1));

        // Add worker button
        document.getElementById('btn-add-worker').addEventListener('click', () => showWorkerModal());
        document.getElementById('btn-add-cert').addEventListener('click', () => showCertificateModal());
    }

    function showWorkerModal(worker = null) {
        const isEdit = !!worker;
        const title = isEdit ? 'Edit Worker' : 'Add Worker';

        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = `
      <div class="form-row">
        <div class="form-group">
          <label for="modal-fin">FIN *</label>
          <input type="text" id="modal-fin" class="form-control" placeholder="e.g. G1234567A" value="${worker?.fin || ''}" ${isEdit ? 'readonly' : ''}>
        </div>
        <div class="form-group">
          <label for="modal-wp-no">Work Permit No</label>
          <input type="text" id="modal-wp-no" class="form-control" placeholder="e.g. WP1234567" value="${worker?.work_permit_no || ''}">
        </div>
      </div>
      <div class="form-group">
        <label for="modal-name">Full Name *</label>
        <input type="text" id="modal-name" class="form-control" placeholder="Full name" value="${worker?.name || ''}">
      </div>
      <div class="form-group">
        <label for="modal-employer">Employer</label>
        <input type="text" id="modal-employer" class="form-control" placeholder="Company name" value="${worker?.employer || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-sector">Sector</label>
          <select id="modal-sector" class="form-control">
            <option value="">Select...</option>
            ${['Construction', 'Marine', 'Manufacturing', 'Process', 'Services'].map(s =>
            `<option value="${s}" ${worker?.sector === s ? 'selected' : ''}>${s}</option>`
        ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="modal-nationality">Nationality</label>
          <input type="text" id="modal-nationality" class="form-control" placeholder="e.g. Indian" value="${worker?.nationality || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-dob">Date of Birth</label>
          <input type="date" id="modal-dob" class="form-control" value="${worker?.date_of_birth || ''}">
        </div>
        <div class="form-group">
          <label for="modal-occupation">Occupation</label>
          <input type="text" id="modal-occupation" class="form-control" placeholder="e.g. General Worker" value="${worker?.occupation || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-status">Status</label>
          <select id="modal-status" class="form-control">
            ${['active', 'expired', 'cancelled'].map(s =>
            `<option value="${s}" ${(worker?.permit_status || 'active') === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="modal-issue">Issue Date</label>
          <input type="date" id="modal-issue" class="form-control" value="${worker?.issue_date || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-expiry">Expiry Date</label>
          <input type="date" id="modal-expiry" class="form-control" value="${worker?.expiry_date || ''}">
        </div>
        <div class="form-group">
          <label for="modal-remarks">Remarks</label>
          <input type="text" id="modal-remarks" class="form-control" placeholder="Optional notes" value="${worker?.remarks || ''}">
        </div>
      </div>
    `;

        document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save-worker">${isEdit ? 'Update' : 'Create'}</button>
    `;

        document.getElementById('modal-save-worker').addEventListener('click', async () => {
            const data = {
                fin: document.getElementById('modal-fin').value.trim(),
                name: document.getElementById('modal-name').value.trim(),
                work_permit_no: document.getElementById('modal-wp-no').value.trim() || null,
                employer: document.getElementById('modal-employer').value.trim() || null,
                sector: document.getElementById('modal-sector').value || null,
                nationality: document.getElementById('modal-nationality').value.trim() || null,
                date_of_birth: document.getElementById('modal-dob').value || null,
                occupation: document.getElementById('modal-occupation').value.trim() || null,
                permit_status: document.getElementById('modal-status').value,
                issue_date: document.getElementById('modal-issue').value || null,
                expiry_date: document.getElementById('modal-expiry').value || null,
                remarks: document.getElementById('modal-remarks').value.trim() || null,
            };

            if (!data.fin || !data.name) {
                showToast('FIN and Name are required', 'error');
                return;
            }

            try {
                if (isEdit) {
                    await API.updateWorker(worker.id, data);
                    showToast('Worker updated successfully', 'success');
                } else {
                    await API.createWorker(data);
                    showToast('Worker created successfully', 'success');
                }
                closeModal();
                loadWorkers(workersPage);
                if (currentPage === 'dashboard') loadDashboard();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        openModal();
    }

    async function editWorker(id) {
        try {
            const worker = await API.getWorker(id);
            showWorkerModal(worker);
        } catch (err) {
            showToast('Failed to load worker', 'error');
        }
    }

    function confirmDeleteWorker(id, name) {
        document.getElementById('modal-title').textContent = 'Delete Worker';
        document.getElementById('modal-body').innerHTML = `
      <p>Are you sure you want to delete <strong>${escHtml(name)}</strong>?</p>
      <p style="color: var(--accent-danger); margin-top: 8px; font-size: 13px;">
        This will also delete all associated certificates and cannot be undone.
      </p>
    `;
        document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm-delete">Delete</button>
    `;

        document.getElementById('modal-confirm-delete').addEventListener('click', async () => {
            try {
                await API.deleteWorker(id);
                showToast('Worker deleted', 'success');
                closeModal();
                loadWorkers(workersPage);
                if (currentPage === 'dashboard') loadDashboard();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        openModal();
    }

    // ═══════════════════════════════════════════════════════
    //  CERTIFICATES
    // ═══════════════════════════════════════════════════════

    let certsPage = 1;

    async function loadCertificates(page = 1) {
        certsPage = page;
        const certType = document.getElementById('certs-type-filter').value;
        const status = document.getElementById('certs-status-filter').value;

        try {
            const params = { page, limit: 15 };
            if (certType) params.type = certType;
            if (status) params.status = status;

            const result = await API.getCertificates(params);
            renderCertsTable(result.data || []);
            renderPagination('certs-pagination', result.pagination, loadCertificates);
        } catch (err) {
            console.error('Failed to load certificates:', err);
            showToast('Failed to load certificates', 'error');
        }
    }

    function renderCertsTable(certs) {
        const tbody = document.getElementById('certs-tbody');
        if (certs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No certificates found</td></tr>';
            return;
        }

        tbody.innerHTML = certs.map(c => `
      <tr>
        <td><strong>${escHtml(c.cert_name)}</strong></td>
        <td><span class="badge badge--valid" style="text-transform: capitalize;">${escHtml(c.cert_type)}</span></td>
        <td>${escHtml(c.cert_number || '—')}</td>
        <td>${escHtml(c.worker_name || '—')} ${c.worker_fin ? `<br><small style="color:var(--text-muted)">${escHtml(c.worker_fin)}</small>` : ''}</td>
        <td>${escHtml(c.issuing_body || '—')}</td>
        <td><span class="badge badge--${c.cert_status}">${c.cert_status}</span></td>
        <td>${c.expiry_date || '—'}</td>
        <td>
          <div class="action-btns">
            <button class="action-btn" onclick="App.editCertificate(${c.id})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn action-btn--danger" onclick="App.confirmDeleteCert(${c.id}, '${escHtml(c.cert_name)}')" title="Delete">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
    }

    function showCertificateModal(cert = null) {
        const isEdit = !!cert;
        const title = isEdit ? 'Edit Certificate' : 'Add Certificate';

        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = `
      <div class="form-group">
        <label for="modal-cert-worker-id">Worker ID *</label>
        <input type="number" id="modal-cert-worker-id" class="form-control" placeholder="Worker ID" value="${cert?.worker_id || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-cert-type">Type *</label>
          <select id="modal-cert-type" class="form-control">
            ${['coretrade', 'myw', 'safety'].map(t =>
            `<option value="${t}" ${cert?.cert_type === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`
        ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="modal-cert-number">Cert Number</label>
          <input type="text" id="modal-cert-number" class="form-control" placeholder="e.g. CT-2025-001" value="${cert?.cert_number || ''}">
        </div>
      </div>
      <div class="form-group">
        <label for="modal-cert-name">Certificate Name *</label>
        <input type="text" id="modal-cert-name" class="form-control" placeholder="e.g. CoreTrade for Concreting" value="${cert?.cert_name || ''}">
      </div>
      <div class="form-group">
        <label for="modal-cert-issuer">Issuing Body</label>
        <input type="text" id="modal-cert-issuer" class="form-control" placeholder="e.g. BCA" value="${cert?.issuing_body || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-cert-issue-date">Issue Date</label>
          <input type="date" id="modal-cert-issue-date" class="form-control" value="${cert?.issue_date || ''}">
        </div>
        <div class="form-group">
          <label for="modal-cert-expiry">Expiry Date</label>
          <input type="date" id="modal-cert-expiry" class="form-control" value="${cert?.expiry_date || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="modal-cert-status">Status</label>
          <select id="modal-cert-status" class="form-control">
            ${['valid', 'expired', 'revoked'].map(s =>
            `<option value="${s}" ${(cert?.cert_status || 'valid') === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
        ).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="modal-cert-remarks">Remarks</label>
          <input type="text" id="modal-cert-remarks" class="form-control" placeholder="Optional" value="${cert?.remarks || ''}">
        </div>
      </div>
    `;

        document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save-cert">${isEdit ? 'Update' : 'Create'}</button>
    `;

        document.getElementById('modal-save-cert').addEventListener('click', async () => {
            const data = {
                worker_id: parseInt(document.getElementById('modal-cert-worker-id').value, 10),
                cert_type: document.getElementById('modal-cert-type').value,
                cert_number: document.getElementById('modal-cert-number').value.trim() || null,
                cert_name: document.getElementById('modal-cert-name').value.trim(),
                issuing_body: document.getElementById('modal-cert-issuer').value.trim() || null,
                issue_date: document.getElementById('modal-cert-issue-date').value || null,
                expiry_date: document.getElementById('modal-cert-expiry').value || null,
                cert_status: document.getElementById('modal-cert-status').value,
                remarks: document.getElementById('modal-cert-remarks').value.trim() || null,
            };

            if (!data.worker_id || !data.cert_type || !data.cert_name) {
                showToast('Worker ID, Type, and Name are required', 'error');
                return;
            }

            try {
                if (isEdit) {
                    await API.updateCertificate(cert.id, data);
                    showToast('Certificate updated', 'success');
                } else {
                    await API.createCertificate(data);
                    showToast('Certificate created', 'success');
                }
                closeModal();
                loadCertificates(certsPage);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        openModal();
    }

    async function editCertificate(id) {
        try {
            const cert = await API.getCertificate(id);
            showCertificateModal(cert);
        } catch (err) {
            showToast('Failed to load certificate', 'error');
        }
    }

    function confirmDeleteCert(id, name) {
        document.getElementById('modal-title').textContent = 'Delete Certificate';
        document.getElementById('modal-body').innerHTML = `
      <p>Are you sure you want to delete <strong>${escHtml(name)}</strong>?</p>
      <p style="color: var(--accent-danger); margin-top: 8px; font-size: 13px;">This action cannot be undone.</p>
    `;
        document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm-delete-cert">Delete</button>
    `;

        document.getElementById('modal-confirm-delete-cert').addEventListener('click', async () => {
            try {
                await API.deleteCertificate(id);
                showToast('Certificate deleted', 'success');
                closeModal();
                loadCertificates(certsPage);
            } catch (err) {
                showToast(err.message, 'error');
            }
        });

        openModal();
    }

    // ═══════════════════════════════════════════════════════
    //  UPLOAD
    // ═══════════════════════════════════════════════════════

    function setupUpload() {
        const zone = document.getElementById('upload-zone');
        const input = document.getElementById('file-input');
        const btn = document.getElementById('btn-upload');

        // Click to browse
        zone.addEventListener('click', () => input.click());

        // File selection
        input.addEventListener('change', () => {
            selectedFiles = Array.from(input.files);
            btn.disabled = selectedFiles.length === 0;
            updateUploadZoneText();
        });

        // Drag & drop
        zone.addEventListener('dragover', (e) => {
            e.preventDefault();
            zone.classList.add('drag-over');
        });

        zone.addEventListener('dragleave', () => {
            zone.classList.remove('drag-over');
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('drag-over');
            selectedFiles = Array.from(e.dataTransfer.files);
            btn.disabled = selectedFiles.length === 0;
            updateUploadZoneText();
        });

        // Upload button
        btn.addEventListener('click', uploadFiles);
    }

    function updateUploadZoneText() {
        const zone = document.getElementById('upload-zone');
        const h3 = zone.querySelector('h3');
        const p = zone.querySelector('p');
        if (selectedFiles.length > 0) {
            h3.textContent = `${selectedFiles.length} file(s) selected`;
            p.textContent = selectedFiles.map(f => f.name).join(', ');
        } else {
            h3.textContent = 'Drag & drop files here';
            p.textContent = 'or click to browse';
        }
    }

    async function uploadFiles() {
        if (selectedFiles.length === 0) return;

        const entityType = document.getElementById('upload-entity-type').value;
        const entityId = document.getElementById('upload-entity-id').value;
        const progressEl = document.getElementById('upload-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const resultsEl = document.getElementById('upload-results');
        const btn = document.getElementById('btn-upload');

        progressEl.hidden = false;
        btn.disabled = true;
        resultsEl.innerHTML = '';

        let completed = 0;
        const total = selectedFiles.length;

        for (const file of selectedFiles) {
            try {
                const result = await API.uploadFile(file, entityType, entityId);
                completed++;
                progressFill.style.width = `${(completed / total) * 100}%`;
                progressText.textContent = `Uploaded ${completed}/${total}`;

                resultsEl.innerHTML += `
          <div class="upload-result-item success">
            <span>${escHtml(file.name)}</span>
            <span style="color: var(--accent-success);">✓ Uploaded</span>
          </div>
        `;
            } catch (err) {
                completed++;
                progressFill.style.width = `${(completed / total) * 100}%`;
                resultsEl.innerHTML += `
          <div class="upload-result-item error">
            <span>${escHtml(file.name)}</span>
            <span style="color: var(--accent-danger);">✗ ${escHtml(err.message)}</span>
          </div>
        `;
            }
        }

        progressText.textContent = `Complete — ${completed} file(s) processed`;
        selectedFiles = [];
        document.getElementById('file-input').value = '';
        btn.disabled = false;
    }

    // ═══════════════════════════════════════════════════════
    //  MODAL
    // ═══════════════════════════════════════════════════════

    function setupModals() {
        document.getElementById('modal-close').addEventListener('click', closeModal);
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal-overlay')) {
                closeModal();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });
    }

    function openModal() {
        document.getElementById('modal-overlay').hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeModal() {
        document.getElementById('modal-overlay').hidden = true;
        document.body.style.overflow = '';
    }

    // ═══════════════════════════════════════════════════════
    //  PAGINATION
    // ═══════════════════════════════════════════════════════

    function renderPagination(containerId, pagination, callback) {
        const container = document.getElementById(containerId);
        if (!pagination || pagination.total_pages <= 1) {
            container.innerHTML = '';
            return;
        }

        const { page, total_pages } = pagination;
        let html = '';

        html += `<button ${page <= 1 ? 'disabled' : ''} onclick="App._paginate('${containerId}', ${page - 1})">← Prev</button>`;

        const range = getPageRange(page, total_pages);
        for (const p of range) {
            if (p === '...') {
                html += `<button disabled>…</button>`;
            } else {
                html += `<button class="${p === page ? 'active' : ''}" onclick="App._paginate('${containerId}', ${p})">${p}</button>`;
            }
        }

        html += `<button ${page >= total_pages ? 'disabled' : ''} onclick="App._paginate('${containerId}', ${page + 1})">Next →</button>`;

        container.innerHTML = html;

        // Store callback reference
        container._callback = callback;
    }

    function getPageRange(current, total) {
        if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
        if (current <= 3) return [1, 2, 3, 4, '...', total];
        if (current >= total - 2) return [1, '...', total - 3, total - 2, total - 1, total];
        return [1, '...', current - 1, current, current + 1, '...', total];
    }

    function _paginate(containerId, page) {
        const container = document.getElementById(containerId);
        if (container._callback) container._callback(page);
    }

    // ═══════════════════════════════════════════════════════
    //  TOAST NOTIFICATIONS
    // ═══════════════════════════════════════════════════════

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.innerHTML = `
      <span>${escHtml(message)}</span>
      <button class="toast-dismiss" onclick="this.parentElement.remove()">×</button>
    `;
        container.appendChild(toast);

        // Auto-dismiss after 5s
        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(30px)';
                toast.style.transition = '0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }

    // ═══════════════════════════════════════════════════════
    //  UTILITIES
    // ═══════════════════════════════════════════════════════

    function escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ─── Public API ──────────────────────────────────────
    return {
        init,
        onPageChange,
        editWorker,
        confirmDeleteWorker,
        editCertificate,
        confirmDeleteCert,
        closeModal,
        _paginate,
    };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
