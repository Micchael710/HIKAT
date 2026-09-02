ALTER TABLE `game_releases`
ADD COLUMN `mod_loader` text NOT NULL DEFAULT 'NEOFORGE';

--> statement-breakpoint

ALTER TABLE `game_releases`
ADD COLUMN `mod_loader_version` text;

--> statement-breakpoint

UPDATE `game_releases`
SET
  `mod_loader` = 'NEOFORGE',
  `mod_loader_version` = `neoforge_version`;
