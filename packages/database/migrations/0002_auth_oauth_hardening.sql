ALTER TABLE `oauth_states` ADD `client_state` text;
--> statement-breakpoint
ALTER TABLE `oauth_states` ADD `session_id` text REFERENCES `sessions`(`id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `oauth_states_session_id_idx` ON `oauth_states` (`session_id`);
