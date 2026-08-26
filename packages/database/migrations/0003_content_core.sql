CREATE TABLE `content_media` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_media_mime_type_check" CHECK("content_media"."mime_type" IN ('image/png', 'image/jpeg', 'image/webp'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_media_object_key_idx` ON `content_media` (`object_key`);--> statement-breakpoint
CREATE INDEX `content_media_created_by_idx` ON `content_media` (`created_by`);--> statement-breakpoint
CREATE TABLE `content_media_upload_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`expected_mime_type` text NOT NULL,
	`max_size_bytes` integer NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_media_upload_tokens_token_hash_idx` ON `content_media_upload_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `content_media_upload_tokens_created_by_idx` ON `content_media_upload_tokens` (`created_by`);--> statement-breakpoint
CREATE TABLE `content_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`body_markdown` text NOT NULL,
	`cover_media_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`published_at` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`cover_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "content_posts_kind_check" CHECK("content_posts"."kind" IN ('NEWS', 'ANNOUNCEMENT')),
	CONSTRAINT "content_posts_status_check" CHECK("content_posts"."status" IN ('DRAFT', 'PUBLISHED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_posts_slug_idx` ON `content_posts` (`slug`);--> statement-breakpoint
CREATE INDEX `content_posts_status_published_at_idx` ON `content_posts` (`status`, `published_at`);--> statement-breakpoint
CREATE INDEX `content_posts_kind_status_idx` ON `content_posts` (`kind`, `status`);--> statement-breakpoint
CREATE INDEX `content_posts_created_by_idx` ON `content_posts` (`created_by`);--> statement-breakpoint
CREATE INDEX `content_posts_cover_media_id_idx` ON `content_posts` (`cover_media_id`);
