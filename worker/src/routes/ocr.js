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
 *   Employment of Foreign Manpower Act (Chapter 91A)
 *   Employer
 *   COMPANY NAME PTE. LTD.
 *   Name
 *   WORKER FULL NAME
 *   Work Permit No.    Sector
 *   0 34773262         CONSTRUCTION
 *   [FIN number may appear near barcode, e.g. K3358575]
 */
function parseOCRText(rawText, documentType) {
    const text = rawText.toUpperCase();
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const upperLines = text.split('\n').map(l => l.trim()).filter(Boolean);

    const result = {
        worker_name: null,
        fin_number: null,
        date_of_birth: null,
        nationality: null,
        sex: null,
        employer_name: null,
        course_title: null,
        course_provider: null,
        issue_date: null,
        expiry_date: null,
    };

    // Detect if this is a Work Permit card
    const isWorkPermit = documentType === 'work_permit' ||
        text.includes('WORK PERMIT') ||
        text.includes('EMPLOYMENT OF FOREIGN MANPOWER');

    // ═══════════════════════════════════════════════════════════
    // 1. WORK PERMIT NUMBER
    //    Singapore format: typically 8-9 digits, sometimes
    //    printed with spaces like "0 34773262"
    // ═══════════════════════════════════════════════════════════
    const wpPatterns = [
        // "Work Permit No" followed by number on same or next line
        /WORK\s*PERMIT\s*NO\.?\s*:?\s*(\d[\d\s]{6,})/i,
        // Number after "WP No" 
        /WP\s*NO\.?\s*:?\s*(\d[\d\s]{6,})/i,
    ];

    for (const pattern of wpPatterns) {
        const match = text.match(pattern);
        if (match) {
            // Remove spaces from the number
            result.fin_number = match[1].replace(/\s+/g, '').trim();
            break;
        }
    }

    // If "Work Permit No" label found but number is on the next line
    if (!result.fin_number) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/WORK\s*PERMIT\s*NO/)) {
                // Check if there's a number on the same line after the label
                const sameLine = upperLines[i].match(/WORK\s*PERMIT\s*NO\.?\s*:?\s*(\d[\d\s]+)/);
                if (sameLine) {
                    result.fin_number = sameLine[1].replace(/\s+/g, '').trim();
                } else if (i + 1 < upperLines.length) {
                    // Next line should have the number
                    const nextLine = upperLines[i + 1].trim();
                    const numMatch = nextLine.match(/^(\d[\d\s]{5,})/);
                    if (numMatch) {
                        result.fin_number = numMatch[1].replace(/\s+/g, '').trim();
                    }
                }
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 2. FIN NUMBER (e.g., G1234567A, K3358575)
    //    Singapore FIN: starts with F, G, M, S, T, or K
    //    followed by 7 digits and a letter
    // ═══════════════════════════════════════════════════════════
    const finMatch = text.match(/\b([FGMSTK]\d{7}[A-Z])\b/);
    if (finMatch) {
        // If we already found a WP number, store FIN separately;
        // otherwise use FIN as the primary identifier
        if (!result.fin_number) {
            result.fin_number = finMatch[1];
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
    // 8. DATES (DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY)
    // ═══════════════════════════════════════════════════════════
    const datePattern = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/g;
    const dates = [];
    let dateMatch;
    while ((dateMatch = datePattern.exec(text)) !== null) {
        const day = dateMatch[1].padStart(2, '0');
        const month = dateMatch[2].padStart(2, '0');
        const year = dateMatch[3];
        dates.push(`${year}-${month}-${day}`);
    }

    // DOB
    const dobMatch = text.match(/(?:DATE\s*OF\s*BIRTH|DOB|D\.?O\.?B\.?|BORN)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    if (dobMatch) {
        result.date_of_birth = formatDate(dobMatch[1]);
    } else if (dates.length > 0) {
        const sorted = [...dates].sort();
        result.date_of_birth = sorted[0];
    }

    // Issue / Expiry dates (for certifications)
    const issueMatch = text.match(/(?:ISSUE|ISSUED|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    const expiryMatch = text.match(/(?:EXPIR|VALID\s*(?:UNTIL|TILL|TO)|EXP)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);

    if (issueMatch) result.issue_date = formatDate(issueMatch[1]);
    if (expiryMatch) result.expiry_date = formatDate(expiryMatch[1]);

    if (!result.issue_date && !result.expiry_date && dates.length >= 2) {
        const sorted = [...dates].sort();
        const remaining = sorted.filter(d => d !== result.date_of_birth);
        if (remaining.length >= 2) {
            result.issue_date = remaining[0];
            result.expiry_date = remaining[remaining.length - 1];
        } else if (remaining.length === 1) {
            result.expiry_date = remaining[0];
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 9. COURSE / CERTIFICATION
    // ═══════════════════════════════════════════════════════════
    const coursePatterns = [
        /COURSE\s*(?:TITLE)?\s*[:\-]?\s*([A-Z0-9\s\-&()]+?)(?:\n|$)/,
        /CERTIFICATE\s*(?:IN|OF|FOR)?\s*[:\-]?\s*([A-Z0-9\s\-&()]+?)(?:\n|$)/,
        /CERTIFICATION\s*[:\-]?\s*([A-Z0-9\s\-&()]+?)(?:\n|$)/,
    ];
    for (const pattern of coursePatterns) {
        const match = text.match(pattern);
        if (match) {
            result.course_title = match[1].trim();
            break;
        }
    }

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
