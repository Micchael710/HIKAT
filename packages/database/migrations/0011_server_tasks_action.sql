-- Migration 0011: Add action column to server_tasks (Phase 07 Hardening)

ALTER TABLE `server_tasks` ADD COLUMN `action` text;
