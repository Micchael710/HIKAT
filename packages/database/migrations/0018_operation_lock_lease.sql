-- HiKAT D1 Database Migration: 0018_operation_lock_lease.sql
-- Adds lease_id to server_operation_locks for authoritative distributed lock ownership

ALTER TABLE `server_operation_locks` ADD `lease_id` text;
