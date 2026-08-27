CREATE TABLE `server_operation_locks` (
	`lock_key` text PRIMARY KEY NOT NULL,
	`operation` text NOT NULL,
	`acquired_by_user_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`acquired_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
