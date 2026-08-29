-- HiKAT D1 Database Migration: 0016_game_release_cover_media.sql
-- Adds cover_media_id column with foreign key to content_media and corresponding index (Shard 08C)

ALTER TABLE `game_releases` ADD COLUMN `cover_media_id` text REFERENCES `content_media`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `game_releases_cover_media_id_idx` ON `game_releases` (`cover_media_id`);
