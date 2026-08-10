ALTER TABLE `backfill_jobs` ADD `retry_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `backfill_jobs` ADD `next_retry_at` integer;