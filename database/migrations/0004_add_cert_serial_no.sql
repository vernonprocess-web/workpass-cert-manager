-- Migration: Add cert_serial_no column to certifications table
-- Serial Number (S/N) for certification tracking, e.g. WAHRC-2025-B134P-659

ALTER TABLE certifications ADD COLUMN cert_serial_no TEXT;
