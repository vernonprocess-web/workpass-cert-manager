# WorkPass Cert Manager

A full-stack application for managing **Work Permits** and **Trade Certificates** — built on the Cloudflare platform.

## Architecture

| Component       | Technology         | Description                                  |
| --------------- | ------------------ | -------------------------------------------- |
| **Frontend**    | Cloudflare Pages   | Static SPA dashboard (HTML/CSS/JS)           |
| **API Backend** | Cloudflare Workers | RESTful API handling all business logic       |
| **Database**    | Cloudflare D1      | SQLite-compatible relational data store       |
| **File Storage**| Cloudflare R2      | S3-compatible object storage for documents    |

## Folder Structure

```
workpass-cert-manager/
├── frontend/               # Cloudflare Pages — static site
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js
│   │   ├── api.js
│   │   └── router.js
│   └── pages/
│       ├── dashboard.html
│       ├── workers.html
│       ├── certificates.html
│       └── upload.html
├── worker/                 # Cloudflare Workers — API
│   ├── src/
│   │   ├── index.js        # Entry point & router
│   │   ├── routes/
│   │   │   ├── workers.js   # Work permit CRUD
│   │   │   ├── certificates.js
│   │   │   └── upload.js    # R2 upload/download
│   │   ├── middleware/
│   │   │   ├── cors.js
│   │   │   └── auth.js
│   │   └── utils/
│   │       └── response.js
│   └── package.json
├── database/               # Cloudflare D1 — schema & migrations
│   ├── schema.sql
│   ├── seed.sql
│   └── migrations/
│       └── 0001_initial.sql
├── wrangler.toml           # Cloudflare project configuration
├── package.json            # Root package.json (scripts & dev deps)
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy.yml      # GitHub Actions CI/CD
└── README.md
```

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Cloudflare account with Workers, Pages, D1, and R2 enabled

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/workpass-cert-manager.git
cd workpass-cert-manager
npm install
cd worker && npm install && cd ..
```

### 2. Authenticate with Cloudflare

```bash
wrangler login
```

### 3. Create D1 Database

```bash
wrangler d1 create workpass-cert-db
```

Copy the returned `database_id` into `wrangler.toml` under `[[d1_databases]]`.

### 4. Run Migrations

```bash
npm run db:migrate
```

### 5. Create R2 Bucket

```bash
wrangler r2 bucket create workpass-cert-files
```

### 6. Local Development

```bash
# Start the Worker API (with local D1 & R2)
npm run dev:worker

# Serve the frontend (separate terminal)
npm run dev:frontend
```

- **Frontend**: http://localhost:8080
- **Worker API**: http://localhost:8787

## Deployment

### Deploy Worker (API)

```bash
npm run deploy:worker
```

### Deploy Frontend (Pages)

```bash
npm run deploy:frontend
```

Or connect the GitHub repository to **Cloudflare Pages** in the dashboard:

1. Go to Cloudflare Dashboard → Pages → Create a project
2. Connect your GitHub repo
3. Set build output directory to `frontend/`
4. Deploy

### CI/CD (GitHub Actions)

Push to `main` to trigger automatic deployments via the included GitHub Actions workflow at `.github/workflows/deploy.yml`.

## Environment Variables

| Variable          | Description                        | Where          |
| ----------------- | ---------------------------------- | -------------- |
| `API_BASE_URL`    | Worker API URL                     | Frontend JS    |
| `AUTH_SECRET`     | Shared secret for API auth         | Worker secret  |
| `ENVIRONMENT`     | `development` or `production`      | wrangler.toml  |

Set secrets with:

```bash
wrangler secret put AUTH_SECRET
```

## API Endpoints

| Method | Endpoint                      | Description                   |
| ------ | ----------------------------- | ----------------------------- |
| GET    | `/api/workers`                | List all work permits         |
| GET    | `/api/workers/:id`            | Get a single work permit      |
| POST   | `/api/workers`                | Create a work permit          |
| PUT    | `/api/workers/:id`            | Update a work permit          |
| DELETE | `/api/workers/:id`            | Delete a work permit          |
| GET    | `/api/certificates`           | List all certificates         |
| GET    | `/api/certificates/:id`       | Get a single certificate      |
| POST   | `/api/certificates`           | Create a certificate          |
| PUT    | `/api/certificates/:id`       | Update a certificate          |
| DELETE | `/api/certificates/:id`       | Delete a certificate          |
| POST   | `/api/upload`                 | Upload a file to R2           |
| GET    | `/api/files/:key`             | Download / get file from R2   |
| DELETE | `/api/files/:key`             | Delete a file from R2         |
| GET    | `/api/stats`                  | Dashboard statistics          |

## License

MIT
