CREATE TABLE `relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`counterpart_type` text NOT NULL,
	`counterpart_id` text NOT NULL,
	`dimensions` text NOT NULL,
	`history` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_relationships_agent_counterpart` ON `relationships` (`agent_id`,`counterpart_type`,`counterpart_id`);--> statement-breakpoint
CREATE INDEX `idx_relationships_agent_updated_at` ON `relationships` (`agent_id`,`updated_at`);
