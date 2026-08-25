CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'PLAYER' NOT NULL,
	`display_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('PLAYER', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE `external_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`email` text,
	`display_name` text,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "external_accounts_provider_check" CHECK("external_accounts"."provider" IN ('GOOGLE', 'DISCORD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_accounts_provider_subject_idx` ON `external_accounts` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE INDEX `external_accounts_user_id_idx` ON `external_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_refresh_token_hash_idx` ON `sessions` (`refresh_token_hash`);