-- Migration 0007: Back Office Core Hardening - ISO-8601 Timestamp Normalization

UPDATE `project_settings`
SET `updated_at` = REPLACE(`updated_at`, ' ', 'T') || CASE WHEN `updated_at` LIKE '%Z' THEN '' ELSE 'Z' END
WHERE `updated_at` NOT LIKE '%T%';
