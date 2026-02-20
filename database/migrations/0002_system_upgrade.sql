-- ============================================================
-- Migration 0002: System Upgrade
-- Restructure schema for OCR-driven WorkPass & Cert Manager
-- Run: wrangler d1 execute workpass-cert-db --file=./database/migrations/0002_system_upgrade.sql --remote
-- ============================================================

-- Step 1: Create new workers table with updated schema
CREATE TABLE IF NOT EXISTS workers_new (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    fin_number      TEXT NOT NULL UNIQUE,
    worker_name     TEXT NOT NULL,
    date_of_birth   TEXT,
    nationality     TEXT,
    sex             TEXT,
    employer_name   TEXT,
    photo_key       TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
);

-- Step 2: Migrate existing worker data into new table
INSERT OR IGNORE INTO workers_new (id, fin_number, worker_name, date_of_birth, nationality, employer_name, photo_key, created_at, updated_at)
SELECT id, fin, name, date_of_birth, nationality, employer, photo_key, created_at, updated_at
FROM workers;

-- Step 3: Drop old tables
DROP TABLE IF EXISTS certificates;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS workers;

-- Step 4: Rename new workers table
ALTER TABLE workers_new RENAME TO workers;

-- Step 5: Create certifications table
CREATE TABLE IF NOT EXISTS certifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       INTEGER NOT NULL,
    course_title    TEXT NOT NULL,
    course_provider TEXT,
    issue_date      TEXT,
    expiry_date     TEXT,
    file_key        TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- Step 6: Create documents table
CREATE TABLE IF NOT EXISTS documents (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id       INTEGER,
    document_type   TEXT NOT NULL,
    r2_key          TEXT NOT NULL,
    original_name   TEXT,
    mime_type       TEXT,
    file_size       INTEGER,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL
);

-- Step 7: Indexes
CREATE INDEX IF NOT EXISTS idx_workers_fin_number ON workers(fin_number);
CREATE INDEX IF NOT EXISTS idx_certifications_worker ON certifications(worker_id);
CREATE INDEX IF NOT EXISTS idx_certifications_expiry ON certifications(expiry_date);
CREATE INDEX IF NOT EXISTS idx_documents_worker ON documents(worker_id);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(document_type);
