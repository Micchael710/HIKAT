-- Migration 0029: Add launcher_releases and launcher_upload_tickets tables for self-updater
CREATE TABLE `launcher_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`filename` text NOT NULL,
	`object_key` text NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha512` text NOT NULL,
	`notes` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launcher_releases_version_unique` ON `launcher_releases` (`version`);
--> statement-breakpoint
CREATE INDEX `launcher_releases_status_idx` ON `launcher_releases` (`status`);
--> statement-breakpoint
CREATE INDEX `launcher_releases_filename_idx` ON `launcher_releases` (`filename`);
--> statement-breakpoint
CREATE INDEX `launcher_releases_created_by_idx` ON `launcher_releases` (`created_by`);
--> statement-breakpoint
CREATE TABLE `launcher_upload_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`version` text NOT NULL,
	`filename` text NOT NULL,
	`declared_size_bytes` integer NOT NULL,
	`sha512` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `launcher_upload_tickets_token_hash_unique` ON `launcher_upload_tickets` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `launcher_upload_tickets_created_by_idx` ON `launcher_upload_tickets` (`created_by`);
--> statement-breakpoint
CREATE INDEX `launcher_upload_tickets_token_hash_idx` ON `launcher_upload_tickets` (`token_hash`);
