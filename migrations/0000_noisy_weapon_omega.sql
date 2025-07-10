CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agentName` text NOT NULL,
	`agentType` text DEFAULT 'general_agent' NOT NULL,
	`repositoryPath` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`claudePid` integer,
	`capabilities` text DEFAULT '[]',
	`toolPermissions` text,
	`roomId` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`lastHeartbeat` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`agentMetadata` text
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`agentName` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`mentions` text,
	`messageType` text DEFAULT 'standard' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`repositoryPath` text NOT NULL,
	`isGeneral` integer DEFAULT false NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`roomMetadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_rooms_name_unique` ON `chat_rooms` (`name`);--> statement-breakpoint
CREATE TABLE `knowledge_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`entityType` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`properties` text,
	`importanceScore` real DEFAULT 0.5 NOT NULL,
	`relevanceScore` real DEFAULT 0.5 NOT NULL,
	`confidenceScore` real DEFAULT 0.5 NOT NULL,
	`accessCount` integer DEFAULT 0 NOT NULL,
	`lastAccessed` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`discoveredBy` text,
	`discoveredDuring` text,
	`validated` integer DEFAULT false NOT NULL,
	`validatedBy` text,
	`validatedAt` text
);
--> statement-breakpoint
CREATE TABLE `knowledge_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`insightType` text NOT NULL,
	`relatedEntities` text DEFAULT '[]',
	`relatedRelationships` text DEFAULT '[]',
	`evidence` text,
	`supportingData` text,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`impact` real DEFAULT 0.5 NOT NULL,
	`actionability` real DEFAULT 0.5 NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`discoveredBy` text,
	`discoveredDuring` text,
	`validated` integer DEFAULT false NOT NULL,
	`validatedBy` text,
	`validatedAt` text,
	`applied` integer DEFAULT false NOT NULL,
	`appliedBy` text,
	`appliedAt` text
);
--> statement-breakpoint
CREATE TABLE `knowledge_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`fromEntityId` text NOT NULL,
	`toEntityId` text NOT NULL,
	`relationshipType` text NOT NULL,
	`properties` text,
	`strength` real DEFAULT 0.5 NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`context` text,
	`evidenceCount` integer DEFAULT 1 NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`discoveredBy` text,
	`discoveredDuring` text,
	`validated` integer DEFAULT false NOT NULL,
	`validatedBy` text,
	`validatedAt` text
);
--> statement-breakpoint
CREATE TABLE `error_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`agentId` text,
	`taskId` text,
	`errorType` text NOT NULL,
	`errorCategory` text NOT NULL,
	`errorMessage` text NOT NULL,
	`errorDetails` text,
	`context` text,
	`environment` text,
	`attemptedSolution` text,
	`resolutionStatus` text DEFAULT 'unresolved' NOT NULL,
	`resolutionDetails` text,
	`patternId` text,
	`severity` text DEFAULT 'medium' NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`resolvedAt` text
);
--> statement-breakpoint
CREATE TABLE `tool_call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`agentId` text NOT NULL,
	`taskId` text,
	`toolName` text NOT NULL,
	`parameters` text,
	`result` text,
	`status` text NOT NULL,
	`executionTime` real,
	`errorMessage` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`agentId` text NOT NULL,
	`memoryType` text NOT NULL,
	`category` text,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]',
	`miscData` text,
	`context` text,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`relevanceScore` real DEFAULT 1 NOT NULL,
	`usefulnessScore` real DEFAULT 0 NOT NULL,
	`accessedCount` integer DEFAULT 0 NOT NULL,
	`referencedCount` integer DEFAULT 0 NOT NULL,
	`lastAccessed` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documentation_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`sourceType` text DEFAULT 'guide' NOT NULL,
	`maxPages` integer DEFAULT 200 NOT NULL,
	`updateFrequency` text DEFAULT 'daily' NOT NULL,
	`selectors` text,
	`allowPatterns` text DEFAULT '[]',
	`ignorePatterns` text DEFAULT '[]',
	`includeSubdomains` integer DEFAULT false,
	`lastScraped` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`sourceMetadata` text
);
--> statement-breakpoint
CREATE TABLE `scrape_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`sourceId` text NOT NULL,
	`jobData` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 5 NOT NULL,
	`lockedBy` text,
	`lockedAt` text,
	`lockTimeout` integer DEFAULT 3600 NOT NULL,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`startedAt` text,
	`completedAt` text,
	`errorMessage` text,
	`pagesScraped` integer,
	`resultData` text
);
--> statement-breakpoint
CREATE TABLE `website_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`websiteId` text NOT NULL,
	`url` text NOT NULL,
	`contentHash` text NOT NULL,
	`htmlContent` text,
	`markdownContent` text,
	`selector` text,
	`title` text,
	`httpStatus` integer,
	`errorMessage` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `websites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`metaDescription` text,
	`sitemapData` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `websites_domain_unique` ON `websites` (`domain`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`taskId` text NOT NULL,
	`dependsOnTaskId` text NOT NULL,
	`dependencyType` text DEFAULT 'completion' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`taskType` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`assignedAgentId` text,
	`parentTaskId` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`description` text NOT NULL,
	`requirements` text,
	`results` text,
	`createdAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updatedAt` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
