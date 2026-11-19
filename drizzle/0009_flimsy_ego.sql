ALTER TABLE `openai_request_metadata` RENAME TO `ai_provider_request_metadata`;--> statement-breakpoint
DROP INDEX `openai_request_metadata_operation_idx`;--> statement-breakpoint
CREATE INDEX `ai_provider_request_metadata_operation_idx` ON `ai_provider_request_metadata` (`operation_type`,`start_timestamp`);