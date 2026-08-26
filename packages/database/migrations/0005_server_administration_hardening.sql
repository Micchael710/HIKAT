CREATE TABLE `server_console_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `server_console_tickets_user_id_idx` ON `server_console_tickets` (`user_id`);--> statement-breakpoint
CREATE INDEX `server_console_tickets_session_id_idx` ON `server_console_tickets` (`session_id`);--> statement-breakpoint
CREATE INDEX `server_console_tickets_expires_at_idx` ON `server_console_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `server_power_locks` (
	`lock_key` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`acquired_by_user_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`acquired_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server_command_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`window_start` text NOT NULL,
	`reset_at` text NOT NULL
);
