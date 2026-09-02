-- HiKAT D1 Database Migration: 0021_generic_mod_loader.sql
-- Adds generic mod_loader and mod_loader_version to game_releases.
-- Backwards-compatible: neoforge_version is NOT dropped.
-- All existing rows are backfilled as NEOFORGE.

ALTER TABLE `game_releases` ADD `mod_loader` text NOT NULL DEFAULT 'NEOFORGE';
--> statement-breakpoint
ALTER TABLE `game_releases` ADD `mod_loader_version` text;
--> statement-breakpoint
UPDATE `game_releases` SET `mod_loader` = 'NEOFORGE', `mod_loader_version` = `neoforge_version`;