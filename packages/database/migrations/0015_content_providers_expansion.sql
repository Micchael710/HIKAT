-- HiKAT D1 Database Migration: 0015_content_providers_expansion.sql
-- Adds source_environment column to game_release_files to preserve mod environment distribution sides

ALTER TABLE `game_release_files` ADD COLUMN `source_environment` text;
