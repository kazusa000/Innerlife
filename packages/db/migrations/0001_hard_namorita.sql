ALTER TABLE `llm_calls` ADD `kind` text DEFAULT 'turn' NOT NULL;--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `metadata_json` text;