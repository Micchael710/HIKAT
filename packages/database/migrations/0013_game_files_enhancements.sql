-- Migration 0013: Game Files Enhancements (Shard 08A)
-- Updates game_release_files to support nullable policy (for inheritance) and is_directory flag.
-- Safely recreates table while preserving all existing releases and file records with explicit policies.

CREATE TABLE `game_release_files_new` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`name` text NOT NULL,
	`logical_path` text NOT NULL,
	`category` text DEFAULT 'GENERAL' NOT NULL,
	`sha256` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`policy` text,
	`is_directory` integer DEFAULT 0 NOT NULL,
	`object_key` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `game_releases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `game_release_files_new` (`id`, `release_id`, `name`, `logical_path`, `category`, `sha256`, `size_bytes`, `policy`, `is_directory`, `object_key`, `created_at`)
SELECT `id`, `release_id`, `name`, `logical_path`, `category`, `sha256`, `size_bytes`, `policy`, 0, `object_key`, `created_at`
FROM `game_release_files`;
--> statement-breakpoint
DROP TABLE `game_release_files`;
--> statement-breakpoint
ALTER TABLE `game_release_files_new` RENAME TO `game_release_files`;
--> statement-breakpoint
CREATE INDEX `game_release_files_release_id_idx` ON `game_release_files` (`release_id`);
--> statement-breakpoint
CREATE INDEX `game_release_files_category_idx` ON `game_release_files` (`category`);
--> statement-breakpoint
CREATE INDEX `game_release_files_sha256_idx` ON `game_release_files` (`sha256`);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_release_files_release_path_idx` ON `game_release_files` (`release_id`, `logical_path`);
