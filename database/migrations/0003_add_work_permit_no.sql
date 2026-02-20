-- Migration: Add work_permit_no column to workers table
-- Work Permit No is a separate field from FIN (Foreign Identification Number)
-- FIN: G6550858W (letter + 7 digits + letter) — unique identifier
-- Work Permit No: 034773262 (digits only) — from front of card

ALTER TABLE workers ADD COLUMN work_permit_no TEXT;

-- Create index for work permit number lookups
CREATE INDEX IF NOT EXISTS idx_workers_work_permit_no ON workers(work_permit_no);
