CREATE TABLE `daily_outbound_links` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`url` text NOT NULL,
	`clicks` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `url`)
);
--> statement-breakpoint
CREATE TABLE `outbound_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`site_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`url` text NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`visitor_id`) REFERENCES `visitors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_outbound_links_site_ts` ON `outbound_links` (`site_id`,`timestamp`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_daily_devices` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`device_type` text NOT NULL,
	`browser` text NOT NULL,
	`os` text DEFAULT '' NOT NULL,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `device_type`, `browser`, `os`)
);
--> statement-breakpoint
INSERT INTO `__new_daily_devices`("site_id", "date", "device_type", "browser", "os", "visits") SELECT "site_id", "date", "device_type", "browser", '', "visits" FROM `daily_devices`;--> statement-breakpoint
DROP TABLE `daily_devices`;--> statement-breakpoint
ALTER TABLE `__new_daily_devices` RENAME TO `daily_devices`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_daily_locations` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`country` text NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `country`, `region`, `city`)
);
--> statement-breakpoint
INSERT INTO `__new_daily_locations`("site_id", "date", "country", "region", "city", "visits") SELECT "site_id", "date", "country", '', COALESCE("city", ''), "visits" FROM `daily_locations`;--> statement-breakpoint
DROP TABLE `daily_locations`;--> statement-breakpoint
ALTER TABLE `__new_daily_locations` RENAME TO `daily_locations`;--> statement-breakpoint
CREATE TABLE `__new_daily_sources` (
	`site_id` text NOT NULL,
	`date` text NOT NULL,
	`referrer_domain` text NOT NULL,
	`utm_source` text DEFAULT '' NOT NULL,
	`utm_medium` text DEFAULT '' NOT NULL,
	`utm_campaign` text DEFAULT '' NOT NULL,
	`visits` integer NOT NULL,
	PRIMARY KEY(`site_id`, `date`, `referrer_domain`, `utm_source`, `utm_medium`, `utm_campaign`)
);
--> statement-breakpoint
INSERT INTO `__new_daily_sources`("site_id", "date", "referrer_domain", "utm_source", "utm_medium", "utm_campaign", "visits") SELECT "site_id", "date", "referrer_domain", COALESCE("utm_source", ''), COALESCE("utm_medium", ''), '', "visits" FROM `daily_sources`;--> statement-breakpoint
DROP TABLE `daily_sources`;--> statement-breakpoint
ALTER TABLE `__new_daily_sources` RENAME TO `daily_sources`;--> statement-breakpoint
ALTER TABLE `daily_pages` ADD `entrances` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_pages` ADD `exits` integer DEFAULT 0 NOT NULL;
