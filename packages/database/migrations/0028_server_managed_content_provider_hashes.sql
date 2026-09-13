-- Migration 0028: Make server_managed_content.sha256 nullable and add provider_hash_algorithm and provider_hash
-- Safe table recreation for SQLite/Cloudflare D1 preserving existing data and indexes.

CREATE TABLE `server_managed_content_new` (
  `id` text PRIMARY KEY NOT NULL,
  `server_id` text REFERENCES `servers`(`id`) ON DELETE cascade,
  `management_source` text NOT NULL,
  `provider` text,
  `project_id` text,
  `version_id` text,
  `file_id` text,
  `content_type` text NOT NULL DEFAULT 'MOD',
  `environment` text,
  `target_path` text NOT NULL,
  `sha256` text,
  `provider_hash_algorithm` text,
  `provider_hash` text,
  `size_bytes` integer NOT NULL DEFAULT 0,
  `game_release_id` text REFERENCES `game_releases`(`id`) ON DELETE set null,
  `game_release_file_id` text REFERENCES `game_release_files`(`id`) ON DELETE set null,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `server_managed_content_new` (
  `id`,
  `server_id`,
  `management_source`,
  `provider`,
  `project_id`,
  `version_id`,
  `file_id`,
  `content_type`,
  `environment`,
  `target_path`,
  `sha256`,
  `provider_hash_algorithm`,
  `provider_hash`,
  `size_bytes`,
  `game_release_id`,
  `game_release_file_id`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `server_id`,
  `management_source`,
  `provider`,
  `project_id`,
  `version_id`,
  `file_id`,
  `content_type`,
  `environment`,
  `target_path`,
  `sha256`,
  NULL,
  NULL,
  `size_bytes`,
  `game_release_id`,
  `game_release_file_id`,
  `created_at`,
  `updated_at`
FROM `server_managed_content`;
--> statement-breakpoint
DROP TABLE `server_managed_content`;
--> statement-breakpoint
ALTER TABLE `server_managed_content_new` RENAME TO `server_managed_content`;
--> statement-breakpoint
CREATE INDEX `server_managed_content_server_id_idx` ON `server_managed_content` (`server_id`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_source_idx` ON `server_managed_content` (`management_source`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_provider_project_idx` ON `server_managed_content` (`provider`, `project_id`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_target_path_idx` ON `server_managed_content` (`target_path`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_game_release_idx` ON `server_managed_content` (`game_release_id`, `game_release_file_id`);
