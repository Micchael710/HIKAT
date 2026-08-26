CREATE TABLE `skins` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`model` text DEFAULT 'CLASSIC' NOT NULL,
	`media_id` text NOT NULL,
	`status` text DEFAULT 'AVAILABLE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "skins_model_check" CHECK("skins"."model" IN ('CLASSIC', 'SLIM')),
	CONSTRAINT "skins_status_check" CHECK("skins"."status" IN ('AVAILABLE', 'UNAVAILABLE')),
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `skins_status_idx` ON `skins` (`status`);
--> statement-breakpoint
CREATE INDEX `skins_created_by_idx` ON `skins` (`created_by`);
--> statement-breakpoint
CREATE INDEX `skins_media_id_idx` ON `skins` (`media_id`);
--> statement-breakpoint
CREATE TABLE `game_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL UNIQUE,
	`minecraft_version` text DEFAULT '1.21.1' NOT NULL,
	`neoforge_version` text DEFAULT '21.1.65' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`published_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "game_releases_status_check" CHECK("game_releases"."status" IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_releases_status_idx` ON `game_releases` (`status`);
--> statement-breakpoint
CREATE INDEX `game_releases_published_at_idx` ON `game_releases` (`published_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_releases_single_published_idx` ON `game_releases` (`status`) WHERE `status` = 'PUBLISHED';
--> statement-breakpoint
CREATE TABLE `game_release_files` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`name` text NOT NULL,
	`logical_path` text NOT NULL,
	`category` text DEFAULT 'MOD' NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`policy` text DEFAULT 'NO_MODIFICABLE' NOT NULL,
	`object_key` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "game_release_files_category_check" CHECK("game_release_files"."category" IN ('MOD', 'RESOURCE_PACK', 'SHADER_PACK', 'KUBEJS', 'SCRIPT')),
	CONSTRAINT "game_release_files_policy_check" CHECK("game_release_files"."policy" IN ('NO_MODIFICABLE', 'MODIFICABLE')),
	FOREIGN KEY (`release_id`) REFERENCES `game_releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `game_release_files_release_id_idx` ON `game_release_files` (`release_id`);
--> statement-breakpoint
CREATE INDEX `game_release_files_category_idx` ON `game_release_files` (`category`);
--> statement-breakpoint
CREATE INDEX `game_release_files_sha256_idx` ON `game_release_files` (`sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_release_files_release_path_idx` ON `game_release_files` (`release_id`, `logical_path`);
--> statement-breakpoint
CREATE TABLE `game_file_upload_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`category` text DEFAULT 'MOD' NOT NULL,
	`original_filename` text NOT NULL,
	`expected_size_bytes` integer NOT NULL,
	`sha256` text,
	`object_key` text,
	`uploaded_size_bytes` integer,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "game_file_upload_tokens_category_check" CHECK("game_file_upload_tokens"."category" IN ('MOD', 'RESOURCE_PACK', 'SHADER_PACK', 'KUBEJS', 'SCRIPT')),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint
CREATE INDEX `game_file_upload_tokens_token_hash_idx` ON `game_file_upload_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `game_file_upload_tokens_created_by_idx` ON `game_file_upload_tokens` (`created_by`);
--> statement-breakpoint
CREATE TABLE `project_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_name` text DEFAULT 'HiKAT' NOT NULL,
	`maintenance_enabled` integer DEFAULT 0 NOT NULL,
	`maintenance_message` text DEFAULT 'Servidor en mantenimiento programado. Volvemos pronto.' NOT NULL,
	`server_ip` text DEFAULT 'mc.hikat.org' NOT NULL,
	`server_port` integer DEFAULT 25565 NOT NULL,
	`discord_url` text,
	`website_url` text,
	`min_ram_gb` integer DEFAULT 4 NOT NULL,
	`recommended_ram_gb` integer DEFAULT 8 NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `project_settings` (
	`id`,
	`project_name`,
	`maintenance_enabled`,
	`maintenance_message`,
	`server_ip`,
	`server_port`,
	`discord_url`,
	`website_url`,
	`min_ram_gb`,
	`recommended_ram_gb`,
	`updated_at`
) VALUES (
	'main',
	'HiKAT',
	0,
	'Servidor en mantenimiento programado. Volvemos pronto.',
	'mc.hikat.org',
	25565,
	'https://discord.gg/hikat',
	'https://hikat.org',
	4,
	8,
	CURRENT_TIMESTAMP
);
