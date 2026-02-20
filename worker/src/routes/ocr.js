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
    const documentType = formData.get('document_type') || 'auto'; // work_permit | visit_pass | certification | auto

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
 * Handles Work Permits, Visit Passes, and Certifications.
 */
function parseOCRText(rawText, documentType) {
    const text = rawText.toUpperCase();
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

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

    // ─── FIN Number (e.g., G1234567A) ─────────────────────
    const finMatch = text.match(/\b([FGMST]\d{7}[A-Z])\b/);
    if (finMatch) result.fin_number = finMatch[1];

    // ─── Dates (DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY) ──
    const datePattern = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/g;
    const dates = [];
    let dateMatch;
    while ((dateMatch = datePattern.exec(text)) !== null) {
        const day = dateMatch[1].padStart(2, '0');
        const month = dateMatch[2].padStart(2, '0');
        const year = dateMatch[3];
        dates.push(`${year}-${month}-${day}`);
    }

    // ─── Name extraction ──────────────────────────────────
    // Look for "NAME" label followed by a value
    const namePatterns = [
        /NAME\s*[:\-]?\s*([A-Z\s]{3,})/,
        /NAME\s+OF\s+WORKER\s*[:\-]?\s*([A-Z\s]{3,})/,
        /WORKER\s*[:\-]?\s*([A-Z\s]{3,})/,
    ];
    for (const pattern of namePatterns) {
        const match = text.match(pattern);
        if (match) {
            result.worker_name = match[1].trim().replace(/\s+/g, ' ');
            break;
        }
    }

    // ─── Nationality ──────────────────────────────────────
    const nationalityPatterns = [
        /NATIONALITY\s*[:\-]?\s*([A-Z\s]+?)(?:\n|$)/,
        /COUNTRY\s*[:\-]?\s*([A-Z\s]+?)(?:\n|$)/,
    ];
    const knownNationalities = ['INDIAN', 'BANGLADESHI', 'CHINESE', 'NEPALESE', 'VIETNAMESE',
        'THAI', 'MYANMAR', 'FILIPINO', 'INDONESIAN', 'SRI LANKAN', 'MALAYSIAN', 'PAKISTANI'];

    for (const pattern of nationalityPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.nationality = match[1].trim();
            break;
        }
    }
    // Fallback: scan for known nationalities
    if (!result.nationality) {
        for (const nat of knownNationalities) {
            if (text.includes(nat)) {
                result.nationality = nat;
                break;
            }
        }
    }

    // ─── Sex ──────────────────────────────────────────────
    const sexMatch = text.match(/SEX\s*[:\-]?\s*(MALE|FEMALE|M|F)\b/);
    if (sexMatch) {
        result.sex = sexMatch[1] === 'MALE' ? 'M' : sexMatch[1] === 'FEMALE' ? 'F' : sexMatch[1];
    }

    // ─── Employer ─────────────────────────────────────────
    const employerPatterns = [
        /EMPLOYER\s*[:\-]?\s*([A-Z0-9\s&.,]+?)(?:\n|$)/,
        /COMPANY\s*[:\-]?\s*([A-Z0-9\s&.,]+?)(?:\n|$)/,
    ];
    for (const pattern of employerPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.employer_name = match[1].trim();
            break;
        }
    }
    // Fallback: look for PTE LTD
    if (!result.employer_name) {
        const pteMatch = text.match(/([A-Z0-9\s&.,]+PTE\s*\.?\s*LTD\.?)/);
        if (pteMatch) result.employer_name = pteMatch[1].trim();
    }

    // ─── Date assignments ─────────────────────────────────
    if (documentType === 'certification' || documentType === 'auto') {
        // Look for specific date labels
        const issueMatch = text.match(/(?:ISSUE|ISSUED|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
        const expiryMatch = text.match(/(?:EXPIR|VALID\s*(?:UNTIL|TILL|TO)|EXP)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);

        if (issueMatch) result.issue_date = formatDate(issueMatch[1]);
        if (expiryMatch) result.expiry_date = formatDate(expiryMatch[1]);
    }

    // DOB
    const dobMatch = text.match(/(?:DATE\s*OF\s*BIRTH|DOB|D\.?O\.?B\.?|BORN)\s*[:\-]?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/);
    if (dobMatch) {
        result.date_of_birth = formatDate(dobMatch[1]);
    } else if (dates.length > 0 && !result.date_of_birth) {
        // Heuristic: earliest date is likely DOB
        const sorted = [...dates].sort();
        result.date_of_birth = sorted[0];
    }

    // If no specific issue/expiry dates found, use remaining dates
    if (!result.issue_date && !result.expiry_date && dates.length >= 2) {
        const sorted = [...dates].sort();
        // Skip the DOB date
        const remaining = sorted.filter(d => d !== result.date_of_birth);
        if (remaining.length >= 2) {
            result.issue_date = remaining[0];
            result.expiry_date = remaining[remaining.length - 1];
        } else if (remaining.length === 1) {
            result.expiry_date = remaining[0];
        }
    }

    // ─── Course/Certification ─────────────────────────────
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
