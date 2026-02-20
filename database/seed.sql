-- ============================================================
-- Seed Data — Sample records for development & testing
-- Run with: wrangler d1 execute workpass-cert-db --file=./database/seed.sql --local
-- ============================================================

INSERT OR IGNORE INTO workers (fin_number, worker_name, date_of_birth, nationality, sex, employer_name)
VALUES
    ('G1234567A', 'RAJAN KUMAR', '1990-05-15', 'INDIAN', 'M', 'ABC CONSTRUCTION PTE LTD'),
    ('G2345678B', 'MD ALAM HOSSAIN', '1988-11-20', 'BANGLADESHI', 'M', 'XYZ ENGINEERING PTE LTD'),
    ('G3456789C', 'LI WEI CHEN', '1992-03-08', 'CHINESE', 'M', 'GREATWALL BUILDERS PTE LTD'),
    ('G4567890D', 'ARJUN THAPA', '1995-07-22', 'NEPALESE', 'M', 'SUMMIT CONSTRUCTION PTE LTD'),
    ('G5678901E', 'NGUYEN VAN TUAN', '1991-09-12', 'VIETNAMESE', 'M', 'DELTA MARINE PTE LTD');

INSERT OR IGNORE INTO certifications (worker_id, course_title, course_provider, issue_date, expiry_date)
VALUES
    (1, 'CoreTrade for Concreting', 'BCA', '2025-01-15', '2028-01-14'),
    (1, 'Construction Safety Orientation Course', 'SCAL', '2025-01-12', '2027-01-11'),
    (2, 'CoreTrade for Welding', 'BCA', '2024-06-10', '2027-06-09'),
    (3, 'Construction Safety Orientation Course', 'SCAL', '2025-03-20', '2027-03-19'),
    (4, 'CoreTrade for Scaffolding', 'BCA', '2023-02-01', '2026-01-31'),
    (5, 'Marine Safety Induction', 'SSA', '2025-02-05', '2027-02-04');
