-- HiKAT D1 Database Migration: 0026_game_releases_single_draft_per_server.sql
-- Enforces a single DRAFT release per server in D1.

CREATE UNIQUE INDEX `game_releases_server_draft_idx` ON `game_releases` (COALESCE(`server_id`, ''), `status`) WHERE `status` = 'DRAFT';
