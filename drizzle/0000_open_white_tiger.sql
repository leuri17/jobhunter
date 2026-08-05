CREATE TABLE `application_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `derived_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_version_id` integer NOT NULL,
	`derived_field` text NOT NULL,
	`override_active` integer NOT NULL,
	`override_value_json` text,
	`generated_value_json` text,
	`generated_at` text,
	`overridden_at` text,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `derived_overrides_profile_version_field_idx` ON `derived_overrides` (`profile_version_id`,`derived_field`);--> statement-breakpoint
CREATE TABLE `diagnostic_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pipeline_run_id` integer,
	`search_execution_id` integer,
	`job_id` integer,
	`discovery_error_id` integer,
	`extraction_attempt_id` integer,
	`artifact_type` text NOT NULL,
	`stored_path` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text,
	`file_size` integer,
	`created_at` text NOT NULL,
	`error_code` text,
	`description` text,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_execution_id`) REFERENCES `search_executions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`discovery_error_id`) REFERENCES `discovery_errors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`extraction_attempt_id`) REFERENCES `extraction_attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `diagnostic_artifacts_run_id_idx` ON `diagnostic_artifacts` (`pipeline_run_id`);--> statement-breakpoint
CREATE TABLE `discovery_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pipeline_run_id` integer NOT NULL,
	`search_execution_id` integer NOT NULL,
	`card_position` integer,
	`card_index` integer,
	`available_metadata_json` text,
	`error_code` text NOT NULL,
	`diagnostic_message` text NOT NULL,
	`timestamp` text NOT NULL,
	`artifact_refs_json` text,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_execution_id`) REFERENCES `search_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discovery_errors_run_search_idx` ON `discovery_errors` (`pipeline_run_id`,`search_execution_id`);--> statement-breakpoint
CREATE TABLE `discovery_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`pipeline_run_id` integer NOT NULL,
	`search_execution_id` integer NOT NULL,
	`timestamp` text NOT NULL,
	`is_new` integer NOT NULL,
	`current_extraction_state` text NOT NULL,
	`extraction_attempted` integer NOT NULL,
	`skip_reason` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_execution_id`) REFERENCES `search_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `discovery_events_run_search_idx` ON `discovery_events` (`pipeline_run_id`,`search_execution_id`);--> statement-breakpoint
CREATE TABLE `extraction_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`pipeline_run_id` integer NOT NULL,
	`search_execution_id` integer NOT NULL,
	`attempt_timestamp` text NOT NULL,
	`method` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`success` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`search_execution_id`) REFERENCES `search_executions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `extraction_attempts_job_id_idx` ON `extraction_attempts` (`job_id`);--> statement-breakpoint
CREATE TABLE `filter_configuration_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`schema_version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `filter_configuration_versions_content_hash_idx` ON `filter_configuration_versions` (`content_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `filter_configuration_versions_active_idx` ON `filter_configuration_versions` (`id`) WHERE active = 1;--> statement-breakpoint
CREATE TABLE `filter_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`pipeline_run_id` integer,
	`filter_config_version_id` integer NOT NULL,
	`filter_config_hash` text NOT NULL,
	`profile_version_id` integer,
	`profile_hash` text,
	`filter_implementation_version` text NOT NULL,
	`fingerprint` text NOT NULL,
	`timestamp` text NOT NULL,
	`overall_outcome` text NOT NULL,
	`rules_evaluated_json` text NOT NULL,
	`rules_passed_json` text NOT NULL,
	`rules_failed_json` text NOT NULL,
	`rejection_reasons_json` text,
	`active` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filter_config_version_id`) REFERENCES `filter_configuration_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `filter_results_fingerprint_idx` ON `filter_results` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `filter_results_active_job_idx` ON `filter_results` (`job_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `filter_results_active_idx` ON `filter_results` (`job_id`) WHERE active = 1;--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_job_id` text NOT NULL,
	`title` text,
	`company` text,
	`location` text,
	`description` text,
	`extraction_status` text NOT NULL,
	`successful_method` text,
	`first_discovery_timestamp` text NOT NULL,
	`last_rediscovery_timestamp` text NOT NULL,
	`last_extraction_attempt_timestamp` text,
	`created_timestamp` text NOT NULL,
	`updated_timestamp` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_job_id_idx` ON `jobs` (`source_job_id`);--> statement-breakpoint
CREATE INDEX `jobs_extraction_status_idx` ON `jobs` (`extraction_status`);--> statement-breakpoint
CREATE TABLE `openai_request_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_type` text NOT NULL,
	`related_entity_type` text,
	`related_entity_id` integer,
	`input_hashes_json` text NOT NULL,
	`prompt_version` text NOT NULL,
	`structured_output_schema_version` integer NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`config_json` text NOT NULL,
	`token_usage_json` text,
	`validated_output_json` text,
	`attempt_count` integer NOT NULL,
	`start_timestamp` text NOT NULL,
	`end_timestamp` text,
	`success` integer NOT NULL,
	`error_code` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `openai_request_metadata_operation_idx` ON `openai_request_metadata` (`operation_type`,`start_timestamp`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`start_timestamp` text NOT NULL,
	`end_timestamp` text,
	`config_snapshot_json` text NOT NULL,
	`config_schema_version` integer NOT NULL,
	`config_hash` text NOT NULL,
	`application_version` text NOT NULL,
	`profile_version_id` integer,
	`filter_config_version_id` integer,
	`searches_planned` integer DEFAULT 0 NOT NULL,
	`searches_attempted` integer DEFAULT 0 NOT NULL,
	`searches_completed` integer DEFAULT 0 NOT NULL,
	`search_errors_json` text,
	`jobs_discovered` integer DEFAULT 0 NOT NULL,
	`new_complete_jobs` integer DEFAULT 0 NOT NULL,
	`existing_complete_jobs_skipped` integer DEFAULT 0 NOT NULL,
	`existing_partial_jobs_skipped` integer DEFAULT 0 NOT NULL,
	`new_partial_jobs` integer DEFAULT 0 NOT NULL,
	`failed_extractions` integer DEFAULT 0 NOT NULL,
	`jobs_accepted` integer DEFAULT 0 NOT NULL,
	`jobs_rejected` integer DEFAULT 0 NOT NULL,
	`filter_errors` integer DEFAULT 0 NOT NULL,
	`jobs_scored` integer DEFAULT 0 NOT NULL,
	`scores_reused` integer DEFAULT 0 NOT NULL,
	`scoring_errors` integer DEFAULT 0 NOT NULL,
	`scoring_declined_by_user` integer DEFAULT false NOT NULL,
	`cancellation_reason` text,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filter_config_version_id`) REFERENCES `filter_configuration_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pipeline_runs_status_start_idx` ON `pipeline_runs` (`status`,`start_timestamp`);--> statement-breakpoint
CREATE TABLE `profile_conflicts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_version_id` integer NOT NULL,
	`conflict_type` text NOT NULL,
	`affected_field` text NOT NULL,
	`value_source_a_json` text,
	`value_source_b_json` text,
	`source_references_json` text NOT NULL,
	`provisional_value_json` text,
	`explanation` text,
	`resolution_status` text NOT NULL,
	`resolved_at` text,
	`resolved_value_json` text,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_conflicts_profile_version_id_idx` ON `profile_conflicts` (`profile_version_id`);--> statement-breakpoint
CREATE TABLE `profile_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_version_id` integer NOT NULL,
	`revision_timestamp` text NOT NULL,
	`source` text NOT NULL,
	`field_path` text NOT NULL,
	`previous_value_json` text,
	`new_value_json` text,
	`note` text,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_revisions_profile_version_id_idx` ON `profile_revisions` (`profile_version_id`);--> statement-breakpoint
CREATE TABLE `profile_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_type` text NOT NULL,
	`original_filename` text NOT NULL,
	`original_absolute_path` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`import_timestamp` text NOT NULL,
	`extracted_text_hash` text,
	`text_extraction_status` text NOT NULL,
	`text_extraction_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_sources_sha256_idx` ON `profile_sources` (`sha256`);--> statement-breakpoint
CREATE TABLE `profile_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text NOT NULL,
	`schema_version` integer NOT NULL,
	`content_hash` text NOT NULL,
	`extraction_fingerprint` text NOT NULL,
	`source_ids_json` text NOT NULL,
	`profile_json` text NOT NULL,
	`model` text,
	`reasoning_effort` text,
	`prompt_version` text,
	`structured_output_schema_version` integer,
	`extractor_implementation_version` text,
	`validation_warnings_json` text,
	`unresolved_conflicts_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`approved_at` text,
	`superseded_at` text,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `profile_versions_extraction_fingerprint_idx` ON `profile_versions` (`extraction_fingerprint`);--> statement-breakpoint
CREATE INDEX `profile_versions_content_hash_idx` ON `profile_versions` (`content_hash`);--> statement-breakpoint
CREATE INDEX `profile_versions_status_idx` ON `profile_versions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_active_approved_idx` ON `profile_versions` (`id`) WHERE status = 'approved' AND active = 1;--> statement-breakpoint
CREATE TABLE `profile_warnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_version_id` integer NOT NULL,
	`severity` text NOT NULL,
	`warning_type` text NOT NULL,
	`field_path` text,
	`message` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`profile_version_id`) REFERENCES `profile_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `profile_warnings_profile_version_id_idx` ON `profile_warnings` (`profile_version_id`);--> statement-breakpoint
CREATE TABLE `score_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`pipeline_run_id` integer,
	`filter_result_id` integer,
	`fingerprint` text NOT NULL,
	`timestamp` text NOT NULL,
	`prompt_version` text NOT NULL,
	`rubric_version` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_effort` text NOT NULL,
	`scorer_implementation_version` text NOT NULL,
	`category_scores_json` text NOT NULL,
	`overall_score` real NOT NULL,
	`explanation` text,
	`key_matches_json` text,
	`important_gaps_json` text,
	`important_concerns_json` text,
	`inferred_seniority` text,
	`recommendation_summary` text,
	`success` integer NOT NULL,
	`error_code` text,
	`error_message` text,
	`active` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`filter_result_id`) REFERENCES `filter_results`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `score_results_fingerprint_idx` ON `score_results` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `score_results_active_job_idx` ON `score_results` (`job_id`,`active`);--> statement-breakpoint
CREATE INDEX `score_results_overall_score_idx` ON `score_results` (`overall_score`);--> statement-breakpoint
CREATE UNIQUE INDEX `score_results_active_idx` ON `score_results` (`job_id`) WHERE active = 1;--> statement-breakpoint
CREATE TABLE `search_executions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pipeline_run_id` integer NOT NULL,
	`search_query` text NOT NULL,
	`location_name` text NOT NULL,
	`geo_id` text NOT NULL,
	`generated_url` text NOT NULL,
	`start_timestamp` text NOT NULL,
	`end_timestamp` text,
	`final_status` text NOT NULL,
	`jobs_discovered` integer DEFAULT 0 NOT NULL,
	`new_jobs` integer DEFAULT 0 NOT NULL,
	`existing_jobs` integer DEFAULT 0 NOT NULL,
	`errors_json` text,
	`diagnostic_refs_json` text,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `search_executions_pipeline_run_id_idx` ON `search_executions` (`pipeline_run_id`);