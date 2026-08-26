--> statement-breakpoint
PRAGMA foreign_keys = OFF;
--> statement-breakpoint
CREATE TABLE `content_media_new` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL UNIQUE,
	`media_type` text DEFAULT 'IMAGE' NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "content_media_media_type_check" CHECK("media_type" IN ('IMAGE', 'VIDEO')),
	CONSTRAINT "content_media_mime_type_check" CHECK("mime_type" IN ('image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm')),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `content_media_new` (`id`, `object_key`, `media_type`, `mime_type`, `size_bytes`, `created_by`, `created_at`)
SELECT
	`id`,
	`object_key`,
	CASE WHEN `mime_type` LIKE 'video/%' THEN 'VIDEO' ELSE 'IMAGE' END,
	`mime_type`,
	`size_bytes`,
	`created_by`,
	`created_at`
FROM `content_media`;
--> statement-breakpoint
DROP TABLE `content_media`;
--> statement-breakpoint
ALTER TABLE `content_media_new` RENAME TO `content_media`;
--> statement-breakpoint
CREATE INDEX `content_media_created_by_idx` ON `content_media` (`created_by`);
--> statement-breakpoint
CREATE TABLE `content_media_upload_tokens_new` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`media_type` text DEFAULT 'IMAGE' NOT NULL,
	`created_by` text NOT NULL,
	`expected_mime_type` text NOT NULL,
	`max_size_bytes` integer NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	CONSTRAINT "content_media_upload_tokens_media_type_check" CHECK("media_type" IN ('IMAGE', 'VIDEO')),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `content_media_upload_tokens_new` (`id`, `token_hash`, `media_type`, `created_by`, `expected_mime_type`, `max_size_bytes`, `expires_at`, `used_at`, `created_at`)
SELECT
	`id`,
	`token_hash`,
	'IMAGE',
	`created_by`,
	`expected_mime_type`,
	`max_size_bytes`,
	`expires_at`,
	`used_at`,
	`created_at`
FROM `content_media_upload_tokens`;
--> statement-breakpoint
DROP TABLE `content_media_upload_tokens`;
--> statement-breakpoint
ALTER TABLE `content_media_upload_tokens_new` RENAME TO `content_media_upload_tokens`;
--> statement-breakpoint
CREATE INDEX `content_media_upload_tokens_token_hash_idx` ON `content_media_upload_tokens` (`token_hash`);
--> statement-breakpoint
CREATE INDEX `content_media_upload_tokens_created_by_idx` ON `content_media_upload_tokens` (`created_by`);
--> statement-breakpoint
CREATE TABLE `news` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text NOT NULL,
	`image_media_id` text,
	`youtube_video_id` text,
	`youtube_url` text,
	`video_media_id` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`published_at` text,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "news_type_check" CHECK("news"."type" IN ('NEWS', 'UPDATE', 'ANNOUNCEMENT', 'MAINTENANCE')),
	CONSTRAINT "news_status_check" CHECK("news"."status" IN ('DRAFT', 'PUBLISHED')),
	FOREIGN KEY (`image_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`video_media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `news` (
	`id`,
	`title`,
	`content`,
	`type`,
	`image_media_id`,
	`status`,
	`published_at`,
	`created_by`,
	`updated_by`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`title`,
	COALESCE(`body_markdown`, `summary`, ''),
	CASE
		WHEN `kind` = 'ANNOUNCEMENT' THEN 'ANNOUNCEMENT'
		ELSE 'NEWS'
	END,
	`cover_media_id`,
	`status`,
	`published_at`,
	`created_by`,
	`updated_by`,
	`created_at`,
	`updated_at`
FROM `content_posts`;
--> statement-breakpoint
DROP TABLE `content_posts`;
--> statement-breakpoint
CREATE INDEX `news_status_published_at_idx` ON `news` (`status`,`published_at`);
--> statement-breakpoint
CREATE INDEX `news_type_status_idx` ON `news` (`type`,`status`);
--> statement-breakpoint
CREATE INDEX `news_created_by_idx` ON `news` (`created_by`);
--> statement-breakpoint
CREATE INDEX `news_updated_by_idx` ON `news` (`updated_by`);
--> statement-breakpoint
CREATE INDEX `news_image_media_id_idx` ON `news` (`image_media_id`);
--> statement-breakpoint
CREATE INDEX `news_video_media_id_idx` ON `news` (`video_media_id`);
--> statement-breakpoint
PRAGMA foreign_keys = ON;
