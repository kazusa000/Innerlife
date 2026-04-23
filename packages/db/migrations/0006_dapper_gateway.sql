CREATE TABLE `relationship_counterparts` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_relationship_counterparts_agent_updated_at` ON `relationship_counterparts` (`agent_id`,`updated_at`);
--> statement-breakpoint
CREATE TABLE `session_relationship_bindings` (
	`session_id` text PRIMARY KEY NOT NULL,
	`counterpart_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`counterpart_id`) REFERENCES `relationship_counterparts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_session_relationship_bindings_counterpart_id` ON `session_relationship_bindings` (`counterpart_id`);
