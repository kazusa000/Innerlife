CREATE TABLE `daemon_state` (
	`id` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_heartbeat_at` integer NOT NULL,
	`stopped_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
