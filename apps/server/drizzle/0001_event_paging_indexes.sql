CREATE INDEX `events_printer_id_row_id_idx` ON `events` (`printer_id`,`row_id`);--> statement-breakpoint
CREATE INDEX `events_type_row_id_idx` ON `events` (`type`,`row_id`);--> statement-breakpoint
CREATE INDEX `events_category_row_id_idx` ON `events` (`category`,`row_id`);