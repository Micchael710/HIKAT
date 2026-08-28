-- Migration 0014: Mod Providers Metadata (Shard 08B)
-- Adds nullable provider metadata tracking to game_release_files for Modrinth / CurseForge integration.

ALTER TABLE `game_release_files` ADD COLUMN `source_provider` text;
--> statement-breakpoint
ALTER TABLE `game_release_files` ADD COLUMN `source_project_id` text;
--> statement-breakpoint
ALTER TABLE `game_release_files` ADD COLUMN `source_version_id` text;
--> statement-breakpoint
ALTER TABLE `game_release_files` ADD COLUMN `source_file_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `game_release_files_source_idx` ON `game_release_files` (`source_provider`, `source_project_id`);
