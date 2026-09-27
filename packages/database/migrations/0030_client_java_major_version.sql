ALTER TABLE `servers` ADD COLUMN `client_java_major_version` integer;
--> statement-breakpoint
ALTER TABLE `game_releases` ADD COLUMN `client_java_major_version` integer;
