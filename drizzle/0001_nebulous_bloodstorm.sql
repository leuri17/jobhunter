DROP INDEX `filter_configuration_versions_active_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `filter_configuration_versions_active_idx` ON `filter_configuration_versions` ((1)) WHERE active = 1;--> statement-breakpoint
DROP INDEX `profile_versions_active_approved_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `profile_versions_active_approved_idx` ON `profile_versions` ((1)) WHERE status = 'approved' AND active = 1;