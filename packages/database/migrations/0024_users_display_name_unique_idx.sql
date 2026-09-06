CREATE UNIQUE INDEX IF NOT EXISTS `users_display_name_unique_idx` ON `users` (`display_name` COLLATE NOCASE);
