-- Migration 0010: Player Skin Selections & Server Tasks Metadata (Phase 07)

CREATE TABLE IF NOT EXISTS `player_skin_selections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`skin_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`skin_id`) REFERENCES `skins`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `player_skin_selections_skin_id_idx` ON `player_skin_selections` (`skin_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `server_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`template` text NOT NULL,
	`name` text NOT NULL,
	`frequency` text NOT NULL,
	`cron_minute` text DEFAULT '0' NOT NULL,
	`cron_hour` text DEFAULT '4' NOT NULL,
	`cron_day_of_week` text DEFAULT '*' NOT NULL,
	`time` text,
	`interval_hours` integer,
	`weekday` integer,
	`weekdays` text,
	`command` text,
	`delay_seconds` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`template_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `server_tasks_schedule_id_idx` ON `server_tasks` (`schedule_id`);
