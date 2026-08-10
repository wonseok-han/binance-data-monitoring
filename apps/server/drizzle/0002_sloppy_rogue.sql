CREATE TABLE `backfill_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol` text NOT NULL,
	`from_time` integer NOT NULL,
	`to_time` integer NOT NULL,
	`cursor` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`processed_count` integer DEFAULT 0 NOT NULL,
	`total_count` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
