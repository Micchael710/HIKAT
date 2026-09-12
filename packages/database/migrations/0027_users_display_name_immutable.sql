CREATE TRIGGER IF NOT EXISTS `users_display_name_immutable_trg`
BEFORE UPDATE ON `users`
FOR EACH ROW
WHEN OLD.`display_name` IS NOT NULL AND (
  NEW.`display_name` IS NULL OR
  (NEW.`display_name` COLLATE BINARY) != (OLD.`display_name` COLLATE BINARY)
)
BEGIN
  SELECT RAISE(ABORT, 'USERNAME_IMMUTABLE: display_name is permanent and cannot be modified once set');
END;
