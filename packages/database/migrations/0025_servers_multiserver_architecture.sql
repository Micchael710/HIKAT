-- HiKAT D1 Database Migration: 0025_servers_multiserver_architecture.sql
-- Implements multi-server architecture with server-scoped releases, news, tokens, tasks, managed content, and tickets.

CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`minecraft_version` text DEFAULT '1.21.1' NOT NULL,
	`mod_loader` text DEFAULT 'NEOFORGE' NOT NULL,
	`mod_loader_version` text,
	`main_logo_media_id` text,
	`sidebar_logo_media_id` text,
	`accent_color` text,
	`cpu` integer DEFAULT 200 NOT NULL,
	`memory_mb` integer DEFAULT 4096 NOT NULL,
	`disk_mb` integer DEFAULT 10240 NOT NULL,
	`provisioning_status` text DEFAULT 'PROVISIONING' NOT NULL,
	`pterodactyl_server_id` text,
	`pterodactyl_identifier` text,
	`launcher_active_release_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "servers_mod_loader_check" CHECK("mod_loader" IN ('VANILLA', 'NEOFORGE', 'FORGE', 'FABRIC', 'QUILT')),
	CONSTRAINT "servers_provisioning_status_check" CHECK("provisioning_status" IN ('PROVISIONING', 'READY', 'FAILED')),
	FOREIGN KEY (`main_logo_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sidebar_logo_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_name_nocase_idx` ON `servers` (lower(`name`));
--> statement-breakpoint
CREATE INDEX `servers_provisioning_status_idx` ON `servers` (`provisioning_status`);
--> statement-breakpoint
CREATE INDEX `servers_launcher_active_release_id_idx` ON `servers` (`launcher_active_release_id`);
--> statement-breakpoint
CREATE TABLE `game_releases_new` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text,
	`version` text NOT NULL,
	`minecraft_version` text DEFAULT '1.21.1' NOT NULL,
	`mod_loader` text DEFAULT 'NEOFORGE' NOT NULL,
	`mod_loader_version` text,
	`neoforge_version` text DEFAULT '21.1.65' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`cover_media_id` text,
	`published_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "game_releases_status_check" CHECK("status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cover_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `game_releases_new` (`id`, `version`, `minecraft_version`, `mod_loader`, `mod_loader_version`, `neoforge_version`, `status`, `notes`, `cover_media_id`, `published_at`, `created_by`, `created_at`, `updated_at`)
SELECT `id`, `version`, `minecraft_version`, `mod_loader`, `mod_loader_version`, `neoforge_version`, `status`, `notes`, `cover_media_id`, `published_at`, `created_by`, `created_at`, `updated_at` FROM `game_releases`;
--> statement-breakpoint
DROP TABLE `game_releases`;
--> statement-breakpoint
ALTER TABLE `game_releases_new` RENAME TO `game_releases`;
--> statement-breakpoint
CREATE INDEX `game_releases_server_id_idx` ON `game_releases` (`server_id`);
--> statement-breakpoint
CREATE INDEX `game_releases_status_idx` ON `game_releases` (`status`);
--> statement-breakpoint
CREATE INDEX `game_releases_published_at_idx` ON `game_releases` (`published_at`);
--> statement-breakpoint
CREATE INDEX `game_releases_cover_media_id_idx` ON `game_releases` (`cover_media_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_releases_server_version_idx` ON `game_releases` (COALESCE(`server_id`, ''), `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_releases_server_published_idx` ON `game_releases` (COALESCE(`server_id`, ''), `status`) WHERE `status` = 'PUBLISHED';
--> statement-breakpoint
ALTER TABLE `game_file_upload_tokens` ADD COLUMN `server_id` text REFERENCES `servers`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX `game_file_upload_tokens_server_id_idx` ON `game_file_upload_tokens` (`server_id`);
--> statement-breakpoint
ALTER TABLE `news` ADD COLUMN `server_id` text REFERENCES `servers`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX `news_server_id_idx` ON `news` (`server_id`);
--> statement-breakpoint
ALTER TABLE `server_console_tickets` ADD COLUMN `server_id` text REFERENCES `servers`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX `server_console_tickets_server_id_idx` ON `server_console_tickets` (`server_id`);
--> statement-breakpoint
ALTER TABLE `server_tasks` ADD COLUMN `server_id` text REFERENCES `servers`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
DROP INDEX IF EXISTS `server_tasks_schedule_id_idx`;
--> statement-breakpoint
CREATE INDEX `server_tasks_server_id_idx` ON `server_tasks` (`server_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_tasks_server_schedule_id_idx` ON `server_tasks` (COALESCE(`server_id`, ''), `schedule_id`);
--> statement-breakpoint
ALTER TABLE `server_managed_content` ADD COLUMN `server_id` text REFERENCES `servers`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX `server_managed_content_server_id_idx` ON `server_managed_content` (`server_id`);
