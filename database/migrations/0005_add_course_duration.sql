-- Migration: Add course_duration column to certifications table
-- Duration of the course, e.g. "18 Hours", "41-100 Hours"

ALTER TABLE certifications ADD COLUMN course_duration TEXT;
