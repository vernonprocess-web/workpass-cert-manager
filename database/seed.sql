-- ============================================================
-- Seed Data — Sample records for development & testing
-- Run with: wrangler d1 execute workpass-cert-db --file=./database/seed.sql --local
-- ============================================================

INSERT OR IGNORE INTO workers (fin, name, work_permit_no, employer, sector, nationality, date_of_birth, occupation, permit_status, issue_date, expiry_date)
VALUES
    ('G1234567A', 'RAJAN KUMAR', 'WP1234567', 'ABC CONSTRUCTION PTE LTD', 'Construction', 'Indian', '1990-05-15', 'General Worker', 'active', '2025-01-10', '2027-01-09'),
    ('G2345678B', 'MD ALAM HOSSAIN', 'WP2345678', 'XYZ ENGINEERING PTE LTD', 'Construction', 'Bangladeshi', '1988-11-20', 'Welder', 'active', '2024-06-01', '2026-05-31'),
    ('G3456789C', 'LI WEI CHEN', 'WP3456789', 'GREATWALL BUILDERS PTE LTD', 'Construction', 'Chinese', '1992-03-08', 'Carpenter', 'active', '2025-03-15', '2027-03-14'),
    ('G4567890D', 'ARJUN THAPA', 'WP4567890', 'SUMMIT CONSTRUCTION PTE LTD', 'Construction', 'Nepalese', '1995-07-22', 'Scaffolder', 'expired', '2023-01-01', '2025-01-01'),
    ('G5678901E', 'NGUYEN VAN TUAN', 'WP5678901', 'DELTA MARINE PTE LTD', 'Marine', 'Vietnamese', '1991-09-12', 'Fitter', 'active', '2025-02-01', '2027-01-31');

INSERT OR IGNORE INTO certificates (worker_id, cert_type, cert_number, cert_name, issuing_body, issue_date, expiry_date, cert_status)
VALUES
    (1, 'coretrade', 'CT-2025-001', 'CoreTrade for Concreting', 'BCA', '2025-01-15', '2028-01-14', 'valid'),
    (1, 'safety', 'SAF-2025-001', 'Construction Safety Orientation Course', 'SCAL', '2025-01-12', '2027-01-11', 'valid'),
    (2, 'coretrade', 'CT-2024-055', 'CoreTrade for Welding', 'BCA', '2024-06-10', '2027-06-09', 'valid'),
    (2, 'myw', 'MYW-2024-100', 'Multi-Year Work Permit', 'MOM', '2024-06-01', '2028-05-31', 'valid'),
    (3, 'safety', 'SAF-2025-010', 'Construction Safety Orientation Course', 'SCAL', '2025-03-20', '2027-03-19', 'valid'),
    (4, 'coretrade', 'CT-2023-030', 'CoreTrade for Scaffolding', 'BCA', '2023-02-01', '2026-01-31', 'expired'),
    (5, 'safety', 'SAF-2025-022', 'Marine Safety Induction', 'SSA', '2025-02-05', '2027-02-04', 'valid');
