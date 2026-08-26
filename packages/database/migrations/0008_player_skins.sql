-- Migration 0008: Player Skins - 1:1 Player Custom Skin Association

CREATE TABLE IF NOT EXISTS `player_skins` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`model` text DEFAULT 'CLASSIC' NOT NULL,
	`media_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_id`) REFERENCES `content_media`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `player_skins_user_id_idx` ON `player_skins` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `player_skins_media_id_idx` ON `player_skins` (`media_id`);
