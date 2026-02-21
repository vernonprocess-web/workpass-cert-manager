-- Migration: Add IC (Identity Card) fields to workers table
-- race: e.g. "CHINESE", "MALAY", "INDIAN", "EURASIAN"
-- address: residential address from back of IC
-- country_of_birth: "Country/Place of birth" field from IC front

ALTER TABLE workers ADD COLUMN race TEXT;
ALTER TABLE workers ADD COLUMN address TEXT;
ALTER TABLE workers ADD COLUMN country_of_birth TEXT;
