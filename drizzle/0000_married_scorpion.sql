CREATE TABLE `daily_devices` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`device_type` text NOT NULL,
	`browser` text NOT NULL,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `device_type`, `browser`)
);
--> statement-breakpoint
CREATE TABLE `daily_events` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `name`)
);
--> statement-breakpoint
CREATE TABLE `daily_locations` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`city` text,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `country`, `city`)
);
--> statement-breakpoint
CREATE TABLE `daily_pages` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`path` text NOT NULL,
	`pageviews` integer NOT NULL,
	`visitors` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `path`)
);
--> statement-breakpoint
CREATE TABLE `daily_sources` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`referrer_domain` text NOT NULL,
	`utm_source` text,
	`utm_medium` text,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `referrer_domain`, `utm_source`, `utm_medium`)
);
--> statement-breakpoint
CREATE TABLE `daily_summary` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`visitors` integer NOT NULL,
	`visits` integer NOT NULL,
	`pageviews` integer NOT NULL,
	`bounce_rate` real NOT NULL,
	`avg_duration_seconds` real NOT NULL,
	PRIMARY KEY(`site_id`, `date`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`browser` text NOT NULL,
	`os` text NOT NULL,
	`device_type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_devices_unique` ON `devices` (`browser`,`os`,`device_type`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`name` text NOT NULL,
	`props` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_site_name_ts` ON `events` (`site_id`,`name`,`timestamp`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`country` text NOT NULL,
	`region` text,
	`city` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_locations_unique` ON `locations` (`country`,`region`,`city`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`visit_id` text NOT NULL,
	`path` text NOT NULL,
	`title` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pages_site_ts` ON `pages` (`site_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_pages_visit` ON `pages` (`visit_id`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_domain_unique` ON `sites` (`domain`);--> statement-breakpoint
CREATE TABLE `sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`referrer_domain` text DEFAULT '(direct)' NOT NULL,
	`utm_source` text,
	`utm_medium` text,
	`utm_campaign` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sources_unique` ON `sources` (`site_id`,`referrer_domain`,`utm_source`,`utm_medium`,`utm_campaign`);--> statement-breakpoint
CREATE TABLE `visitors` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visitors_site_seen` ON `visitors` (`site_id`,`last_seen`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`entry_page` text,
	`exit_page` text,
	`page_count` integer DEFAULT 1 NOT NULL,
	`is_bounce` integer DEFAULT true NOT NULL,
	`source_id` integer,
	`device_id` integer,
	`location_id` integer,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_visits_site_started` ON `visits` (`site_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_visits_visitor` ON `visits` (`visitor_id`,`started_at`);