/**
 * Google Sheets Sync Module
 * Syncs worker and certification data to Google Sheets.
 * Uses FIN Number as unique identifier — updates existing rows, prevents duplicates.
 *
 * Required env secrets:
 *   GOOGLE_SHEETS_API_KEY — Google Sheets API key
 *   GOOGLE_SHEET_ID       — ID of the target spreadsheet
 */

/**
 * Sync a worker record to Google Sheets.
 * Updates existing row if FIN exists, otherwise appends new row.
 */
export async function syncWorkerToSheet(env, worker) {
    const apiKey = env.GOOGLE_SHEETS_API_KEY;
    const sheetId = env.GOOGLE_SHEET_ID;

    if (!apiKey || !sheetId) {
        console.log('Google Sheets sync skipped: API key or Sheet ID not configured');
        return;
    }

    const sheetName = 'Workers';

    try {
        // Step 1: Read existing data to find if FIN exists
        const existingData = await readSheet(apiKey, sheetId, `${sheetName}!A:H`);
        const rows = existingData.values || [];

        // Find row index of existing FIN
        let existingRowIndex = -1;
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] && rows[i][0].toUpperCase() === worker.fin_number.toUpperCase()) {
                existingRowIndex = i + 1; // 1-indexed for Sheets API
                break;
            }
        }

        const rowData = [
            worker.fin_number || '',
            worker.worker_name || '',
            worker.date_of_birth || '',
            worker.nationality || '',
            worker.sex || '',
            worker.employer_name || '',
            worker.created_at || '',
            new Date().toISOString(), // last_synced
        ];

        if (existingRowIndex > 0) {
            // Update existing row
            await updateSheet(apiKey, sheetId, `${sheetName}!A${existingRowIndex}:H${existingRowIndex}`, [rowData]);
            console.log(`Google Sheets: Updated worker ${worker.fin_number} at row ${existingRowIndex}`);
        } else {
            // Ensure header exists
            if (rows.length === 0) {
                await appendSheet(apiKey, sheetId, `${sheetName}!A:H`, [
                    ['FIN Number', 'Worker Name', 'Date of Birth', 'Nationality', 'Sex', 'Employer', 'Created At', 'Last Synced']
                ]);
            }
            // Append new row
            await appendSheet(apiKey, sheetId, `${sheetName}!A:H`, [rowData]);
            console.log(`Google Sheets: Added new worker ${worker.fin_number}`);
        }
    } catch (err) {
        console.error('Google Sheets sync error:', err.message);
        // Don't throw — sync is non-critical
    }
}

/**
 * Sync a certification record to Google Sheets.
 */
export async function syncCertificationToSheet(env, worker, cert) {
    const apiKey = env.GOOGLE_SHEETS_API_KEY;
    const sheetId = env.GOOGLE_SHEET_ID;

    if (!apiKey || !sheetId) {
        console.log('Google Sheets cert sync skipped: not configured');
        return;
    }

    const sheetName = 'Certifications';

    try {
        const existingData = await readSheet(apiKey, sheetId, `${sheetName}!A:G`);
        const rows = existingData.values || [];

        const rowData = [
            worker?.fin_number || '',
            worker?.worker_name || '',
            cert.course_title || '',
            cert.course_provider || '',
            cert.issue_date || '',
            cert.expiry_date || '',
            new Date().toISOString(),
        ];

        // Ensure header
        if (rows.length === 0) {
            await appendSheet(apiKey, sheetId, `${sheetName}!A:G`, [
                ['FIN Number', 'Worker Name', 'Course Title', 'Course Provider', 'Issue Date', 'Expiry Date', 'Last Synced']
            ]);
        }

        // Append (certifications can have multiples per worker)
        await appendSheet(apiKey, sheetId, `${sheetName}!A:G`, [rowData]);
        console.log(`Google Sheets: Added certification for ${worker?.fin_number}`);
    } catch (err) {
        console.error('Google Sheets cert sync error:', err.message);
    }
}

// ─── Google Sheets API Helpers ────────────────────────────

async function readSheet(apiKey, sheetId, range) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets read failed: ${err}`);
    }
    return res.json();
}

async function updateSheet(apiKey, sheetId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED&key=${apiKey}`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets update failed: ${err}`);
    }
    return res.json();
}

async function appendSheet(apiKey, sheetId, range, values) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&key=${apiKey}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Sheets append failed: ${err}`);
    }
    return res.json();
}
