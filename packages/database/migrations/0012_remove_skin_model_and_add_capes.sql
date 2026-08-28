-- Migration 0012: Remove model column from skins and player_skins, and add capes domain tables
-- Note: D1-safe migration. Foreign keys remain active throughout migration without disabling foreign key checks.
-- Existing player_skin_selections are safely backed up and restored to preserve GLOBAL selections referencing skins.

-- 1. Backup player_skin_selections to temporary staging table
CREATE TABLE `player_skin_selections_backup` (
	`user_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`skin_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `player_skin_selections_backup` (`user_id`, `type`, `skin_id`, `updated_at`)
SELECT `user_id`, `type`, `skin_id`, `updated_at` FROM `player_skin_selections`;
--> statement-breakpoint

-- 2. Recreate skins without model column
CREATE TABLE `skins_new` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`media_id` text NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "skins_status_check" CHECK("skins_new"."status" IN ('AVAILABLE', 'UNAVAILABLE')),
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `skins_new` (`id`, `name`, `media_id`, `status`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, `name`, `media_id`, `status`, `created_by`, `created_at`, `updated_at` FROM `skins`;
--> statement-breakpoint
DROP TABLE `skins`;
--> statement-breakpoint
ALTER TABLE `skins_new` RENAME TO `skins`;
--> statement-breakpoint
CREATE INDEX `skins_status_idx` ON `skins` (`status`);
--> statement-breakpoint
CREATE INDEX `skins_created_by_idx` ON `skins` (`created_by`);
--> statement-breakpoint
CREATE INDEX `skins_media_id_idx` ON `skins` (`media_id`);
--> statement-breakpoint

-- 3. Recreate player_skins without model column
CREATE TABLE `player_skins_new` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`media_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `player_skins_new` (`id`, `user_id`, `media_id`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `media_id`, `created_at`, `updated_at` FROM `player_skins`;
--> statement-breakpoint
DROP TABLE `player_skins`;
--> statement-breakpoint
ALTER TABLE `player_skins_new` RENAME TO `player_skins`;
--> statement-breakpoint
CREATE UNIQUE INDEX `player_skins_user_id_idx` ON `player_skins` (`user_id`);
--> statement-breakpoint
CREATE INDEX `player_skins_media_id_idx` ON `player_skins` (`media_id`);
--> statement-breakpoint

-- 4. Restore player_skin_selections from backup staging table
DELETE FROM `player_skin_selections`;
--> statement-breakpoint
INSERT INTO `player_skin_selections` (`user_id`, `type`, `skin_id`, `updated_at`)
SELECT `user_id`, `type`, `skin_id`, `updated_at` FROM `player_skin_selections_backup`;
--> statement-breakpoint
DROP TABLE `player_skin_selections_backup`;
--> statement-breakpoint

-- 5. Create capes table (Global admin catalog)
CREATE TABLE `capes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`media_id` text NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "capes_status_check" CHECK("capes"."status" IN ('AVAILABLE', 'UNAVAILABLE')),
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `capes_status_idx` ON `capes` (`status`);
--> statement-breakpoint
CREATE INDEX `capes_created_by_idx` ON `capes` (`created_by`);
--> statement-breakpoint
CREATE INDEX `capes_media_id_idx` ON `capes` (`media_id`);
--> statement-breakpoint

-- 6. Create player_capes table (Player personal custom capes)
CREATE TABLE `player_capes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`media_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `player_capes_user_id_idx` ON `player_capes` (`user_id`);
--> statement-breakpoint
CREATE INDEX `player_capes_media_id_idx` ON `player_capes` (`media_id`);
--> statement-breakpoint

-- 7. Create player_cape_selections table (Player active cape selection)
CREATE TABLE `player_cape_selections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'NONE' NOT NULL,
	`cape_id` text,
	`player_cape_id` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "player_cape_selections_type_check" CHECK(
		(`type` = 'NONE' AND `cape_id` IS NULL AND `player_cape_id` IS NULL)
		OR
		(`type` = 'GLOBAL' AND `cape_id` IS NOT NULL AND `player_cape_id` IS NULL)
		OR
		(`type` = 'CUSTOM' AND `cape_id` IS NULL AND `player_cape_id` IS NOT NULL)
	),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cape_id`) REFERENCES `capes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_cape_id`) REFERENCES `player_capes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `player_cape_selections_cape_id_idx` ON `player_cape_selections` (`cape_id`);
--> statement-breakpoint
CREATE INDEX `player_cape_selections_player_cape_id_idx` ON `player_cape_selections` (`player_cape_id`);
