-- Migration: Add Work Permit Expiry Date to workers table
-- This date is captured from the Work Permit card (front/back)
-- Stores the expiry/validity date of the work permit itself

ALTER TABLE workers ADD COLUMN wp_expiry_date TEXT;
