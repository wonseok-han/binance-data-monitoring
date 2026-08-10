CREATE TABLE `candles` (
	`symbol` text NOT NULL,
	`open_time` integer NOT NULL,
	`close_time` integer NOT NULL,
	`open` text NOT NULL,
	`high` text NOT NULL,
	`low` text NOT NULL,
	`close` text NOT NULL,
	`volume` text NOT NULL,
	`quote_volume` text NOT NULL,
	`trade_count` integer NOT NULL,
	`is_closed` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`symbol`, `open_time`)
);
--> statement-breakpoint
CREATE TABLE `collector_state` (
	`symbol` text PRIMARY KEY NOT NULL,
	`last_event_at` integer,
	`last_closed_open_time` integer,
	`connection_status` text DEFAULT 'connecting' NOT NULL,
	`last_error` text
);
