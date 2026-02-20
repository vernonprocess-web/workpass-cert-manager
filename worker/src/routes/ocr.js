/**
 * OCR Route Handler
 * Sends uploaded images to Google Cloud Vision API and extracts structured data.
 *
 * POST /api/ocr/process — Accept an image, run OCR, return structured fields
 */

import { jsonResponse, errorResponse } from '../utils/response.js';

export async function handleOCR(request, env, path) {
    if (path === '/api/ocr/process' && request.method === 'POST') {
        return processOCR(request, env);
    }

    return errorResponse('Not Found', 404);
}

/**
 * Process an uploaded image through Google Cloud Vision API.
 * Accepts multipart/form-data with a 'file' field (image).
 * Returns structured worker/certification data extracted from the OCR text.
 */
async function processOCR(request, env) {
    const apiKey = env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
        return errorResponse('Google Vision API key not configured. Set GOOGLE_VISION_API_KEY secret.', 500);
    }

    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.includes('multipart/form-data')) {
        return errorResponse('Content-Type must be multipart/form-data', 400);
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const documentType = formData.get('document_type') || 'auto';

    if (!file || !(file instanceof File)) {
        return errorResponse('No file provided', 400);
    }

    // Validate image type
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
    if (!imageTypes.includes(file.type)) {
        return errorResponse('File must be an image (JPEG, PNG, WebP, GIF, BMP, TIFF)', 400);
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = arrayBufferToBase64(arrayBuffer);

    // Call Google Cloud Vision API
    const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const visionPayload = {
        requests: [
            {
                image: { content: base64Image },
                features: [
                    { type: 'TEXT_DETECTION', maxResults: 1 },
                ],
            },
        ],
    };

    const visionResponse = await fetch(visionUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visionPayload),
    });

    if (!visionResponse.ok) {
        const errText = await visionResponse.text();
        console.error('Google Vision API error:', errText);
        return errorResponse('Google Vision API request failed', 502);
    }

    const visionResult = await visionResponse.json();

    // Extract raw text
    const annotations = visionResult.responses?.[0]?.textAnnotations;
    if (!annotations || annotations.length === 0) {
        return jsonResponse({
            success: true,
            raw_text: '',
            extracted: {},
            message: 'No text detected in image',
        });
    }

    const rawText = annotations[0].description || '';

    // Parse structured fields from raw OCR text
    const extracted = parseOCRText(rawText, documentType);

    return jsonResponse({
        success: true,
        raw_text: rawText,
        extracted,
        document_type: documentType,
    });
}

/**
 * Parse structured fields from raw OCR text.
 * Handles Singapore Work Permits, Visit Passes, and Certifications.
 *
 * Singapore Work Permit (Front) typical layout:
 *   WORK PERMIT
 *   Employer: COMPANY NAME PTE. LTD.
 *   Name: WORKER FULL NAME
 *   Work Permit No: 034773262    Sector: CONSTRUCTION
 *
 * Singapore Visit Pass / Back of WP typical layout:
 *   VISIT PASS
 *   Name: WORKER FULL NAME
 *   FIN: G6550858W
 *   Date of Birth: 16-06-1988    Sex: M
 *   Nationality: INDIAN
 *
 * FIN format: F/G/M + 7 digits + letter (e.g. G6550858W)
 *   F = issued before 2000
 *   G = issued 2000–2021
 *   M = issued from 2022 onwards
 */
function parseOCRText(rawText, documentType) {
    const text = rawText.toUpperCase();
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const upperLines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        worker_name: null,
        fin_number: null,
        work_permit_no: null,
        date_of_birth: null,
        nationality: null,
        sex: null,
        employer_name: null,
        course_title: null,
        course_provider: null,
        cert_serial_no: null,
        issue_date: null,
        expiry_date: null,
    };

    // Detect document type
    const isWorkPermit = documentType === 'work_permit' ||
        text.includes('WORK PERMIT') ||
        text.includes('EMPLOYMENT OF FOREIGN MANPOWER');

    const isCertification = documentType === 'certification' ||
        text.includes('COURSE DATE') ||
        text.includes('COURSE VENUE') ||
        text.includes('CERTIFICATE') ||
        text.includes('CERTIFICATION') ||
        text.includes('TRAINING') ||
        text.includes('VALIDITY');

    // ═══════════════════════════════════════════════════════════
    // 1. FIN NUMBER (the unique identifier)
    //    Singapore FIN: F, G, or M + 7 digits + check letter
    //    F = issued before 2000
    //    G = issued 2000–2021
    //    M = issued from 2022 onwards
    // ═══════════════════════════════════════════════════════════
    // First try labeled "FIN" or "ID NO" pattern
    const finLabelMatch = text.match(/(?:FIN|ID\s*NO\.?)\s*[:\-]?\s*([FGM]\d{7}[A-Z])/);
    if (finLabelMatch) {
        result.fin_number = finLabelMatch[1];
    } else {
        // Scan for any FIN-format string in the text
        const finMatch = text.match(/\b([FGM]\d{7}[A-Z])\b/);
        if (finMatch) {
            result.fin_number = finMatch[1];
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 2. WORK PERMIT NUMBER (separate from FIN)
    //    Typically 8-9 digits, printed with spaces like "0 34773262"
    //    Found on the front of the Work Permit card
    // ═══════════════════════════════════════════════════════════
    const wpPatterns = [
        /WORK\s*PERMIT\s*NO\.?\s*:?\s*(\d[\d\s]{6,})/i,
        /WP\s*NO\.?\s*:?\s*(\d[\d\s]{6,})/i,
        /PERMIT\s*NO\.?\s*:?\s*(\d[\d\s]{6,})/i,
    ];

    for (const pattern of wpPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.work_permit_no = match[1].replace(/\s+/g, '').trim();
            break;
        }
    }

    // If "Work Permit No" label found but number is on the next line
    if (!result.work_permit_no) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/WORK\s*PERMIT\s*NO/)) {
                const sameLine = upperLines[i].match(/WORK\s*PERMIT\s*NO\.?\s*:?\s*(\d[\d\s]+)/);
                if (sameLine) {
                    result.work_permit_no = sameLine[1].replace(/\s+/g, '').trim();
                } else if (i + 1 < upperLines.length) {
                    const nextLine = upperLines[i + 1].trim();
                    const numMatch = nextLine.match(/^(\d[\d\s]{5,})/);
                    if (numMatch) {
                        result.work_permit_no = numMatch[1].replace(/\s+/g, '').trim();
                    }
                }
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 3. WORKER NAME — line-by-line approach
    //    Look for "Name" label and take the text on the next
    //    line(s) that looks like a person name (all letters)
    // ═══════════════════════════════════════════════════════════
    for (let i = 0; i < upperLines.length; i++) {
        const line = upperLines[i];

        // Skip lines that contain "NAME" as part of another label
        if (line.match(/^NAME\s*$/i) ||
            line.match(/^NAME\s*[:\-]/i) ||
            line.match(/^NAME\s+OF\s+(WORKER|HOLDER)/i)) {

            // The name might be on the same line after the label
            const sameLineMatch = line.match(/^NAME\s*(?:OF\s+(?:WORKER|HOLDER))?\s*[:\-]?\s+([A-Z][A-Z\s.'-]{2,})/);
            if (sameLineMatch) {
                const candidate = cleanName(sameLineMatch[1]);
                if (isValidName(candidate)) {
                    result.worker_name = candidate;
                    break;
                }
            }

            // Otherwise, look at the following lines
            for (let j = i + 1; j < Math.min(i + 4, upperLines.length); j++) {
                const nextLine = upperLines[j].trim();
                // Skip FIN-like numbers, empty lines, and labels
                if (nextLine.match(/^[A-Z]\d{7}[A-Z]$/)) continue; // FIN number
                if (nextLine.match(/^\d+$/)) continue; // just numbers
                if (nextLine.match(/^(WORK\s*PERMIT|SECTOR|DOB|DATE|SEX|EMPLOYER|NATIONALITY)/)) break;

                // This line should be the name — all uppercase letters, spaces, dots, hyphens
                if (nextLine.match(/^[A-Z][A-Z\s.'\-\/]{2,}$/) && !nextLine.match(/PTE|LTD|SDN|BHD|CORP|INC|COMPANY/)) {
                    const candidate = cleanName(nextLine);
                    if (isValidName(candidate)) {
                        result.worker_name = candidate;
                        break;
                    }
                }
            }
            break;
        }
    }

    // Fallback: look for "NAME" with inline value
    if (!result.worker_name) {
        const nameInline = text.match(/NAME\s*[:\-]\s*([A-Z][A-Z\s.'\-]{2,})/);
        if (nameInline) {
            const candidate = cleanName(nameInline[1]);
            if (isValidName(candidate)) {
                result.worker_name = candidate;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 4. EMPLOYER — line-by-line approach
    // ═══════════════════════════════════════════════════════════
    for (let i = 0; i < upperLines.length; i++) {
        if (upperLines[i].match(/^EMPLOYER\s*$/i) ||
            upperLines[i].match(/^EMPLOYER\s*[:\-]/i)) {

            // Same line?
            const sameLineMatch = upperLines[i].match(/^EMPLOYER\s*[:\-]?\s+(.+)/);
            if (sameLineMatch && sameLineMatch[1].trim().length > 2) {
                result.employer_name = sameLineMatch[1].trim();
                break;
            }

            // Next line
            if (i + 1 < upperLines.length) {
                const nextLine = upperLines[i + 1].trim();
                if (nextLine.length > 2 && !nextLine.match(/^(NAME|WORK\s*PERMIT|SECTOR)/)) {
                    result.employer_name = nextLine;
                    break;
                }
            }
            break;
        }
    }

    // Fallback: look for PTE LTD pattern
    if (!result.employer_name) {
        const pteMatch = text.match(/([A-Z0-9][A-Z0-9\s&.,]+PTE\.?\s*LTD\.?)/);
        if (pteMatch) result.employer_name = pteMatch[1].trim();
    }

    // ═══════════════════════════════════════════════════════════
    // 5. SECTOR (Singapore Work Permits have this)
    // ═══════════════════════════════════════════════════════════
    const knownSectors = ['CONSTRUCTION', 'MARINE', 'MANUFACTURING', 'PROCESS', 'SERVICES', 'DOMESTIC'];
    for (const sector of knownSectors) {
        if (text.includes(sector)) {
            // Store as part of employer info or separate
            // For now, we don't have a dedicated field
            break;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 6. NATIONALITY
    // ═══════════════════════════════════════════════════════════
    const nationalityPatterns = [
        /NATIONALITY\s*[:\-]?\s*([A-Z][A-Z\s]+?)(?:\n|$)/,
        /COUNTRY\s*(?:OF\s*ORIGIN)?\s*[:\-]?\s*([A-Z][A-Z\s]+?)(?:\n|$)/,
    ];
    const knownNationalities = [
        'INDIAN', 'INDIA', 'BANGLADESHI', 'BANGLADESH', 'CHINESE', 'CHINA', 'PRC',
        'NEPALESE', 'NEPAL', 'VIETNAMESE', 'VIETNAM', 'THAI', 'THAILAND',
        'MYANMAR', 'BURMESE', 'FILIPINO', 'PHILIPPINES', 'INDONESIAN', 'INDONESIA',
        'SRI LANKAN', 'SRI LANKA', 'MALAYSIAN', 'MALAYSIA', 'PAKISTANI', 'PAKISTAN',
    ];

    for (const pattern of nationalityPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.nationality = match[1].trim();
            break;
        }
    }
    if (!result.nationality) {
        for (const nat of knownNationalities) {
            if (text.includes(nat)) {
                result.nationality = nat;
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7. SEX
    // ═══════════════════════════════════════════════════════════
    const sexMatch = text.match(/SEX\s*[:\-]?\s*(MALE|FEMALE|M|F)\b/);
    if (sexMatch) {
        result.sex = sexMatch[1] === 'MALE' ? 'M' : sexMatch[1] === 'FEMALE' ? 'F' : sexMatch[1];
    }

    // ═══════════════════════════════════════════════════════════
    // 8. DATES — context-aware routing
    //    "Course Date" → issue_date (NOT DOB)
    //    "Date of Birth" / "DOB" → date_of_birth
    //    "Issue Date" / "Issued" → issue_date
    //    "Expiry" / "Valid Until" → expiry_date
    //    "Validity: No Expiry" → expiry_date = 'No Expiry'
    // ═══════════════════════════════════════════════════════════

    // Course Date → issue_date
    const courseDateMatch = text.match(/COURSE\s*DATE\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    if (courseDateMatch) {
        result.issue_date = formatDate(courseDateMatch[1]);
    }

    // Explicit DOB (only for non-certification docs)
    const dobMatch = text.match(/(?:DATE\s*OF\s*BIRTH|DOB|D\.?O\.?B\.?|BORN)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    if (dobMatch) {
        result.date_of_birth = formatDate(dobMatch[1]);
    }

    // Explicit Issue Date
    if (!result.issue_date) {
        const issueMatch = text.match(/(?:ISSUE|ISSUED|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
        if (issueMatch) result.issue_date = formatDate(issueMatch[1]);
    }

    // Expiry Date
    const expiryMatch = text.match(/(?:EXPIR|VALID\s*(?:UNTIL|TILL|TO)|EXP\.?)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    if (expiryMatch) {
        result.expiry_date = formatDate(expiryMatch[1]);
    }

    // "Validity: No Expiry" handling
    if (!result.expiry_date && text.match(/VALIDITY\s*[:\-]?\s*NO\s*EXPIRY/)) {
        result.expiry_date = 'No Expiry';
    }

    // Collect all dates for fallback
    const datePattern = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/g;
    const dates = [];
    let dateMatch2;
    while ((dateMatch2 = datePattern.exec(text)) !== null) {
        const day = dateMatch2[1].padStart(2, '0');
        const month = dateMatch2[2].padStart(2, '0');
        const year = dateMatch2[3];
        dates.push(`${year}-${month}-${day}`);
    }

    // Fallback DOB: if this is NOT a certification, use earliest date
    if (!result.date_of_birth && !isCertification && dates.length > 0) {
        const sorted = [...dates].sort();
        result.date_of_birth = sorted[0];
    }

    // Fallback issue/expiry from remaining dates
    if (!result.issue_date && !result.expiry_date && dates.length >= 2) {
        const sorted = [...dates].sort();
        const remaining = sorted.filter(d => d !== result.date_of_birth);
        if (remaining.length >= 2) {
            result.issue_date = remaining[0];
            result.expiry_date = remaining[remaining.length - 1];
        } else if (remaining.length === 1) {
            if (isCertification) {
                result.issue_date = remaining[0];
            } else {
                result.expiry_date = remaining[0];
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. CERT SERIAL NUMBER (S/N)
    //    e.g. "S/N WAHRC-2025-B134P-659" or "S/N: ABC-123"
    // ═══════════════════════════════════════════════════════════
    const snMatch = text.match(/S\/N\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]+)/);
    if (snMatch) {
        result.cert_serial_no = snMatch[1].trim();
    }
    // Also check next line after "S/N" label
    if (!result.cert_serial_no) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/^S\/N\s*$/)) {
                if (i + 1 < upperLines.length) {
                    const nextLine = upperLines[i + 1].trim();
                    if (nextLine.match(/^[A-Z0-9][A-Z0-9\-]+$/)) {
                        result.cert_serial_no = nextLine;
                    }
                }
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 10. COURSE TITLE — improved extraction
    //     Look for known course name patterns (with abbreviations)
    //     e.g. "Work-At-Height Rescue Course (WAHRC)"
    // ═══════════════════════════════════════════════════════════

    // Strategy 1: Look for full course name lines with known keywords
    const courseKeywords = [
        'COURSE', 'CERTIFICATE', 'CERTIFICATION', 'TRAINING',
        'SAFETY', 'RESCUE', 'WELDING', 'RIGGING', 'SCAFFOLD',
        'ELECTRICAL', 'PLUMBING', 'CRANE', 'FORKLIFT', 'HEIGHT',
        'CORETRADE', 'MULTI-SKILL', 'SEC(K)', 'FIRST AID',
    ];

    // Look for lines that contain a known keyword and look like a course title
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const upperLine = upperLines[i];

        // Skip very short lines, date lines, name/ID lines, venue lines
        if (line.length < 5) continue;
        if (upperLine.match(/^(NAME|ID\s*NO|FIN|COURSE\s*DATE|COURSE\s*VENUE|VALIDITY|S\/N|DATE|DOB)/)) continue;
        if (upperLine.match(/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4}/)) continue;
        if (upperLine.match(/^[FGM]\d{7}[A-Z]$/)) continue;
        if (upperLine.match(/SINGAPORE|PIONEER|STREET|AVENUE|ROAD|BLOCK/)) continue;
        if (upperLine.match(/^MR\.|^MS\.|DIRECTOR|PRINCIPAL|TRAINER|DIVISION/)) continue;

        // Check if this line contains a course keyword
        const hasKeyword = courseKeywords.some(k => upperLine.includes(k));
        if (hasKeyword && line.length >= 10) {
            result.course_title = line.replace(/\s+/g, ' ').trim();
            break;
        }
    }

    // Strategy 2: Regex fallback
    if (!result.course_title) {
        const titlePatterns = [
            /COURSE\s*(?:TITLE)?\s*[:\-]\s*([^\n]{5,})/,
            /CERTIFICATE\s*(?:IN|OF|FOR)\s*[:\-]?\s*([^\n]{5,})/,
        ];
        for (const pattern of titlePatterns) {
            const match = text.match(pattern);
            if (match) {
                result.course_title = match[1].trim();
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 11. COURSE PROVIDER — improved extraction
    //     Look for provider names (often multi-line, near top of cert)
    //     e.g. "Avanta\nGlobal" → "Avanta Global"
    // ═══════════════════════════════════════════════════════════
    const providerPatterns = [
        /(?:PROVIDER|ISSUED\s*BY|ISSUING\s*(?:BODY|ORG))\s*[:\-]?\s*([A-Z0-9\s&.,]+?)(?:\n|$)/,
        /(?:TRAINING\s*(?:CENTRE|CENTER|PROVIDER))\s*[:\-]?\s*([A-Z0-9\s&.,]+?)(?:\n|$)/,
    ];
    for (const pattern of providerPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.course_provider = match[1].trim();
            break;
        }
    }

    // Provider fallback: look for known provider names or multi-word
    // company-like names near the top (before the course title)
    if (!result.course_provider && isCertification) {
        // Look for company-like text before the course title line
        const courseTitleIdx = result.course_title
            ? upperLines.findIndex(l => l.includes(result.course_title?.toUpperCase()?.substring(0, 10) || '____'))
            : upperLines.length;

        // Scan lines before course title for provider-like names
        const providerCandidates = [];
        for (let i = 0; i < Math.min(courseTitleIdx, 6); i++) {
            const line = lines[i]?.trim();
            if (!line || line.length < 3) continue;
            // Skip known non-provider lines
            if (upperLines[i].match(/^(S\/N|WAHRC|CERTIFICATE|COURSE|NAME|ID|FIN|DATE|VALID)/)) continue;
            if (upperLines[i].match(/^\d/)) continue; // starts with number
            // Potential provider: short text, looks like a name
            if (line.length >= 3 && line.length <= 30 && line.match(/^[A-Za-z]/)) {
                providerCandidates.push(line);
            }
        }
        // Join consecutive short lines that might be a split name
        if (providerCandidates.length > 0) {
            result.course_provider = providerCandidates.join(' ').trim();
        }
    }

    return result;
}

/**
 * Clean a name string: remove extra whitespace, trailing junk
 */
function cleanName(name) {
    return name
        .replace(/\s+/g, ' ')
        .replace(/[^A-Z\s.'\-\/]/gi, '')
        .trim();
}

/**
 * Check if a string looks like a valid person name (at least 2 words)
 */
function isValidName(name) {
    if (!name || name.length < 3) return false;
    // Must have at least one space (first + last name)
    // Or be at least 5 chars (some single-name cultures)
    const words = name.split(/\s+/).filter(w => w.length > 0);
    return words.length >= 2 || name.length >= 5;
}

/**
 * Format a date string (DD/MM/YYYY) to ISO (YYYY-MM-DD).
 */
function formatDate(dateStr) {
    const match = dateStr.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
    if (!match) return null;
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
}

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
