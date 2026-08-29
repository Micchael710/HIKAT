-- HiKAT D1 Database Migration: 0017_server_managed_content.sql
-- Adds server_managed_content and server_release_syncs for Shard 08D (Server Content & Release Sync)

CREATE TABLE `server_managed_content` (
  `id` text PRIMARY KEY NOT NULL,
  `management_source` text NOT NULL,
  `provider` text,
  `project_id` text,
  `version_id` text,
  `file_id` text,
  `content_type` text NOT NULL DEFAULT 'MOD',
  `environment` text,
  `target_path` text NOT NULL,
  `sha256` text NOT NULL,
  `size_bytes` integer NOT NULL DEFAULT 0,
  `game_release_id` text REFERENCES `game_releases`(`id`) ON DELETE set null,
  `game_release_file_id` text REFERENCES `game_release_files`(`id`) ON DELETE set null,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_managed_content_source_idx` ON `server_managed_content` (`management_source`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_provider_project_idx` ON `server_managed_content` (`provider`, `project_id`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_target_path_idx` ON `server_managed_content` (`target_path`);
--> statement-breakpoint
CREATE INDEX `server_managed_content_game_release_idx` ON `server_managed_content` (`game_release_id`, `game_release_file_id`);
--> statement-breakpoint
CREATE TABLE `server_release_syncs` (
  `id` text PRIMARY KEY NOT NULL,
  `release_id` text NOT NULL REFERENCES `game_releases`(`id`) ON DELETE cascade,
  `status` text NOT NULL DEFAULT 'PENDING',
  `applied_at` text,
  `details` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `server_release_syncs_release_id_idx` ON `server_release_syncs` (`release_id`);
--> statement-breakpoint
CREATE INDEX `server_release_syncs_status_idx` ON `server_release_syncs` (`status`);
