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

    // Validate file type — images + PDF
    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
    const isPDF = file.type === 'application/pdf';
    if (!imageTypes.includes(file.type) && !isPDF) {
        return errorResponse('File must be an image (JPEG, PNG, WebP, GIF, BMP, TIFF) or PDF', 400);
    }

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Content = arrayBufferToBase64(arrayBuffer);

    let rawText = '';

    if (isPDF) {
        // For PDFs, use Google Cloud Vision files:annotate (DOCUMENT_TEXT_DETECTION)
        // Note: Cloud Vision can process single-page PDFs inline as well,
        // but for best results we use the image-based approach by sending it as content.
        // Cloud Vision API also accepts PDFs for TEXT_DETECTION with inputConfig.
        const visionUrl = `https://vision.googleapis.com/v1/files:annotate?key=${apiKey}`;
        const visionPayload = {
            requests: [
                {
                    inputConfig: {
                        content: base64Content,
                        mimeType: 'application/pdf',
                    },
                    features: [
                        { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
                    ],
                    pages: [1, 2, 3, 4, 5], // Process up to 5 pages
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
            console.error('Google Vision API error (PDF):', errText);
            return errorResponse('Google Vision API request failed for PDF', 502);
        }

        const visionResult = await visionResponse.json();
        const pdfResponses = visionResult.responses?.[0]?.responses || [];
        const textParts = [];
        for (const resp of pdfResponses) {
            const fullText = resp?.fullTextAnnotation?.text || '';
            if (fullText) textParts.push(fullText);
        }
        rawText = textParts.join('\n');

    } else {
        // For images, use standard TEXT_DETECTION
        const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
        const visionPayload = {
            requests: [
                {
                    image: { content: base64Content },
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
        const annotations = visionResult.responses?.[0]?.textAnnotations;
        if (!annotations || annotations.length === 0) {
            return jsonResponse({
                success: true,
                raw_text: '',
                extracted: {},
                message: 'No text detected in image',
            });
        }
        rawText = annotations[0].description || '';
    }

    if (!rawText.trim()) {
        return jsonResponse({
            success: true,
            raw_text: '',
            extracted: {},
            message: 'No text detected in document',
        });
    }

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
        race: null,
        address: null,
        country_of_birth: null,
        employer_name: null,
        course_title: null,
        course_provider: null,
        cert_serial_no: null,
        course_duration: null,
        issue_date: null,
        expiry_date: null,
    };

    // Detect document type
    const isWorkPermit = documentType === 'work_permit' ||
        text.includes('WORK PERMIT') ||
        text.includes('EMPLOYMENT OF FOREIGN MANPOWER');

    const isIdentityCard = documentType === 'work_permit' ||
        text.includes('IDENTITY CARD') ||
        text.includes('REPUBLIC OF SINGAPORE') ||
        text.includes('NRIC NO');

    const isCertification = documentType === 'certification' ||
        text.includes('COURSE DATE') ||
        text.includes('COURSE VENUE') ||
        text.includes('COURSE TITLE') ||
        text.includes('ISSUED DATE') ||
        text.includes('SERIAL NUMBER') ||
        text.includes('STUDENT NUMBER') ||
        text.includes('CERTIFICATE') ||
        text.includes('CERTIFICATION') ||
        text.includes('ACADEMY') ||
        text.includes('TRAINING') ||
        text.includes('VALIDITY');

    // ═══════════════════════════════════════════════════════════
    // 1. FIN / NRIC NUMBER
    //    FIN: F/G/M + 7 digits + check letter
    //    NRIC: S/T + 7 digits + check letter
    // ═══════════════════════════════════════════════════════════

    // Singapore IC: "IDENTITY CARD NO." pattern
    const icNoMatch = text.match(/IDENTITY\s*CARD\s*(?:NO\.?|NUMBER)\s*[:\-]?\s*([STFGM]\d{7}[A-Z])/);
    if (icNoMatch) {
        result.fin_number = icNoMatch[1];
    }

    // "NRIC No:" on back of card
    if (!result.fin_number) {
        const nricNoMatch = text.match(/NRIC\s*(?:NO\.?|NUMBER)\s*[:\-]?\s*([ST]\d{7}[A-Z])/);
        if (nricNoMatch) {
            result.fin_number = nricNoMatch[1];
        }
    }

    // Other labeled patterns: "FIN", "ID NO", "ID Number"
    if (!result.fin_number) {
        const idLabelMatch = text.match(/(?:FIN|ID\s*(?:NO|NUMBER)\.?)\s*[:\-]?\s*([FGMST]\d{7}[A-Z])/);
        if (idLabelMatch) {
            result.fin_number = idLabelMatch[1];
        }
    }

    // Name with ID in parentheses: "VERNON TAN (S7616077E)"
    if (!result.fin_number) {
        const nameIdMatch = text.match(/([A-Z][A-Z\s.'\-]{4,})\s*\(([FGMST]\d{7}[A-Z])\)/);
        if (nameIdMatch) {
            result.fin_number = nameIdMatch[2];
            if (!result.worker_name) {
                const candidate = cleanName(nameIdMatch[1]);
                if (isValidName(candidate)) result.worker_name = candidate;
            }
        }
    }

    // General scan for FIN/NRIC-format string
    if (!result.fin_number) {
        const finMatch = text.match(/\b([FGMST]\d{7}[A-Z])\b/);
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
                if (nextLine.match(/^(WORK\s*PERMIT|SECTOR|DOB|DATE|SEX|EMPLOYER|NATIONALITY|ID\s*NO|FIN|SERIAL|ISSUED)/)) break;

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

    // Fallback: look for "NAME" with inline value (with or without colon)
    if (!result.worker_name) {
        const nameInline = text.match(/NAME\s*[:\-]?\s+([A-Z][A-Z\s.'\-]{2,})/);
        if (nameInline) {
            const candidate = cleanName(nameInline[1]);
            if (isValidName(candidate)) {
                result.worker_name = candidate;
            }
        }
    }

    // Fallback for certs without "Name:" label:
    // look for a line that looks like a person name, positioned before the FIN line
    if (!result.worker_name && isCertification && result.fin_number) {
        const finIdx = upperLines.findIndex(l => l.includes(result.fin_number));
        if (finIdx > 0) {
            for (let i = finIdx - 1; i >= 0 && i >= finIdx - 3; i--) {
                const line = upperLines[i].trim();
                // Strip ID in parentheses if present
                const cleaned = line.replace(/\s*\([FGMST]\d{7}[A-Z]\)/, '').trim();
                if (cleaned.match(/^[A-Z][A-Z\s.'\-\/]{4,}$/) &&
                    !cleaned.match(/ACADEMY|PTE|LTD|COURSE|CERTIFICATE|TRAINING|PERFORM|HEIGHT|SAFETY|WORK|SINGAPORE|QUALIFICATION/) &&
                    !cleaned.match(/SERIAL|STUDENT|NUMBER|ISSUED|VALID|VENUE|GLOBAL|ACHIEVEMENT|COMPLETION|CERTIFY|ATTENDED|COMPLETED/) &&
                    !cleaned.match(/^[FGMST]\d{7}[A-Z]$/)) {
                    const candidate = cleanName(cleaned);
                    if (isValidName(candidate) && candidate.split(/\s+/).length >= 2) {
                        result.worker_name = candidate;
                        break;
                    }
                }
            }
        }
    }

    // Fallback: "This is to certify that" → name on following line(s)
    if (!result.worker_name) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/THIS\s*IS\s*TO\s*CERTIFY/)) {
                // Name is typically 1-3 lines after
                for (let j = i + 1; j < Math.min(i + 4, upperLines.length); j++) {
                    let nameLine = upperLines[j].trim();
                    // Skip filler text
                    if (nameLine.match(/^(HAS\s|THAT\s|THE\s|WHO\s)/)) continue;
                    if (nameLine.length < 4) continue;
                    // Strip ID in parentheses
                    nameLine = nameLine.replace(/\s*\([FGMST]\d{7}[A-Z]\)/, '').trim();
                    if (nameLine.match(/^[A-Z][A-Z\s.'\-]{3,}$/) && !nameLine.match(/ACADEMY|COURSE|CERTIFICATE|TRAINING|COMPLETION|ACHIEVEMENT/)) {
                        const candidate = cleanName(nameLine);
                        if (isValidName(candidate) && candidate.split(/\s+/).length >= 2) {
                            result.worker_name = candidate;
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    // Fallback: label-below-value (Autodesk format): line before "NAME" label
    if (!result.worker_name) {
        for (let i = 1; i < upperLines.length; i++) {
            if (upperLines[i].match(/^NAME\s*$/)) {
                const prev = upperLines[i - 1].trim();
                if (prev.match(/^[A-Z][A-Z\s.'\-]{3,}$/) && !prev.match(/CERTIFICATE|COMPLETION|ACHIEVEMENT|COURSE/)) {
                    const candidate = cleanName(prev);
                    if (isValidName(candidate)) {
                        result.worker_name = candidate;
                    }
                }
                break;
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
    // 7a. RACE (Singapore IC)
    // ═══════════════════════════════════════════════════════════
    const knownRaces = ['CHINESE', 'MALAY', 'INDIAN', 'EURASIAN', 'CAUCASIAN', 'JAPANESE', 'KOREAN', 'SIKH'];
    for (let i = 0; i < upperLines.length; i++) {
        if (upperLines[i].match(/^RACE\s*$/)) {
            // Value on the NEXT line
            if (i + 1 < upperLines.length) {
                const nextLine = upperLines[i + 1].trim();
                if (knownRaces.some(r => nextLine.includes(r))) {
                    result.race = nextLine;
                    break;
                }
            }
        }
        // Same-line: "Race CHINESE"
        const raceMatch = upperLines[i].match(/RACE\s*[:\-]?\s*(CHINESE|MALAY|INDIAN|EURASIAN|CAUCASIAN|JAPANESE|KOREAN|SIKH)/);
        if (raceMatch) {
            result.race = raceMatch[1].trim();
            break;
        }
    }
    // Fallback: scan for known race words near "Race" label
    if (!result.race && (isIdentityCard || isWorkPermit)) {
        for (const race of knownRaces) {
            if (text.includes(race)) {
                result.race = race;
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7b. COUNTRY / PLACE OF BIRTH (Singapore IC)
    // ═══════════════════════════════════════════════════════════
    for (let i = 0; i < upperLines.length; i++) {
        const countryMatch = upperLines[i].match(/(?:COUNTRY|PLACE)\s*(?:\/\s*PLACE)?\s*(?:OF\s*)?BIRTH\s*[:\-]?\s*/);
        if (countryMatch) {
            // Value after the label on same line
            const afterLabel = upperLines[i].replace(countryMatch[0], '').trim();
            if (afterLabel.length >= 3) {
                result.country_of_birth = afterLabel;
            } else if (i + 1 < upperLines.length) {
                // Value on next line
                const nextLine = upperLines[i + 1].trim();
                if (nextLine.length >= 3 && !nextLine.match(/^(DATE|SEX|RACE|NAME|FIN|NRIC|IDENTITY)/)) {
                    result.country_of_birth = nextLine;
                }
            }
            break;
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7c. ADDRESS (Singapore IC back)
    //     e.g. "APT BLK 221 BOON LAY PLACE #20-104\nSINGAPORE 640221"
    // ═══════════════════════════════════════════════════════════
    if (isIdentityCard) {
        // Look for address patterns: BLK, APT, SINGAPORE + postal code
        const addressParts = [];
        for (let i = 0; i < upperLines.length; i++) {
            // Detect lines with block/street patterns or Singapore postal code
            if (upperLines[i].match(/(?:APT|BLK|BLOCK|AVENUE|AVE|ROAD|RD|STREET|ST|PLACE|DRIVE|DR|CRESCENT|CRES|LANE|LN|TERRACE|LORONG|LOR|JALAN|JLN|TAMPINES|WOODLANDS|JURONG|YISHUN|BEDOK|TOA PAYOH|ANG MO KIO|BUKIT|SENGKANG|PUNGGOL|PASIR RIS|CLEMENTI|QUEENSTOWN|BOON LAY|CHOA CHU KANG|HOUGANG|SERANGOON|GEYLANG)/)) {
                addressParts.push(lines[i].trim());
                // Check next lines for continuation (e.g. "SINGAPORE 640221")
                for (let j = i + 1; j < Math.min(i + 3, upperLines.length); j++) {
                    if (upperLines[j].match(/SINGAPORE\s*\d{6}/) || upperLines[j].match(/^#?\d+[\-\/]\d+/)) {
                        addressParts.push(lines[j].trim());
                    } else break;
                }
                break;
            }
            // Also detect "SINGAPORE xxxxxx" standalone
            if (upperLines[i].match(/^SINGAPORE\s+\d{6}$/) && !result.address) {
                // Look backwards for address lines
                for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
                    if (upperLines[j].match(/(?:APT|BLK|BLOCK|AVENUE|AVE|ROAD|STREET|PLACE|DRIVE|#\d)/)) {
                        addressParts.unshift(lines[j].trim());
                    }
                }
                addressParts.push(lines[i].trim());
                break;
            }
        }
        if (addressParts.length > 0) {
            result.address = addressParts.join(', ');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 7d. DATE OF ISSUE (IC back)
    // ═══════════════════════════════════════════════════════════
    if (isIdentityCard && !result.issue_date) {
        const dateOfIssueMatch = text.match(/DATE\s*(?:OF\s*)?ISSUE\s*[:;\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
        if (dateOfIssueMatch) {
            result.issue_date = formatDate(dateOfIssueMatch[1]);
        }
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
    const courseDateMatch = text.match(/COURSE\s*DATE\s*[:\-]?\s*(\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4})/);
    if (courseDateMatch) {
        result.issue_date = formatDate(courseDateMatch[1]);
    }

    // Text-month course date: "13-FEBRUARY-2022" or labeled "COURSE DATE" above
    if (!result.issue_date) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/^COURSE\s*DATE\s*$/)) {
                // Value on PREVIOUS line (label-below-value) or on SAME line after label
                if (i > 0) {
                    const prev = upperLines[i - 1].trim();
                    const textDate = parseTextMonthDate(prev);
                    if (textDate) { result.issue_date = textDate; break; }
                }
            }
        }
    }

    // Explicit DOB (only for non-certification docs)
    const dobMatch = text.match(/(?:DATE\s*OF\s*BIRTH|DOB|D\.?O\.?B\.?|BORN)\s*[:\-]?\s*(\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4})/);
    if (dobMatch) {
        result.date_of_birth = formatDate(dobMatch[1]);
    }

    // Fallback: DOB label and date on separate lines (IC format)
    if (!result.date_of_birth) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/DATE\s*OF\s*BIRTH|^DOB$/)) {
                // Check next line for a date
                if (i + 1 < upperLines.length) {
                    const nextLine = upperLines[i + 1].trim();
                    const dateMatch = nextLine.match(/^(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})/);
                    if (dateMatch) {
                        result.date_of_birth = formatDate(dateMatch[1]);
                    }
                }
                break;
            }
        }
    }

    // Explicit Issue Date — also match "Issued Date:" pattern
    if (!result.issue_date) {
        const issueMatch = text.match(/(?:ISSUED?\s*DATE|ISSUE|ISSUED|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*(\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4})/);
        if (issueMatch) result.issue_date = formatDate(issueMatch[1]);
    }

    // Text-month issue dates: "Issued Date: 07 June 2025" or "14 December 2011"
    if (!result.issue_date) {
        const issueTmMatch = text.match(/(?:ISSUED?\s*DATE|ISSUE|ISSUED|DATE\s*OF\s*ISSUE)\s*[:\-]?\s*(\d{1,2}[\s\-](?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s*[,\-]?\s*\d{4})/i);
        if (issueTmMatch) {
            result.issue_date = parseTextMonthDate(issueTmMatch[1]);
        }
    }

    // Date range: "16 NOV 2017 TO 21 DEC 2017" → issue_date = end date
    if (!result.issue_date) {
        const rangeMatch = text.match(/(\d{1,2}[\s\-](?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s*[,\-]?\s*\d{4})\s+TO\s+(\d{1,2}[\s\-](?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s*[,\-]?\s*\d{4})/i);
        if (rangeMatch) {
            result.issue_date = parseTextMonthDate(rangeMatch[2]); // use END date
        }
    }

    // "conducted on ... December 2011" → try to extract a date
    if (!result.issue_date) {
        const conductedMatch = text.match(/CONDUCTED\s+ON\s+.+?(\d{1,2})(?:ST|ND|RD|TH)?\s+(?:AND\s+\d{1,2}(?:ST|ND|RD|TH)?\s+)?((?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\s*[,\-]?\s*\d{4})/i);
        if (conductedMatch) {
            result.issue_date = parseTextMonthDate(conductedMatch[1] + ' ' + conductedMatch[2]);
        }
    }

    // Standalone text-month date as last resort for issue_date on certs
    if (!result.issue_date && isCertification) {
        // Look for a standalone date line with text month
        for (const ul of upperLines) {
            const d = parseTextMonthDate(ul);
            if (d) {
                result.issue_date = d;
                break;
            }
        }
    }

    // Expiry Date
    const expiryMatch = text.match(/(?:EXPIR|VALID\s*(?:UNTIL|TILL|TO)|EXP\.?)\s*[:\-]?\s*(\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4})/);
    if (expiryMatch) {
        result.expiry_date = formatDate(expiryMatch[1]);
    }

    // "Validity: No Expiry" / "Validity Period: NIL" handling
    if (!result.expiry_date) {
        if (text.match(/VALIDITY\s*(?:PERIOD)?\s*[:\-]?\s*(?:NO\s*EXPIRY|NIL|N\/A|NONE|LIFETIME|NO\s*LIMIT)/)) {
            result.expiry_date = 'No Expiry';
        }
    }

    // Collect all dates for fallback
    const datePattern = /(\d{1,2})[\\\/\\.\\-](\d{1,2})[\\\/\\.\\-](\d{4})/g;
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
    //    Patterns: "S/N WAHRC-2025-B134P-659"
    //              "Serial Number: 0226-02901"
    //              "Student Number: WPH-GMS-1110-1.1-1292"
    //              "Certificate No. AP006309688720501O278"
    // ═══════════════════════════════════════════════════════════

    // Pattern 1: "Serial Number:", "Student Number:", or "Certificate No."
    const serialNumMatch = text.match(/(?:SERIAL|STUDENT)\s*(?:NUMBER|NO\.?)\s*[:\-]?\s*([\dA-Z][\dA-Z\-\.]+)/i);
    if (serialNumMatch) {
        result.cert_serial_no = serialNumMatch[1].trim();
    }

    // Certificate No. pattern
    if (!result.cert_serial_no) {
        const certNoMatch = text.match(/CERTIFICATE\s*(?:NO|NUMBER)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\.]+)/i);
        if (certNoMatch) {
            result.cert_serial_no = certNoMatch[1].trim();
        }
    }

    // Pattern 2: "S/N WAHRC-2025-B134P-659" (inline)
    if (!result.cert_serial_no) {
        const snMatch = text.match(/S\/N\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\.]+)/);
        if (snMatch) {
            result.cert_serial_no = snMatch[1].trim();
        }
    }

    // Pattern 3: "S/N" on its own line, number on next line
    if (!result.cert_serial_no) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/^S\/N\s*$/)) {
                if (i + 1 < upperLines.length) {
                    const nextLine = upperLines[i + 1].trim();
                    if (nextLine.match(/^[A-Z0-9][A-Z0-9\-\.]+$/)) {
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
        'PERFORM', 'LIFTING', 'OPERATIONS', 'SUPERVISE',
        'CONFINED', 'SPACE', 'ERECT', 'DISMANTLE',
    ];

    // Look for lines that contain a known keyword and look like a course title
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const upperLine = upperLines[i];

        // Skip very short lines, date lines, name/ID lines, venue lines
        if (line.length < 5) continue;
        if (upperLine.match(/^(NAME|ID\s*(NO|NUMBER)|FIN|COURSE\s*(DATE|VENUE)|VALIDITY|S\/N|DATE|DOB)/)) continue;
        if (upperLine.match(/^(SERIAL\s*NUM|STUDENT\s*NUM|ISSUED?\s*DATE)/)) continue;
        if (upperLine.match(/\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4}/)) continue;
        if (upperLine.match(/^[FGM]\d{7}[A-Z]$/)) continue;
        if (upperLine.match(/SINGAPORE|PIONEER|STREET|AVENUE|ROAD|BLOCK/)) continue;
        if (upperLine.match(/^MR\.|^MS\.|DIRECTOR|PRINCIPAL|TRAINER(?:\s|$)|DIVISION/)) continue;
        if (upperLine.match(/^MANAGING|^WORKFORCE|^QUALIF|^STEPS\s*TO/)) continue;
        // Skip lines that are just a person's name (all-uppercase, 2-3 words, no keywords)
        if (upperLine.match(/^[A-Z]+\s+[A-Z]+(?:\s+[A-Z]+)?$/) && !courseKeywords.some(k => upperLine.includes(k))) continue;

        // Check if this line contains a course keyword
        const hasKeyword = courseKeywords.some(k => upperLine.includes(k));
        if (hasKeyword && line.length >= 10) {
            // Strip "Course Title:" prefix if present
            let title = line.replace(/\s+/g, ' ').trim();
            title = title.replace(/^Course\s*Title\s*[:\-]?\s*/i, '').trim();
            result.course_title = title;
            break;
        }
    }

    // Strategy 2: Regex fallback — strip "Course Title:" prefix
    if (!result.course_title) {
        const titlePatterns = [
            /COURSE\s*TITLE\s*[:\-]\s*([^\n]{5,})/,
            /COURSE\s*[:\-]\s*([^\n]{5,})/,
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

    // Strategy 3: label-below-value (Autodesk) — value on line BEFORE "COURSE TITLE" label
    if (!result.course_title) {
        for (let i = 1; i < upperLines.length; i++) {
            if (upperLines[i].match(/^COURSE\s*TITLE\s*$/)) {
                const prev = lines[i - 1]?.trim();
                if (prev && prev.length >= 5) {
                    result.course_title = prev.replace(/\s+/g, ' ').trim();
                }
                break;
            }
        }
    }

    // Strategy 4: "has successfully completed a course in" / "has attended"
    // → course title on the next non-filler line
    if (!result.course_title) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/(?:COMPLETED|ATTENDED)\s*(?:A\s*)?(?:COURSE)?\s*(?:IN)?\s*$/) ||
                upperLines[i].match(/HAS\s+(?:SUCCESSFULLY\s+)?COMPLETED/) ||
                upperLines[i].match(/HAS\s+ATTENDED/)) {
                // Course title on following lines
                for (let j = i + 1; j < Math.min(i + 4, upperLines.length); j++) {
                    const cl = lines[j]?.trim();
                    if (!cl || cl.length < 4) continue;
                    const ucl = upperLines[j];
                    // Skip filler phrases
                    if (ucl.match(/^(HAS\s|A\s*COURSE|THIS\s|THAT\s|THE\s|CONDUCTED|IN$)/)) continue;
                    // Skip dates, names, IDs
                    if (ucl.match(/^[FGMST]\d{7}[A-Z]$/)) continue;
                    if (ucl.match(/\d{1,2}[\\\/\\.\\-]\d{1,2}[\\\/\\.\\-]\d{4}/)) continue;
                    if (ucl.match(/^(NAME|ID|ISSUED|SERIAL|VALID)/)) continue;
                    // This should be the course title
                    let title = cl.replace(/\s+/g, ' ').trim();
                    // Remove parenthetical duration
                    title = title.replace(/\s*\(\d+[\s\-]+\d*\s*HOURS?\)\s*/i, '').trim();
                    if (title.length >= 5) {
                        result.course_title = title;
                        break;
                    }
                }
                break;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 11a. COURSE DURATION
    //      e.g. "(18 HOURS)", "41-100 HOURS", "COURSE DURATION" label
    // ═══════════════════════════════════════════════════════════
    const durationMatch = text.match(/(?:\(\s*)?(\d+[\s\-]+\d*\s*HOURS?)(?:\s*\))?/i);
    if (durationMatch) {
        result.course_duration = durationMatch[0].replace(/[()]/g, '').trim();
    }
    // Label-below-value: line before "COURSE DURATION" label
    if (!result.course_duration) {
        for (let i = 1; i < upperLines.length; i++) {
            if (upperLines[i].match(/^COURSE\s*DURATION\s*$/)) {
                const prev = lines[i - 1]?.trim();
                if (prev && prev.match(/\d+/)) {
                    result.course_duration = prev;
                }
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
    ];
    for (const pattern of providerPatterns) {
        const match = text.match(pattern);
        if (match) {
            result.course_provider = match[1].trim();
            break;
        }
    }

    // Provider pattern: "Training Manager Of Wong Fong Academy"
    if (!result.course_provider) {
        const mgrMatch = text.match(/TRAINING\s*MANAGER\s*(?:OF|AT|FOR)\s+(.+?)(?:\n|$)/);
        if (mgrMatch) {
            result.course_provider = mgrMatch[1].trim();
        }
    }

    // Provider pattern: line containing "ACADEMY", "INSTITUTE", "CENTRE", "CENTER" etc.
    if (!result.course_provider && isCertification) {
        const providerIndicators = ['ACADEMY', 'INSTITUTE', 'CENTRE', 'CENTER', 'COLLEGE', 'SCHOOL'];
        for (let i = 0; i < Math.min(upperLines.length, 8); i++) {
            const ul = upperLines[i];
            // Skip lines that are also the course title
            if (result.course_title && ul.includes(result.course_title.toUpperCase().substring(0, 10))) continue;
            // Skip lines with labels
            if (ul.match(/^(NAME|ID|FIN|SERIAL|STUDENT|COURSE\s*(DATE|VENUE|TITLE)|ISSUED|VALIDITY|S\/N)/)) continue;
            if (ul.match(/^(MR\.|MS\.|DIRECTOR|PRINCIPAL|MANAGING|STEPS\s*TO)/)) continue;
            // Check for known provider indicators
            if (providerIndicators.some(ind => ul.includes(ind))) {
                // Use original case from lines[]
                let prov = lines[i].trim();
                // Strip common suffixes like "®" or tagline words
                prov = prov.replace(/[®©™]/g, '').replace(/\s+/g, ' ').trim();
                result.course_provider = prov;
                break;
            }
        }
    }

    // Provider: "Pte Ltd" / "Pte. Ltd." company pattern
    if (!result.course_provider) {
        const pteLtdMatch = text.match(/([A-Z][A-Z0-9\s&.,]+PTE\.?\s*LTD\.?)/);
        if (pteLtdMatch) {
            result.course_provider = pteLtdMatch[1].trim();
        }
    }

    // Provider: "Accredited Training Provider" → name is on lines above
    if (!result.course_provider) {
        for (let i = 0; i < upperLines.length; i++) {
            if (upperLines[i].match(/ACCREDITED\s*TRAINING\s*PROVIDER/)) {
                // Provider name is typically on lines before this
                for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
                    const line = lines[j]?.trim();
                    if (!line || line.length < 3) continue;
                    if (upperLines[j].match(/^(CERTIFICATE|THIS|CONGRATUL|APPROVED)/)) continue;
                    if (line.match(/^[A-Za-z]/) && line.length >= 5) {
                        result.course_provider = line.replace(/[®©™]/g, '').trim();
                        break;
                    }
                }
                break;
            }
        }
    }

    // Provider: "AUTHORIZED TRAINING CENTER" label → line above has the institution
    if (!result.course_provider) {
        for (let i = 1; i < upperLines.length; i++) {
            if (upperLines[i].match(/AUTHORIZED\s*TRAINING\s*CENTER/) ||
                upperLines[i].match(/CONTINUING\s*EDUCATION/)) {
                if (i > 0) {
                    const prev = lines[i - 1]?.trim();
                    if (prev && prev.length >= 5 && prev.match(/^[A-Za-z]/) &&
                        !prev.match(/^(Director|Divisional|Managing|Mr|Ms)/i)) {
                        result.course_provider = prev;
                    }
                }
                break;
            }
        }
    }

    // Provider: "Institute of" / "Polytechnic" patterns
    if (!result.course_provider) {
        const instMatch = text.match(/(INSTITUTE\s+OF\s+[A-Z\s&]+?)(?:\n|$)/);
        if (instMatch) {
            result.course_provider = instMatch[1].trim();
        }
    }
    if (!result.course_provider) {
        const polyMatch = text.match(/([A-Z][A-Z\s]+POLYTECHNIC)/);
        if (polyMatch) {
            result.course_provider = polyMatch[1].trim();
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
    const match = dateStr.match(/(\d{1,2})[\\\/\\.\\-](\d{1,2})[\\\/\\.\\-](\d{4})/);
    if (!match) return null;
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
}

/**
 * Parse text-month dates like "16 NOV 2017", "14 December 2011", "13-FEBRUARY-2022".
 * Returns ISO format YYYY-MM-DD or null.
 */
function parseTextMonthDate(str) {
    if (!str) return null;
    const months = {
        JAN: '01', JANUARY: '01', FEB: '02', FEBRUARY: '02',
        MAR: '03', MARCH: '03', APR: '04', APRIL: '04',
        MAY: '05', JUN: '06', JUNE: '06', JUL: '07', JULY: '07',
        AUG: '08', AUGUST: '08', SEP: '09', SEPTEMBER: '09',
        OCT: '10', OCTOBER: '10', NOV: '11', NOVEMBER: '11',
        DEC: '12', DECEMBER: '12',
    };
    const match = str.match(/(\d{1,2})[\s\-,]+([A-Z]+)[\s\-,]+(\d{4})/i);
    if (!match) return null;
    const day = match[1].padStart(2, '0');
    const monthName = match[2].toUpperCase();
    const month = months[monthName];
    const year = match[3];
    if (!month) return null;
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
