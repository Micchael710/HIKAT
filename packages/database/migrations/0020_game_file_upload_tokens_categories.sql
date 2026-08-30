-- HiKAT D1 Database Migration: 0020_game_file_upload_tokens_categories.sql
-- Updates CHECK constraint on game_file_upload_tokens to support all 8 allowed categories:
-- MOD, RESOURCE_PACK, DATA_PACK, SHADER_PACK, KUBEJS, SCRIPT, CONFIG, GENERAL

CREATE TABLE `game_file_upload_tokens_new` (
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
	CONSTRAINT "game_file_upload_tokens_category_check" CHECK("category" IN ('MOD', 'RESOURCE_PACK', 'DATA_PACK', 'SHADER_PACK', 'KUBEJS', 'SCRIPT', 'CONFIG', 'GENERAL')),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `game_file_upload_tokens_new` (`id`, `token_hash`, `category`, `original_filename`, `expected_size_bytes`, `sha256`, `object_key`, `uploaded_size_bytes`, `created_by`, `expires_at`, `used_at`, `created_at`)
SELECT `id`, `token_hash`, `category`, `original_filename`, `expected_size_bytes`, `sha256`, `object_key`, `uploaded_size_bytes`, `created_by`, `expires_at`, `used_at`, `created_at` FROM `game_file_upload_tokens`;
--> statement-breakpoint
DROP TABLE `game_file_upload_tokens`;
--> statement-breakpoint
ALTER TABLE `game_file_upload_tokens_new` RENAME TO `game_file_upload_tokens`;
--> statement-breakpoint
CREATE INDEX `game_file_upload_tokens_token_hash_idx` ON `game_file_upload_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `game_file_upload_tokens_created_by_idx` ON `game_file_upload_tokens` (`created_by`);
