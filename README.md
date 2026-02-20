# WorkPass & Cert Manager

A full-stack application for managing **Work Permits**, **Visit Passes**, and **Trade Certifications** — built on the Cloudflare platform with OCR-powered data extraction and Google Sheets sync.

## Architecture

| Component | Technology | Description |
| --------- | ---------- | ----------- |
| Frontend | Cloudflare Pages | SPA dashboard for uploading, reviewing, and managing records |
| Backend | Cloudflare Workers | REST API with OCR processing and Google Sheets sync |
| Database | Cloudflare D1 | Structured storage for workers, certifications, documents |
| Storage | Cloudflare R2 | Secure file storage for uploaded documents and photos |
| OCR | Google Cloud Vision | Automatic text extraction from work permits and certificates |
| Sheets Sync | Google Sheets API | Automatic sync of worker/certification data to spreadsheets |

## Features

- **OCR Upload Flow**: Upload a work permit or certificate image → automatic text extraction → review/edit extracted fields → save
- **Duplicate Prevention**: Uses FIN Number as unique identifier — creates new or updates existing worker
- **Certification Tracking**: Track course titles, providers, issue/expiry dates with visual expiry alerts
- **Secure File Storage**: All files stored in R2 — accessible only via Worker (not public)
- **Google Sheets Sync**: Automatically syncs worker and certification data to Google Sheets
- **Responsive Dashboard**: Premium dark-mode UI with stats, search, pagination, and worker profiles

## Project Structure

```
workpass-cert-manager/
├── .github/workflows/deploy.yml      ← CI/CD
├── package.json
├── wrangler.toml                     ← Cloudflare bindings (D1 + R2)
├── README.md
│
├── frontend/                         ← Cloudflare Pages
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── api.js                    ← API client
│       ├── router.js                 ← Hash-based SPA router
│       └── app.js                    ← Application logic
│
├── worker/                           ← Cloudflare Workers
│   └── src/
│       ├── index.js                  ← Entry point + stats
│       ├── google-sync.js            ← Google Sheets sync module
│       ├── routes/
│       │   ├── workers.js            ← Worker CRUD + document upload
│       │   ├── certifications.js     ← Certification CRUD
│       │   ├── documents.js          ← R2 file upload/retrieval
│       │   └── ocr.js                ← Google Vision OCR processing
│       ├── middleware/
│       │   ├── cors.js
│       │   └── auth.js
│       └── utils/
│           └── response.js
│
└── database/
    ├── schema.sql                    ← Reference schema
    ├── seed.sql                      ← Sample data
    └── migrations/
        ├── 0001_initial.sql
        └── 0002_system_upgrade.sql   ← Current schema
```

## API Endpoints

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/health` | Health check |
| POST | `/api/workers/create` | Create or update worker (upsert by FIN) |
| POST | `/api/workers/upload-document` | Upload document linked to worker |
| GET | `/api/workers/list` | List workers with search/pagination |
| GET | `/api/workers/:id` | Get worker with certifications & documents |
| DELETE | `/api/workers/:id` | Delete worker + associated data |
| POST | `/api/certifications/create` | Create certification |
| GET | `/api/certifications/list` | List certifications |
| DELETE | `/api/certifications/:id` | Delete certification |
| POST | `/api/ocr/process` | OCR process uploaded image |
| POST | `/api/documents/upload` | Upload document to R2 |
| GET | `/api/files/:key` | Retrieve file from R2 (private) |
| DELETE | `/api/files/:key` | Delete file from R2 |

## Database Tables

### workers
| Column | Type | Notes |
| ------ | ---- | ----- |
| id | INTEGER PK | Auto-increment |
| fin_number | TEXT UNIQUE | Foreign Identification Number |
| worker_name | TEXT NOT NULL | |
| date_of_birth | TEXT | YYYY-MM-DD |
| nationality | TEXT | |
| sex | TEXT | M or F |
| employer_name | TEXT | |
| photo_key | TEXT | R2 key |
| created_at | TEXT | Auto |
| updated_at | TEXT | Auto |

### certifications
| Column | Type | Notes |
| ------ | ---- | ----- |
| id | INTEGER PK | Auto-increment |
| worker_id | INTEGER FK | References workers(id) |
| course_title | TEXT NOT NULL | |
| course_provider | TEXT | |
| issue_date | TEXT | |
| expiry_date | TEXT | |
| file_key | TEXT | R2 key |
| created_at | TEXT | Auto |
| updated_at | TEXT | Auto |

### documents
| Column | Type | Notes |
| ------ | ---- | ----- |
| id | INTEGER PK | Auto-increment |
| worker_id | INTEGER FK | References workers(id) |
| document_type | TEXT NOT NULL | work_permit / visit_pass / certification / photo / other |
| r2_key | TEXT NOT NULL | R2 object key |
| original_name | TEXT | |
| mime_type | TEXT | |
| file_size | INTEGER | |
| created_at | TEXT | Auto |

## Setup & Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) installed and authenticated
- Google Cloud Vision API key (for OCR)
- Google Sheets API key + Sheet ID (for sync)

### 1. Set Wrangler Secrets

```bash
wrangler secret put GOOGLE_VISION_API_KEY
wrangler secret put GOOGLE_SHEETS_API_KEY
wrangler secret put GOOGLE_SHEET_ID
```

### 2. Run Database Migrations

```bash
# Remote (production)
wrangler d1 migrations apply workpass-cert-db --remote

# Local (development)
wrangler d1 migrations apply workpass-cert-db --local
```

### 3. Seed Database (optional)

```bash
wrangler d1 execute workpass-cert-db --file=./database/seed.sql --local
```

### 4. Local Development

```bash
npm run dev:worker     # Start Worker API on :8787
npm run dev:frontend   # Start frontend on :8080
```

### 5. Deploy

```bash
npm run deploy:worker    # Deploy Worker to Cloudflare
npm run deploy:frontend  # Deploy frontend to Cloudflare Pages
```

## Cloudflare Bindings

| Binding | Type | Resource |
| ------- | ---- | -------- |
| DB | D1 | workpass-cert-db |
| BUCKET | R2 | workpass-cert-files |
| GOOGLE_VISION_API_KEY | Secret | Google Cloud Vision API key |
| GOOGLE_SHEETS_API_KEY | Secret | Google Sheets API key |
| GOOGLE_SHEET_ID | Secret | Target spreadsheet ID |

## Security

- R2 files are **NOT** publicly accessible — all access goes through the Worker
- File type validation on upload (images, PDF, Word only)
- Google API keys stored as Wrangler secrets (not in source code)
- CORS restricted to the Pages domain in production

## License

MIT
