-- ============================================================
-- WorkPass Cert Manager — Database Schema
-- Cloudflare D1 (SQLite-compatible)
-- ============================================================

-- Workers (Work Permit holders)
CREATE TABLE IF NOT EXISTS workers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fin             TEXT NOT NULL UNIQUE,              -- Foreign Identification Number
    name            TEXT NOT NULL,
    work_permit_no  TEXT UNIQUE,
    employer        TEXT,
    sector          TEXT,
    nationality     TEXT,
    date_of_birth   TEXT,                              -- ISO 8601 date string
    occupation      TEXT,
    permit_status   TEXT DEFAULT 'active',             -- active | expired | cancelled
    issue_date      TEXT,
    expiry_date     TEXT,
    photo_key       TEXT,                              -- R2 object key for photo
    remarks         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Certificates (Trade Certificates, safety certs, etc.)
CREATE TABLE IF NOT EXISTS certificates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       INTEGER NOT NULL,
    cert_type       TEXT NOT NULL,                     -- e.g. coretrade, myw, safety
    cert_number     TEXT,
    cert_name       TEXT NOT NULL,
    issuing_body    TEXT,
    issue_date      TEXT,
    expiry_date     TEXT,
    cert_status     TEXT DEFAULT 'valid',              -- valid | expired | revoked
    file_key        TEXT,                              -- R2 object key for cert file
    remarks         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- Upload log (tracks all files stored in R2)
CREATE TABLE IF NOT EXISTS uploads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_key        TEXT NOT NULL UNIQUE,              -- R2 object key
    original_name   TEXT NOT NULL,
    mime_type       TEXT,
    file_size       INTEGER,                           -- bytes
    uploaded_by     TEXT,
    entity_type     TEXT,                              -- worker | certificate
    entity_id       INTEGER,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workers_fin ON workers(fin);
CREATE INDEX IF NOT EXISTS idx_workers_permit ON workers(work_permit_no);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(permit_status);
CREATE INDEX IF NOT EXISTS idx_certificates_worker ON certificates(worker_id);
CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(cert_type);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(cert_status);
CREATE INDEX IF NOT EXISTS idx_uploads_entity ON uploads(entity_type, entity_id);
