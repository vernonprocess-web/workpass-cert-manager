-- ============================================================
-- Migration 0001: Initial Schema
-- Run with: wrangler d1 execute workpass-cert-db --file=./database/migrations/0001_initial.sql
-- ============================================================

-- Workers (Work Permit holders)
CREATE TABLE IF NOT EXISTS workers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fin             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    work_permit_no  TEXT UNIQUE,
    employer        TEXT,
    sector          TEXT,
    nationality     TEXT,
    date_of_birth   TEXT,
    occupation      TEXT,
    permit_status   TEXT DEFAULT 'active',
    issue_date      TEXT,
    expiry_date     TEXT,
    photo_key       TEXT,
    remarks         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Certificates
CREATE TABLE IF NOT EXISTS certificates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       INTEGER NOT NULL,
    cert_type       TEXT NOT NULL,
    cert_number     TEXT,
    cert_name       TEXT NOT NULL,
    issuing_body    TEXT,
    issue_date      TEXT,
    expiry_date     TEXT,
    cert_status     TEXT DEFAULT 'valid',
    file_key        TEXT,
    remarks         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- Uploads
CREATE TABLE IF NOT EXISTS uploads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_key        TEXT NOT NULL UNIQUE,
    original_name   TEXT NOT NULL,
    mime_type       TEXT,
    file_size       INTEGER,
    uploaded_by     TEXT,
    entity_type     TEXT,
    entity_id       INTEGER,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_workers_fin ON workers(fin);
CREATE INDEX IF NOT EXISTS idx_workers_permit ON workers(work_permit_no);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(permit_status);
CREATE INDEX IF NOT EXISTS idx_certificates_worker ON certificates(worker_id);
CREATE INDEX IF NOT EXISTS idx_certificates_type ON certificates(cert_type);
CREATE INDEX IF NOT EXISTS idx_certificates_status ON certificates(cert_status);
CREATE INDEX IF NOT EXISTS idx_uploads_entity ON uploads(entity_type, entity_id);
