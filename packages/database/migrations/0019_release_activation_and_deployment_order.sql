-- HiKAT D1 Database Migration: 0019_release_activation_and_deployment_order.sql
-- Adds update_deployment_order and launcher_active_release_id for Shard 08F (Release Activation & Integration)

ALTER TABLE `project_settings` ADD `update_deployment_order` text DEFAULT 'SERVER_FIRST' NOT NULL;
--> statement-breakpoint
ALTER TABLE `project_settings` ADD `launcher_active_release_id` text REFERENCES `game_releases`(`id`) ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_settings_launcher_active_release_id_idx` ON `project_settings` (`launcher_active_release_id`);
--> statement-breakpoint
UPDATE `project_settings`
SET `launcher_active_release_id` = (
  SELECT `id` FROM `game_releases`
  WHERE `status` = 'PUBLISHED'
  ORDER BY `published_at` DESC, `created_at` DESC
  LIMIT 1
)
WHERE `id` = 'main' AND `launcher_active_release_id` IS NULL AND EXISTS (
  SELECT 1 FROM `game_releases` WHERE `status` = 'PUBLISHED'
);
