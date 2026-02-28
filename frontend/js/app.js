/**
 * WorkPass & Cert Manager — Main Application Logic
 */

const App = (() => {
  // ─── State ──────────────────────────────────────────────
  let currentWorkerProfile = null;
  let ocrFiles = [];
  let ocrResult = null;
  let workersPage = 1;
  let certsPage = 1;
  let searchDebounce = null;
  let certSortKey = 'issue_date';
  let certSortAsc = false;

  // ─── Init ───────────────────────────────────────────────
  function init() {
    Router.init();
    bindEvents();
    loadDashboard();
  }

  function bindEvents() {
    // Mobile menu
    document.getElementById('menu-toggle')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.toggle('open');
    });

    // Workers search
    const searchInput = document.getElementById('workers-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
          workersPage = 1;
          loadWorkers();
        }, 300);
      });
    }

    // Add Worker button
    document.getElementById('btn-add-worker')?.addEventListener('click', showAddWorkerModal);

    // Export Workers button
    document.getElementById('btn-export-workers')?.addEventListener('click', exportSelectedWorkers);

    // Export individual worker profile to Excel
    document.getElementById('btn-export-profile')?.addEventListener('click', exportWorkerProfile);

    // Add Certification button
    document.getElementById('btn-add-cert')?.addEventListener('click', () => showAddCertModal());
    document.getElementById('btn-add-cert-profile')?.addEventListener('click', () => {
      if (currentWorkerProfile) showAddCertModal(currentWorkerProfile.id, currentWorkerProfile.fin_number);
    });

    // Modal close
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // OCR Upload
    initOCRUpload();

    // Hidden file input for "Add More"
    document.getElementById('ocr-add-more')?.addEventListener('click', () => {
      if (ocrFiles.length >= 4) { showToast('Maximum 4 images allowed', 'error'); return; }
      document.getElementById('ocr-file-input')?.click();
    });

    // Profile cert sorting headers
    document.getElementById('th-cert-issue')?.addEventListener('click', () => toggleCertSort('issue_date'));
    document.getElementById('th-cert-expiry')?.addEventListener('click', () => toggleCertSort('expiry_date'));
  }

  // ─── Router callback ────────────────────────────────────
  function onPageChange(page, params = []) {
    switch (page) {
      case 'dashboard': loadDashboard(); break;
      case 'workers': loadWorkers(); break;
      case 'worker-profile':
        if (params[0]) loadWorkerProfile(params[0]);
        break;
      case 'certifications': loadCertifications(); break;
      case 'upload': resetOCR(); break;
    }
  }

  // ═══════════════════════════════════════════════════════
  // DASHBOARD
  // ═══════════════════════════════════════════════════════
  async function loadDashboard() {
    try {
      const stats = await API.getStats();
      setText('stat-total-workers', stats.workers?.total ?? 0);
      setText('stat-total-certs', stats.certifications?.total ?? 0);
      setText('stat-expiring-soon', stats.certifications?.expiring_soon ?? 0);
      setText('stat-expired-certs', stats.certifications?.expired ?? 0);
      setText('stat-total-docs', stats.documents?.total ?? 0);

      // Recent workers table
      const tbody = document.getElementById('dashboard-workers-tbody');
      if (tbody && stats.recent_workers) {
        if (stats.recent_workers.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No workers yet. Upload a work permit to get started.</td></tr>';
        } else {
          tbody.innerHTML = stats.recent_workers.map(w => `
                        <tr style="cursor:pointer" onclick="Router.navigate('worker-profile','${w.id}')">
                            <td><strong>${esc(w.fin_number)}</strong></td>
                            <td>${esc(w.work_permit_no || '—')}</td>
                            <td>${esc(w.worker_name)}</td>
                            <td>${esc(w.employer_name || '—')}</td>
                            <td>${esc(w.nationality || '—')}</td>
                            <td>${formatDate(w.created_at)}</td>
                        </tr>
                    `).join('');
        }
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
      showToast('Failed to load dashboard: ' + err.message, 'error');
    }
  }

  // ═══════════════════════════════════════════════════════
  // WORKERS LIST
  // ═══════════════════════════════════════════════════════
  async function loadWorkers() {
    const tbody = document.getElementById('workers-tbody');
    if (!tbody) return;

    const search = document.getElementById('workers-search')?.value || '';

    try {
      const result = await API.listWorkers({ page: workersPage, limit: 20, search });
      const workers = result.data || [];

      if (workers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No workers found</td></tr>';
      } else {
        tbody.innerHTML = workers.map(w => `
                        <tr>
                            <td><input type="checkbox" class="worker-checkbox" value="${w.id}"></td>
                            <td><strong style="color:var(--accent-primary);cursor:pointer" onclick="Router.navigate('worker-profile','${w.id}')">${esc(w.fin_number)}</strong></td>
                            <td>${esc(w.work_permit_no || '—')}</td>
                            <td>${esc(w.worker_name)}</td>
                            <td>${esc(w.date_of_birth || '—')}</td>
                            <td>${esc(w.nationality || '—')}</td>
                            <td>${esc(w.sex || '—')}</td>
                            <td>${esc(w.employer_name || '—')}</td>
                            <td>${expiryBadge(w.wp_expiry_date)}</td>
                            <td>
                                <div class="action-btns">
                                    <button class="action-btn action-btn--view" title="View" onclick="Router.navigate('worker-profile','${w.id}')">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                    </button>
                                    <button class="action-btn action-btn--danger" title="Delete" onclick="deleteWorkerConfirm(${w.id},'${esc(w.worker_name)}')">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                    </button>
                                </div>
                            </td>
                        </tr>
                `).join('');
      }

      renderPagination('workers-pagination', result.pagination, (p) => { workersPage = p; loadWorkers(); });

      // Setup export checkboxes
      const selectAll = document.getElementById('selectAllWorkers');
      if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = (e) => {
          document.querySelectorAll('.worker-checkbox').forEach(cb => cb.checked = e.target.checked);
          updateExportButtonState();
        };
      }
      document.querySelectorAll('.worker-checkbox').forEach(cb => {
        cb.onchange = updateExportButtonState;
      });
      updateExportButtonState();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="10" class="empty-state">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  function updateExportButtonState() {
    const checked = document.querySelectorAll('.worker-checkbox:checked');
    const exportBtn = document.getElementById('btn-export-workers');
    if (exportBtn) {
      exportBtn.disabled = checked.length === 0;
    }

    const selectAll = document.getElementById('selectAllWorkers');
    const all = document.querySelectorAll('.worker-checkbox');
    if (selectAll && all.length > 0) {
      selectAll.checked = checked.length === all.length;
    }
  }

  async function exportSelectedWorkers() {
    const checked = document.querySelectorAll('.worker-checkbox:checked');
    const workerIds = Array.from(checked).map(cb => parseInt(cb.value, 10));

    if (workerIds.length === 0) return;

    const exportBtn = document.getElementById('btn-export-workers');
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = 'Exporting...';
    exportBtn.disabled = true;

    try {
      const res = await API.exportWorkers(workerIds);
      const workers = res.data || [];

      if (workers.length > 0) {
        // Build CSV
        const headers = ['FIN / NRIC', 'Worker Name', 'WP No', 'Date of Birth', 'Nationality', 'Sex', 'Employer', 'WP Expiry', 'Recorded Date'];
        let csvContent = headers.join(',') + '\n';

        workers.forEach(worker => {
          const row = [
            worker.fin_number || '',
            worker.worker_name || '',
            worker.work_permit_no || '',
            worker.date_of_birth || '',
            worker.nationality || '',
            worker.sex || '',
            worker.employer_name || '',
            worker.wp_expiry_date || '',
            worker.created_at || ''
          ];

          // Escape quotes and wrap every field in quotes
          const csvRow = row.map(field => {
            const stringField = String(field);
            return `"${stringField.replace(/"/g, '""')}"`;
          }).join(',');

          csvContent += csvRow + '\n';
        });

        // Trigger download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `worker_export_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast('Export successful! Download starting...', 'success');
      } else {
        showToast('No valid workers found to export.', 'warning');
      }

      // Deselect all
      document.querySelectorAll('.worker-checkbox').forEach(cb => cb.checked = false);
      updateExportButtonState();
    } catch (err) {
      showToast(err.message || 'Export failed', 'error');
    } finally {
      if (exportBtn) {
        exportBtn.innerHTML = originalText;
        exportBtn.disabled = false;
        updateExportButtonState();
      }
    }
  }

  // ═══════════════════════════════════════════════════════
  // WORKER PROFILE
  // ═══════════════════════════════════════════════════════
  async function loadWorkerProfile(id) {
    const detailsEl = document.getElementById('profile-details');
    const titleEl = document.getElementById('profile-title');
    if (!detailsEl) return;

    detailsEl.innerHTML = 'Loading...';

    try {
      const worker = await API.getWorker(id);
      currentWorkerProfile = worker;

      if (titleEl) titleEl.textContent = worker.worker_name;

      // Extract WP Documents
      const wpDocs = (worker.documents || []).filter(d => (d.document_type || '').toLowerCase().includes('work_permit'));
      const wpFront = wpDocs[0];
      const wpBack = wpDocs[1];

      function renderWPImage(title, doc) {
        if (!doc) {
          return `
            <div class="wp-column">
              <span class="profile-field-label" style="flex: none; margin-bottom: 8px;">${title}</span>
              <div class="wp-placeholder">No Image Uploaded</div>
            </div>`;
        }
        const url = API.getFileUrl(doc.r2_key);
        return `
            <div class="wp-column">
              <span class="profile-field-label" style="flex: none; margin-bottom: 8px;">${title}</span>
              <a href="${url}" target="_blank" title="View Fullscreen" class="wp-lightbox">
                <img src="${url}" alt="${title}" loading="lazy" class="wp-image" />
              </a>
            </div>`;
      }

      detailsEl.innerHTML = `
                <div class="profile-data-col">
                  <div class="profile-field"><span class="profile-field-label">FIN / NRIC Number</span><span class="profile-field-value">${esc(worker.fin_number)}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Work Permit No</span><span class="profile-field-value">${esc(worker.work_permit_no || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Worker Name</span><span class="profile-field-value">${esc(worker.worker_name)}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Date of Birth</span><span class="profile-field-value">${formatDate(worker.date_of_birth)}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Nationality</span><span class="profile-field-value">${esc(worker.nationality || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Sex</span><span class="profile-field-value">${esc(worker.sex || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Race</span><span class="profile-field-value">${esc(worker.race || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Country/Place of Birth</span><span class="profile-field-value">${esc(worker.country_of_birth || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Address</span><span class="profile-field-value">${esc(worker.address || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Employer</span><span class="profile-field-value">${esc(worker.employer_name || '—')}</span></div>
                  <div class="profile-field"><span class="profile-field-label">WP Expiry Date</span><span class="profile-field-value">${expiryBadge(worker.wp_expiry_date)}</span></div>
                  <div class="profile-field"><span class="profile-field-label">Created</span><span class="profile-field-value">${formatDate(worker.created_at)}</span></div>
                </div>
                ${renderWPImage('Work Permit Front', wpFront)}
                ${renderWPImage('Work Permit Back', wpBack)}
            `;

      // Certifications
      renderProfileCerts();

      // Documents
      const docsEl = document.getElementById('profile-documents');
      if (docsEl) {
        const docs = worker.documents || [];
        if (docs.length === 0) {
          docsEl.innerHTML = '<p class="empty-state">No documents uploaded</p>';
        } else {
          docsEl.innerHTML = docs.map(d => `
            <div class="document-item">
                <a href="${esc(d.url)}" target="_blank" class="document-link">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                    <span>${esc(d.document_type || 'Document')}</span>
                </a>
                <span class="document-date">${formatDate(d.created_at)}</span>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      detailsEl.innerHTML = `<span class="empty-state">Error: ${esc(err.message)}</span>`;
      if (titleEl) titleEl.textContent = 'Worker Not Found';
    }
  }

  function toggleCertSort(key) {
    if (certSortKey === key) {
      certSortAsc = !certSortAsc;
    } else {
      certSortKey = key;
      certSortAsc = false; // default new sort to Descending (newest first)
    }
    renderProfileCerts();
  }

  function renderProfileCerts() {
    if (!currentWorkerProfile) return;

    const certTbody = document.getElementById('profile-certs-tbody');
    const issueIcon = document.querySelector('#th-cert-issue .sort-icon');
    const expiryIcon = document.querySelector('#th-cert-expiry .sort-icon');

    if (issueIcon) issueIcon.textContent = certSortKey === 'issue_date' ? (certSortAsc ? '↑' : '↓') : '';
    if (expiryIcon) expiryIcon.textContent = certSortKey === 'expiry_date' ? (certSortAsc ? '↑' : '↓') : '';

    if (!certTbody) return;

    let certs = currentWorkerProfile.certifications ? [...currentWorkerProfile.certifications] : [];

    if (certs.length === 0) {
      certTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No certifications</td></tr>';
      return;
    }

    certs.sort((a, b) => {
      const valA = a[certSortKey] || '';
      const valB = b[certSortKey] || '';
      if (valA < valB) return certSortAsc ? -1 : 1;
      if (valA > valB) return certSortAsc ? 1 : -1;
      return 0;
    });

    certTbody.innerHTML = certs.map(c => `
        <tr>
            <td>${esc(c.course_title)}</td>
            <td>${esc(c.course_provider || '—')}</td>
            <td>${esc(c.cert_serial_no || '—')}</td>
            <td>${esc(c.course_duration || '—')}</td>
            <td>${formatDate(c.issue_date)}</td>
            <td>${expiryBadge(c.expiry_date)}</td>
        </tr>
    `).join('');
  }

  async function exportWorkerProfile() {
    if (!currentWorkerProfile) return;

    // Change button state
    const exportBtn = document.getElementById('btn-export-profile');
    const originalText = exportBtn.innerHTML;
    exportBtn.innerHTML = 'Generating Excel...';
    exportBtn.disabled = true;

    try {
      // Create new workbook using ExcelJS
      const wb = new ExcelJS.Workbook();
      wb.creator = 'WorkPass & Cert Manager';
      wb.lastModifiedBy = 'System';
      wb.created = new Date();
      wb.modified = new Date();

      const w = currentWorkerProfile;

      // ==========================================
      // Sheet 1: Worker Details
      // ==========================================
      const wsDetails = wb.addWorksheet('Sheet 1');

      wsDetails.columns = [
        { header: 'Field', key: 'field', width: 25 },
        { header: 'Value', key: 'value', width: 40 }
      ];

      // We don't want standard headers for the simple layout
      wsDetails.getRow(1).values = ['WORKER DETAILS'];
      wsDetails.getRow(1).font = { bold: true, size: 14 };

      wsDetails.addRow([]); // empty row

      const detailsRows = [
        ["FIN / NRIC Number", w.fin_number || ''],
        ["Work Permit No", w.work_permit_no || ''],
        ["Worker Name", w.worker_name || ''],
        ["Date of Birth", w.date_of_birth || ''],
        ["Nationality", w.nationality || ''],
        ["Sex", w.sex || ''],
        ["Race", w.race || ''],
        ["Country/Place of Birth", w.country_of_birth || ''],
        ["Address", w.address || ''],
        ["Employer", w.employer_name || ''],
        ["WP Expiry Date", w.wp_expiry_date || ''],
        ["Created", w.created_at ? formatDate(w.created_at) : '']
      ];

      detailsRows.forEach(row => wsDetails.addRow(row));

      // Style details
      wsDetails.eachRow((row, rowNumber) => {
        if (rowNumber > 2) {
          row.getCell(1).font = { bold: true };
          row.getCell(1).alignment = { vertical: 'middle' };
          row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
        }
      });

      // ==========================================
      // Sheet 2+: Certifications (chunks of 8)
      // ==========================================
      const certs = w.certifications || [];
      let lastSheetIndex = 2;

      if (certs.length === 0) {
        const wsEmptyCerts = wb.addWorksheet('Sheet 2');
        wsEmptyCerts.addRow(['No certifications found.']);
      } else {
        for (let i = 0; i < certs.length; i += 8) {
          const chunk = certs.slice(i, i + 8);
          lastSheetIndex = Math.floor(i / 8) + 2;
          const wsCerts = wb.addWorksheet(`Sheet ${lastSheetIndex}`);

          wsCerts.columns = [
            { header: 'COURSE', key: 'course', width: 45 },
            { header: 'PROVIDER', key: 'provider', width: 30 },
            { header: 'S/N', key: 'sn', width: 20 },
            { header: 'DURATION', key: 'duration', width: 15 },
            { header: 'ISSUE', key: 'issue', width: 15 },
            { header: 'EXPIRY', key: 'expiry', width: 15 }
          ];

          wsCerts.insertRow(1, ['CERTIFICATIONS']);
          wsCerts.getRow(1).font = { bold: true, size: 14 };
          wsCerts.insertRow(2, []); // empty row

          // Re-apply headers visually on row 3 since we pushed them down
          const headerRow = wsCerts.getRow(3);
          headerRow.values = ['COURSE', 'PROVIDER', 'S/N', 'DURATION', 'ISSUE', 'EXPIRY'];
          headerRow.font = { bold: true };
          headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

          chunk.forEach(c => {
            wsCerts.addRow([
              c.course_title || '',
              c.course_provider || '',
              c.cert_serial_no || '',
              c.course_duration || '',
              c.issue_date || '',
              c.expiry_date || ''
            ]);
          });

          // Wrap text on cert sheets
          wsCerts.eachRow((row) => {
            row.alignment = { vertical: 'middle', wrapText: true };
          });
        }
      }

      // ==========================================
      // Final Sheets: Embedded Scanned Docs (chunks of 8)
      // ==========================================
      const docs = w.documents || [];
      exportBtn.innerHTML = `Fetching ${docs.length} Scans...`;

      // Pre-download all images into ArrayBuffers
      const downloadedImages = [];
      for (const d of docs) {
        const docUrl = API.getFileUrl(d.r2_key) || d.url;
        if (!docUrl) continue;

        try {
          const response = await fetch(docUrl);
          if (!response.ok) continue;

          const blob = await response.blob();

          // Silently skip PDFs or unsupported documents that cannot be drawn directly to an image canvas
          if (blob.type.includes('pdf') || blob.type.includes('word') || blob.type.includes('document')) {
            console.log(`Skipping non-image document embed for ${docUrl}`);
            continue;
          }

          const objectUrl = URL.createObjectURL(blob);

          const compressedImg = await new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous'; // Required to draw external R2 URLs to canvas
            img.onload = () => {
              URL.revokeObjectURL(objectUrl);
              const canvas = document.createElement('canvas');
              let width = img.width;
              let height = img.height;
              const maxWidth = 800; // Lower resolution to scale to excel nicely
              const maxHeight = 800;

              if (width > height) {
                if (width > maxWidth) {
                  height = Math.round((height * maxWidth) / width);
                  width = maxWidth;
                }
              } else {
                if (height > maxHeight) {
                  width = Math.round((width * maxHeight) / height);
                  height = maxHeight;
                }
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');

              // Fill solid white background (stops transparent PNGs turning black in Excel)
              ctx.fillStyle = "#FFFFFF";
              ctx.fillRect(0, 0, width, height);

              ctx.drawImage(img, 0, 0, width, height);

              // Compress slightly as standard JPEG
              const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
              if (dataUrl.length < 100) {
                reject(new Error('Canvas generated empty image data'));
                return;
              }
              resolve({ base64: dataUrl, extension: 'jpeg' });
            };
            img.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              reject(new Error('Image failed to load in canvas'));
            };
            img.src = objectUrl;
          });

          // Add standardized, compressed image to workbook registry
          const imageId = wb.addImage({
            base64: compressedImg.base64,
            extension: compressedImg.extension,
          });

          downloadedImages.push(imageId);
        } catch (e) {
          console.warn(`Failed to fetch and compress doc: ${docUrl}`, e);
        }
      }

      if (downloadedImages.length === 0) {
        // No images
        const wsDocs = wb.addWorksheet(`Sheet ${lastSheetIndex + 1}`);
        wsDocs.addRow(['No scanned documents found.']);
      } else {
        // We have images, chunk them by 8 per sheet
        // Use exact dimensions requested: Width 4.02", Height 2.5"
        // ExcelJS uses standard pixels (96 DPI).
        // 4.02 inches * 96 = 386px width
        // 2.5 inches * 96 = 240px height
        const IMG_WIDTH = 386;
        const IMG_HEIGHT = 240;
        // ExcelJS row height is in points (72 points per inch).
        // 2.5 inches * 72 = 180 points height. Add a small 10pt margin.
        const ROW_HEIGHT = 190;

        for (let i = 0; i < downloadedImages.length; i += 8) {
          const chunkImages = downloadedImages.slice(i, i + 8);
          lastSheetIndex++;
          const wsDocs = wb.addWorksheet(`Sheet ${lastSheetIndex}`);

          wsDocs.columns = [{ width: 55 }]; // Sized proportionally to fit 4.02 inches

          chunkImages.forEach((imgId, index) => {
            // Add a row specifically sized for this image
            const rowNo = index + 1; // 1-based index 
            const row = wsDocs.getRow(rowNo);
            row.height = ROW_HEIGHT;

            // Add image over the cell
            wsDocs.addImage(imgId, {
              tl: { col: 0, row: rowNo - 1 }, // tl is 0-indexed
              ext: { width: IMG_WIDTH, height: IMG_HEIGHT },
              editAs: 'oneCell'
            });
          });
        }
      }

      // ==========================================
      // Trigger Download
      // ==========================================
      exportBtn.innerHTML = `Saving...`;
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      const fileName = `${w.worker_name.replace(/[^a-z0-9]/gi, '_')}_${w.fin_number}_Profile.xlsx`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Profile exported successfully', 'success');

    } catch (err) {
      console.error(err);
      showToast('Export failed: ' + err.message, 'error');
    } finally {
      exportBtn.innerHTML = originalText;
      exportBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  // CERTIFICATIONS LIST
  // ═══════════════════════════════════════════════════════
  async function loadCertifications() {
    const tbody = document.getElementById('certs-tbody');
    if (!tbody) return;

    try {
      const result = await API.listCertifications({ page: certsPage, limit: 20 });
      const certs = result.data || [];

      if (certs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="empty-state">No certifications found</td></tr>';
      } else {
        tbody.innerHTML = certs.map(c => `
                    <tr>
                        <td>${esc(c.worker_name || '—')}</td>
                        <td>${esc(c.fin_number || '—')}</td>
                        <td>${esc(c.course_title)}</td>
                        <td>${esc(c.course_provider || '—')}</td>
                        <td>${esc(c.cert_serial_no || '—')}</td>
                        <td>${esc(c.course_duration || '—')}</td>
                        <td>${formatDate(c.issue_date)}</td>
                        <td>${expiryBadge(c.expiry_date)}</td>
                        <td>
                            <div class="action-btns">
                                <button class="action-btn action-btn--danger" title="Delete" onclick="deleteCertConfirm(${c.id},'${esc(c.course_title)}')">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                `).join('');
      }

      renderPagination('certs-pagination', result.pagination, (p) => { certsPage = p; loadCertifications(); });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Error: ${esc(err.message)}</td></tr>`;
    }
  }

  // ═══════════════════════════════════════════════════════
  // OCR UPLOAD FLOW
  // ═══════════════════════════════════════════════════════
  function initOCRUpload() {
    const zone = document.getElementById('ocr-upload-zone');
    const fileInput = document.getElementById('ocr-file-input');
    const removeAllBtn = document.getElementById('ocr-remove-all');
    const runBtn = document.getElementById('btn-run-ocr');
    const backBtn = document.getElementById('btn-ocr-back');
    const saveBtn = document.getElementById('btn-ocr-save');
    const toggleRaw = document.getElementById('btn-toggle-raw');

    // Click to upload
    zone?.addEventListener('click', () => fileInput?.click());

    // Drag and drop (accept multiple)
    zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone?.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleOCRFiles(Array.from(e.dataTransfer.files));
    });

    fileInput?.addEventListener('change', (e) => {
      handleOCRFiles(Array.from(e.target.files));
      e.target.value = ''; // reset so same file can be re-selected
    });

    removeAllBtn?.addEventListener('click', resetOCR);
    runBtn?.addEventListener('click', runOCR);
    backBtn?.addEventListener('click', () => {
      document.getElementById('upload-step-2').hidden = true;
      document.getElementById('upload-step-1').hidden = false;
    });
    saveBtn?.addEventListener('click', saveOCRResult);

    toggleRaw?.addEventListener('click', () => {
      const el = document.getElementById('ocr-raw-text');
      if (el) {
        el.hidden = !el.hidden;
        toggleRaw.textContent = el.hidden ? 'Show Raw OCR Text' : 'Hide Raw OCR Text';
      }
    });
  }

  function handleOCRFiles(files) {
    for (const file of files) {
      if (ocrFiles.length >= 4) {
        showToast('Maximum 4 files allowed', 'error');
        break;
      }
      const isImage = file.type.startsWith('image/');
      const isPDF = file.type === 'application/pdf';
      if (!isImage && !isPDF) {
        showToast(`"${file.name}" is not an image or PDF — skipped`, 'error');
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast(`"${file.name}" exceeds 10MB — skipped`, 'error');
        continue;
      }
      ocrFiles.push(file);
    }
    renderOCRThumbnails();
  }

  function renderOCRThumbnails() {
    const grid = document.getElementById('ocr-thumbnails-grid');
    const preview = document.getElementById('ocr-preview-container');
    const zone = document.getElementById('ocr-upload-zone');
    const runBtn = document.getElementById('btn-run-ocr');

    if (!grid) return;
    grid.innerHTML = '';

    if (ocrFiles.length === 0) {
      if (preview) preview.hidden = true;
      if (zone) zone.style.display = '';
      if (runBtn) runBtn.disabled = true;
      return;
    }

    if (preview) preview.hidden = false;
    if (zone) zone.style.display = 'none';
    if (runBtn) runBtn.disabled = false;

    ocrFiles.forEach((file, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'ocr-thumb';

      if (file.type === 'application/pdf') {
        // PDF: show an icon instead of image preview
        const pdfIcon = document.createElement('div');
        pdfIcon.className = 'ocr-thumb-pdf';
        pdfIcon.innerHTML = `<svg width="40" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span>PDF</span>`;
        thumb.appendChild(pdfIcon);
      } else {
        const img = document.createElement('img');
        img.alt = file.name;
        const reader = new FileReader();
        reader.onload = (e) => { img.src = e.target.result; };
        reader.readAsDataURL(file);
        thumb.appendChild(img);
      }

      const label = document.createElement('div');
      label.className = 'ocr-thumb-label';
      label.textContent = `File ${idx + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'ocr-thumb-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove this file';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        ocrFiles.splice(idx, 1);
        renderOCRThumbnails();
      });

      thumb.append(label, removeBtn);
      grid.appendChild(thumb);
    });
  }

  function resetOCR() {
    ocrFiles = [];
    ocrResult = null;

    const preview = document.getElementById('ocr-preview-container');
    const zone = document.getElementById('ocr-upload-zone');
    const step1 = document.getElementById('upload-step-1');
    const step2 = document.getElementById('upload-step-2');
    const runBtn = document.getElementById('btn-run-ocr');
    const progress = document.getElementById('ocr-progress');
    const fileInput = document.getElementById('ocr-file-input');
    const grid = document.getElementById('ocr-thumbnails-grid');

    if (preview) preview.hidden = true;
    if (zone) zone.style.display = '';
    if (step1) step1.hidden = false;
    if (step2) step2.hidden = true;
    if (runBtn) runBtn.disabled = true;
    if (progress) progress.hidden = true;
    if (fileInput) fileInput.value = '';
    if (grid) grid.innerHTML = '';
  }

  async function runOCR() {
    if (ocrFiles.length === 0) return;

    const runBtn = document.getElementById('btn-run-ocr');
    const progress = document.getElementById('ocr-progress');
    const progressFill = document.getElementById('ocr-progress-fill');
    const progressText = document.getElementById('ocr-progress-text');

    if (runBtn) runBtn.disabled = true;
    if (progress) progress.hidden = false;

    try {
      const docType = document.getElementById('ocr-doc-type')?.value || 'auto';
      const totalFiles = ocrFiles.length;
      const merged = {};
      let allRawText = '';

      // Process each image
      for (let i = 0; i < totalFiles; i++) {
        const pct = Math.round(((i) / totalFiles) * 80 + 10);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Processing image ${i + 1} of ${totalFiles}...`;

        const result = await API.processOCR(ocrFiles[i], docType);
        const ext = result.extracted || {};

        // Accumulate raw text
        allRawText += `── Image ${i + 1} ──\n${result.raw_text || '(no text)'}\n\n`;

        // Merge: later values fill in blanks (don't overwrite existing values)
        for (const [key, value] of Object.entries(ext)) {
          if (value && !merged[key]) {
            merged[key] = value;
          }
        }
      }

      ocrResult = { extracted: merged, raw_text: allRawText };

      if (progressFill) progressFill.style.width = '100%';
      if (progressText) progressText.textContent = `Done! Processed ${totalFiles} image${totalFiles > 1 ? 's' : ''}.`;

      // Populate OCR fields with merged data
      setInputValue('ocr-fin', merged.fin_number || '');
      setInputValue('ocr-wp-no', merged.work_permit_no || '');
      setInputValue('ocr-wp-expiry', merged.wp_expiry_date || '');
      setInputValue('ocr-name', merged.worker_name || '');
      setInputValue('ocr-dob', merged.date_of_birth || '');
      setInputValue('ocr-nationality', merged.nationality || '');
      setInputValue('ocr-sex', merged.sex || '');
      setInputValue('ocr-race', merged.race || '');
      setInputValue('ocr-country-birth', merged.country_of_birth || '');
      setInputValue('ocr-address', merged.address || '');
      setInputValue('ocr-employer', merged.employer_name || '');
      setInputValue('ocr-course', merged.course_title || '');
      setInputValue('ocr-provider', merged.course_provider || '');
      setInputValue('ocr-cert-sn', merged.cert_serial_no || '');
      setInputValue('ocr-duration', merged.course_duration || '');
      setInputValue('ocr-issue-date', merged.issue_date || '');
      setInputValue('ocr-expiry-date', merged.expiry_date || '');

      // Show raw text
      const rawTextEl = document.getElementById('ocr-raw-text');
      if (rawTextEl) rawTextEl.textContent = allRawText.trim();

      // Show step 2
      setTimeout(() => {
        document.getElementById('upload-step-1').hidden = true;
        document.getElementById('upload-step-2').hidden = false;
        showToast(`OCR complete — ${totalFiles} image${totalFiles > 1 ? 's' : ''} processed and merged.`, 'success');
      }, 500);

    } catch (err) {
      showToast('OCR failed: ' + err.message, 'error');
      if (runBtn) runBtn.disabled = false;
      if (progress) progress.hidden = true;
    }
  }

  async function saveOCRResult() {
    const fin = document.getElementById('ocr-fin')?.value?.trim();
    const name = document.getElementById('ocr-name')?.value?.trim();

    if (!fin || !name) {
      showToast('FIN Number and Worker Name are required', 'error');
      return;
    }

    const saveBtn = document.getElementById('btn-ocr-save');
    if (saveBtn) saveBtn.disabled = true;

    try {
      // Step 1: Create/update worker
      const workerData = {
        fin_number: fin,
        work_permit_no: document.getElementById('ocr-wp-no')?.value?.trim() || null,
        worker_name: name,
        date_of_birth: document.getElementById('ocr-dob')?.value || null,
        nationality: document.getElementById('ocr-nationality')?.value || null,
        sex: document.getElementById('ocr-sex')?.value || null,
        race: document.getElementById('ocr-race')?.value?.trim() || null,
        country_of_birth: document.getElementById('ocr-country-birth')?.value?.trim() || null,
        address: document.getElementById('ocr-address')?.value?.trim() || null,
        employer_name: document.getElementById('ocr-employer')?.value || null,
        wp_expiry_date: document.getElementById('ocr-wp-expiry')?.value || null,
      };

      const worker = await API.createWorker(workerData);
      showToast(`Worker ${worker.worker_name} saved!`, 'success');

      // Step 2: Upload all documents to R2 linked to this worker
      if (ocrFiles.length > 0) {
        const docType = document.getElementById('ocr-doc-type')?.value || 'other';
        for (let i = 0; i < ocrFiles.length; i++) {
          try {
            await API.uploadWorkerDocument(ocrFiles[i], fin, docType);
          } catch (err) {
            showToast(`Upload failed for image ${i + 1}: ${err.message}`, 'error');
          }
        }
        showToast(`${ocrFiles.length} document${ocrFiles.length > 1 ? 's' : ''} uploaded to R2`, 'success');
      }

      // Step 3: Create certification if course info provided
      const courseTitle = document.getElementById('ocr-course')?.value?.trim();
      if (courseTitle) {
        try {
          await API.createCertification({
            fin_number: fin,
            course_title: courseTitle,
            course_provider: document.getElementById('ocr-provider')?.value?.trim() || null,
            cert_serial_no: document.getElementById('ocr-cert-sn')?.value?.trim() || null,
            course_duration: document.getElementById('ocr-duration')?.value?.trim() || null,
            issue_date: document.getElementById('ocr-issue-date')?.value || null,
            expiry_date: document.getElementById('ocr-expiry-date')?.value || null,
          });
          showToast('Certification saved!', 'success');
        } catch (err) {
          showToast('Certification save failed: ' + err.message, 'error');
        }
      }

      // Reset and go to worker profile
      resetOCR();
      Router.navigate('worker-profile', worker.id);

    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  // MODALS
  // ═══════════════════════════════════════════════════════
  function showAddWorkerModal() {
    openModal('Add Worker', `
            <div class="form-row">
                <div class="form-group"><label for="modal-fin">FIN Number *</label><input type="text" id="modal-fin" class="form-control" placeholder="e.g. G1234567A"></div>
                <div class="form-group"><label for="modal-wp-no">Work Permit No</label><input type="text" id="modal-wp-no" class="form-control" placeholder="e.g. 034773262"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label for="modal-name">Worker Name *</label><input type="text" id="modal-name" class="form-control" placeholder="Full name"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label for="modal-dob">Date of Birth</label><input type="date" id="modal-dob" class="form-control"></div>
                <div class="form-group"><label for="modal-nat">Nationality</label><input type="text" id="modal-nat" class="form-control" placeholder="e.g. INDIAN"></div>
            </div>
            <div class="form-row">
                <div class="form-group"><label for="modal-sex">Sex</label><select id="modal-sex" class="form-control"><option value="">—</option><option value="M">Male</option><option value="F">Female</option></select></div>
                <div class="form-group"><label for="modal-employer">Employer</label><input type="text" id="modal-employer" class="form-control" placeholder="Company name"></div>
            </div>
        `, `
            <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="btn btn-primary" id="modal-save-worker">Save Worker</button>
        `);

    document.getElementById('modal-save-worker')?.addEventListener('click', async () => {
      const fin = document.getElementById('modal-fin')?.value?.trim();
      const name = document.getElementById('modal-name')?.value?.trim();
      if (!fin || !name) { showToast('FIN and Name are required', 'error'); return; }

      try {
        await API.createWorker({
          fin_number: fin,
          work_permit_no: document.getElementById('modal-wp-no')?.value?.trim() || null,
          worker_name: name,
          date_of_birth: document.getElementById('modal-dob')?.value || null,
          nationality: document.getElementById('modal-nat')?.value || null,
          sex: document.getElementById('modal-sex')?.value || null,
          employer_name: document.getElementById('modal-employer')?.value || null,
        });
        showToast('Worker saved!', 'success');
        closeModal();
        loadWorkers();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  function showAddCertModal(workerId = null, finNumber = null) {
    openModal('Add Certification', `
            <div class="form-group">
                <label for="modal-cert-fin">FIN Number *</label>
                <input type="text" id="modal-cert-fin" class="form-control" placeholder="G1234567A" value="${esc(finNumber || '')}">
            </div>
            <div class="form-group">
                <label for="modal-cert-title">Course Title *</label>
                <input type="text" id="modal-cert-title" class="form-control" placeholder="e.g. Work-At-Height Rescue Course (WAHRC)">
            </div>
            <div class="form-row">
                <div class="form-group"><label for="modal-cert-provider">Course Provider</label><input type="text" id="modal-cert-provider" class="form-control" placeholder="e.g. Avanta Global"></div>
                <div class="form-group"><label for="modal-cert-sn">Course S/N</label><input type="text" id="modal-cert-sn" class="form-control" placeholder="e.g. WAHRC-2025-B134P-659"></div>
            </div>
            <div class="form-group">
                <label for="modal-cert-duration">Duration</label><input type="text" id="modal-cert-duration" class="form-control" placeholder="e.g. 18 Hours">
            </div>
            <div class="form-row">
                <div class="form-group"><label for="modal-cert-issue">Issue Date</label><input type="date" id="modal-cert-issue" class="form-control"></div>
                <div class="form-group"><label for="modal-cert-expiry">Expiry Date</label><input type="date" id="modal-cert-expiry" class="form-control"></div>
            </div>
        `, `
            <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
            <button class="btn btn-primary" id="modal-save-cert">Save Certification</button>
        `);

    document.getElementById('modal-save-cert')?.addEventListener('click', async () => {
      const fin = document.getElementById('modal-cert-fin')?.value?.trim();
      const title = document.getElementById('modal-cert-title')?.value?.trim();
      if (!fin || !title) { showToast('FIN and Course Title required', 'error'); return; }

      try {
        await API.createCertification({
          worker_id: workerId,
          fin_number: fin,
          course_title: title,
          course_provider: document.getElementById('modal-cert-provider')?.value?.trim() || null,
          cert_serial_no: document.getElementById('modal-cert-sn')?.value?.trim() || null,
          course_duration: document.getElementById('modal-cert-duration')?.value?.trim() || null,
          issue_date: document.getElementById('modal-cert-issue')?.value || null,
          expiry_date: document.getElementById('modal-cert-expiry')?.value || null,
        });
        showToast('Certification saved!', 'success');
        closeModal();
        loadCertifications();
        if (currentWorkerProfile && currentWorkerProfile.id) loadWorkerProfile(currentWorkerProfile.id);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  }

  function openModal(title, bodyHTML, footerHTML) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    document.getElementById('modal-footer').innerHTML = footerHTML;
    document.getElementById('modal-overlay').hidden = false;
  }

  function closeModal() {
    document.getElementById('modal-overlay').hidden = true;
  }

  // ═══════════════════════════════════════════════════════
  // DELETE CONFIRMATIONS (global)
  // ═══════════════════════════════════════════════════════
  window.deleteWorkerConfirm = (id, name) => {
    if (confirm(`Delete worker "${name}"? This will remove all associated certifications and documents.`)) {
      API.deleteWorker(id).then(() => {
        showToast('Worker deleted', 'success');
        loadWorkers();
      }).catch(err => showToast('Error: ' + err.message, 'error'));
    }
  };

  window.deleteCertConfirm = (id, title) => {
    if (confirm(`Delete certification "${title}"?`)) {
      API.deleteCertification(id).then(() => {
        showToast('Certification deleted', 'success');
        loadCertifications();
      }).catch(err => showToast('Error: ' + err.message, 'error'));
    }
  };

  // ═══════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════
  function esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str).toUpperCase();
    return div.innerHTML;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function setInputValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }

  function formatDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return '—';
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return dateStr;
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}/${month}/${year}`;
    } catch { return dateStr; }
  }

  function expiryBadge(dateStr) {
    if (!dateStr) return '<span class="badge">—</span>';
    const now = new Date();
    const expiry = new Date(dateStr);
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) return `<span class="badge badge--expired">${esc(dateStr)} (EXPIRED)</span>`;
    if (daysLeft <= 90) return `<span class="badge badge--expiring">${esc(dateStr)} (${daysLeft}d)</span>`;
    return `<span class="badge badge--valid">${esc(dateStr)}</span>`;
  }

  function renderPagination(containerId, pagination, onPageClick) {
    const container = document.getElementById(containerId);
    if (!container || !pagination) return;

    const { page, total_pages } = pagination;
    if (total_pages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    html += `<button ${page <= 1 ? 'disabled' : ''} onclick="return false">‹</button>`;
    for (let i = 1; i <= total_pages && i <= 10; i++) {
      html += `<button class="${i === page ? 'active' : ''}" onclick="return false">${i}</button>`;
    }
    html += `<button ${page >= total_pages ? 'disabled' : ''} onclick="return false">›</button>`;
    container.innerHTML = html;

    container.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.textContent;
        if (text === '‹') onPageClick(page - 1);
        else if (text === '›') onPageClick(page + 1);
        else onPageClick(parseInt(text, 10));
      });
    });
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `
            <span>${esc(message)}</span>
            <button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>
        `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  // ─── Public API ─────────────────────────────────────────
  return {
    init,
    onPageChange,
    closeModal,
  };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.init);
