CREATE TABLE `analysis_metadata` (
	`id` integer PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`analysis_type` text NOT NULL,
	`version` text DEFAULT '1.0.0' NOT NULL,
	`context_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`project_path`, `analysis_type`),
	FOREIGN KEY (`context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_context` ON `analysis_metadata` (`context_id`);--> statement-breakpoint
CREATE TABLE `analysis_runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	`status` text NOT NULL,
	`files_analyzed` integer DEFAULT 0 NOT NULL,
	`errors` text,
	`context_id` integer,
	FOREIGN KEY (`context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_analysis_runs_context` ON `analysis_runs` (`context_id`);--> statement-breakpoint
CREATE INDEX `idx_analysis_status` ON `analysis_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_analysis_started` ON `analysis_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `context_hierarchy` (
	`id` integer PRIMARY KEY NOT NULL,
	`context_path` text NOT NULL,
	`context_level` text NOT NULL,
	`parent_context_id` integer,
	`ecosystem_name` text,
	`project_name` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`parent_context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `context_hierarchy_context_path_unique` ON `context_hierarchy` (`context_path`);--> statement-breakpoint
CREATE INDEX `idx_context_level` ON `context_hierarchy` (`context_level`);--> statement-breakpoint
CREATE INDEX `idx_ecosystem_name` ON `context_hierarchy` (`ecosystem_name`);--> statement-breakpoint
CREATE TABLE `file_hashes` (
	`file_path` text PRIMARY KEY NOT NULL,
	`hash` text NOT NULL,
	`size` integer,
	`last_modified` text,
	`analyzed_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`context_id` integer,
	FOREIGN KEY (`context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_file_hashes_context` ON `file_hashes` (`context_id`);--> statement-breakpoint
CREATE INDEX `idx_file_hash` ON `file_hashes` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_file_modified` ON `file_hashes` (`last_modified`);--> statement-breakpoint
CREATE TABLE `imports_exports` (
	`id` integer PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`type` text NOT NULL,
	`symbol_name` text,
	`module_path` text,
	`is_default` integer DEFAULT false NOT NULL,
	`context_id` integer,
	FOREIGN KEY (`file_path`) REFERENCES `file_hashes`(`file_path`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_imports_exports_file_path` ON `imports_exports` (`file_path`);--> statement-breakpoint
CREATE INDEX `idx_imports_exports_module` ON `imports_exports` (`module_path`);--> statement-breakpoint
CREATE INDEX `idx_imports_exports_type` ON `imports_exports` (`type`);--> statement-breakpoint
CREATE INDEX `idx_imports_exports_context` ON `imports_exports` (`context_id`);--> statement-breakpoint
CREATE TABLE `pattern_promotion` (
	`id` integer PRIMARY KEY NOT NULL,
	`pattern_id` integer,
	`source_context_id` integer,
	`target_context_id` integer,
	`promoted_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`promoted_by` text,
	`reason` text,
	FOREIGN KEY (`source_context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_promotion_source` ON `pattern_promotion` (`source_context_id`);--> statement-breakpoint
CREATE INDEX `idx_promotion_target` ON `pattern_promotion` (`target_context_id`);--> statement-breakpoint
CREATE INDEX `idx_promotion_date` ON `pattern_promotion` (`promoted_at`);--> statement-breakpoint
CREATE TABLE `symbols` (
	`id` integer PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`line` integer NOT NULL,
	`column` integer NOT NULL,
	`is_exported` integer DEFAULT false NOT NULL,
	`accessibility` text,
	`context_id` integer,
	FOREIGN KEY (`file_path`) REFERENCES `file_hashes`(`file_path`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`context_id`) REFERENCES `context_hierarchy`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_symbols_file_path` ON `symbols` (`file_path`);--> statement-breakpoint
CREATE INDEX `idx_symbols_name` ON `symbols` (`name`);--> statement-breakpoint
CREATE INDEX `idx_symbols_type` ON `symbols` (`type`);--> statement-breakpoint
CREATE INDEX `idx_symbols_exported` ON `symbols` (`is_exported`);--> statement-breakpoint
CREATE INDEX `idx_symbols_context` ON `symbols` (`context_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`agentName` text NOT NULL,
	`message` text NOT NULL,
	`timestamp` text DEFAULT (current_timestamp) NOT NULL,
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`roomMetadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_rooms_name_unique` ON `chat_rooms` (`name`);--> statement-breakpoint
CREATE TABLE `room_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`roomId` text NOT NULL,
	`agentId` text NOT NULL,
	`agentName` text NOT NULL,
	`joinedAt` text DEFAULT (current_timestamp) NOT NULL,
	`lastActive` text DEFAULT (current_timestamp) NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE INDEX `room_participants_room_id_idx` ON `room_participants` (`roomId`);--> statement-breakpoint
CREATE INDEX `room_participants_agent_id_idx` ON `room_participants` (`agentId`);--> statement-breakpoint
CREATE INDEX `room_participants_status_idx` ON `room_participants` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_participants_room_agent_unique` ON `room_participants` (`roomId`,`agentId`);--> statement-breakpoint
CREATE TABLE `contract_ports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`port` integer NOT NULL,
	`service_name` text NOT NULL,
	`status` text NOT NULL,
	`health_status` text,
	`description` text,
	`notes` text,
	`schema_file` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_ports_port_unique` ON `contract_ports` (`port`);--> statement-breakpoint
CREATE INDEX `port_idx` ON `contract_ports` (`port`);--> statement-breakpoint
CREATE INDEX `port_status_idx` ON `contract_ports` (`status`);--> statement-breakpoint
CREATE INDEX `port_service_idx` ON `contract_ports` (`service_name`);--> statement-breakpoint
CREATE TABLE `contract_tools` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`purpose` text,
	`status` text NOT NULL,
	`owner` text,
	`trust` text,
	`verified` text,
	`journal_aware` integer DEFAULT false,
	`scope` text,
	`schema_file` text NOT NULL,
	`path_exists` integer,
	`path_validated_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contract_tools_name_unique` ON `contract_tools` (`name`);--> statement-breakpoint
CREATE INDEX `tool_name_idx` ON `contract_tools` (`name`);--> statement-breakpoint
CREATE INDEX `tool_path_idx` ON `contract_tools` (`path`);--> statement-breakpoint
CREATE INDEX `tool_status_idx` ON `contract_tools` (`status`);--> statement-breakpoint
CREATE INDEX `tool_owner_idx` ON `contract_tools` (`owner`);--> statement-breakpoint
CREATE TABLE `contracts_fts` (
	`port` text,
	`service_name` text,
	`tool_name` text,
	`tool_path` text,
	`purpose` text,
	`symbol_name` text,
	`symbol_type` text,
	`content` text
);
--> statement-breakpoint
CREATE TABLE `path_validations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`path` text NOT NULL,
	`path_exists` integer NOT NULL,
	`type` text,
	`last_validated` text DEFAULT CURRENT_TIMESTAMP,
	`validation_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `path_validations_path_unique` ON `path_validations` (`path`);--> statement-breakpoint
CREATE INDEX `path_validation_idx` ON `path_validations` (`path`);--> statement-breakpoint
CREATE INDEX `path_exists_idx` ON `path_validations` (`path_exists`);--> statement-breakpoint
CREATE TABLE `python_symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_path` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`line` integer NOT NULL,
	`col` integer,
	`is_exported` integer DEFAULT false,
	`is_async` integer,
	`docstring` text,
	`signature` text,
	`methods` text,
	`bases` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `symbol_file_idx` ON `python_symbols` (`file_path`);--> statement-breakpoint
CREATE INDEX `symbol_name_idx` ON `python_symbols` (`name`);--> statement-breakpoint
CREATE INDEX `symbol_type_idx` ON `python_symbols` (`type`);--> statement-breakpoint
CREATE INDEX `symbol_exported_idx` ON `python_symbols` (`is_exported`);--> statement-breakpoint
CREATE TABLE `agent_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`progress` integer,
	`artifacts` text,
	`blockers` text,
	`next_steps` text,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `artifact_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`artifact_path` text NOT NULL,
	`artifact_type` text NOT NULL,
	`description` text NOT NULL,
	`related_tasks` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
	`sourceMetadata` text
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`resolvedAt` text
);
--> statement-breakpoint
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
	`discoveredBy` text,
	`discoveredDuring` text,
	`validated` integer DEFAULT false NOT NULL,
	`validatedBy` text,
	`validatedAt` text
);
--> statement-breakpoint
CREATE INDEX `knowledge_entities_repository_path_idx` ON `knowledge_entities` (`repositoryPath`);--> statement-breakpoint
CREATE INDEX `knowledge_entities_repo_score_idx` ON `knowledge_entities` (`repositoryPath`,`importanceScore`);--> statement-breakpoint
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
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
CREATE INDEX `knowledge_insights_repository_path_idx` ON `knowledge_insights` (`repositoryPath`);--> statement-breakpoint
CREATE INDEX `knowledge_insights_repo_created_idx` ON `knowledge_insights` (`repositoryPath`,`createdAt`);--> statement-breakpoint
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
	`discoveredBy` text,
	`discoveredDuring` text,
	`validated` integer DEFAULT false NOT NULL,
	`validatedBy` text,
	`validatedAt` text
);
--> statement-breakpoint
CREATE INDEX `knowledge_relationships_repository_path_idx` ON `knowledge_relationships` (`repositoryPath`);--> statement-breakpoint
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`repositoryPath` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`createdByAgent` text,
	`assignedOrchestrationId` text,
	`sections` text DEFAULT ('[]') NOT NULL,
	`metadata` text DEFAULT ('{}'),
	`objectives` text NOT NULL,
	`acceptanceCriteria` text,
	`constraints` text,
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
	`startedAt` text,
	`completedAt` text
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL,
	`startedAt` text,
	`completedAt` text,
	`errorMessage` text,
	`pagesScraped` integer,
	`resultData` text
);
--> statement-breakpoint
CREATE TABLE `shared_todos` (
	`id` text PRIMARY KEY NOT NULL,
	`repository_path` text NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`assigned_agent` text,
	`dependencies` text,
	`artifacts` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL
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
	`createdAt` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `website_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`websiteId` text NOT NULL,
	`url` text NOT NULL,
	`contentHash` text NOT NULL,
	`htmlContent` text,
	`sanitizedHtmlContent` text,
	`markdownContent` text,
	`domJsonContent` text,
	`screenshotBase64` text,
	`screenshotMetadata` text,
	`selector` text,
	`title` text,
	`httpStatus` integer,
	`errorMessage` text,
	`javascriptEnabled` integer DEFAULT true,
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `websites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`metaDescription` text,
	`sitemapData` text,
	`createdAt` text DEFAULT (current_timestamp) NOT NULL,
	`updatedAt` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `websites_domain_unique` ON `websites` (`domain`);--> statement-breakpoint
CREATE TABLE `semantic_chunks` (
	`chunk_id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`chunk_text` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`token_count` integer NOT NULL,
	`embedding_stored` integer DEFAULT false,
	`lancedb_id` text,
	FOREIGN KEY (`file_path`) REFERENCES `symbol_index`(`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `semantic_chunks_file_path_idx` ON `semantic_chunks` (`file_path`);--> statement-breakpoint
CREATE INDEX `semantic_chunks_stored_idx` ON `semantic_chunks` (`embedding_stored`);--> statement-breakpoint
CREATE TABLE `semantic_metadata` (
	`file_path` text PRIMARY KEY NOT NULL,
	`embedding_text` text NOT NULL,
	`embedding_stored` integer DEFAULT false,
	`lancedb_id` text,
	`total_chunks` integer DEFAULT 1,
	FOREIGN KEY (`file_path`) REFERENCES `symbol_index`(`file_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `symbol_boost_config` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name_match_boost` real DEFAULT 2 NOT NULL,
	`exported_symbol_boost` real DEFAULT 3 NOT NULL,
	`defined_symbol_boost` real DEFAULT 1.5 NOT NULL,
	`all_symbol_boost` real DEFAULT 0.5 NOT NULL,
	`import_only_penalty` real DEFAULT 0.3 NOT NULL,
	`content_match_weight` real DEFAULT 0.3 NOT NULL,
	`config_name` text NOT NULL,
	`description` text,
	`created_at` real NOT NULL,
	`updated_at` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `symbol_boost_config_config_name_unique` ON `symbol_boost_config` (`config_name`);--> statement-breakpoint
CREATE INDEX `symbol_boost_config_name_idx` ON `symbol_boost_config` (`config_name`);--> statement-breakpoint
CREATE TABLE `symbol_index` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`file_hash` text(64) NOT NULL,
	`exported_symbols` text NOT NULL,
	`defined_symbols` text NOT NULL,
	`imported_symbols` text NOT NULL,
	`class_names` text NOT NULL,
	`function_names` text NOT NULL,
	`language` text NOT NULL,
	`symbol_count` integer NOT NULL,
	`has_exports` integer NOT NULL,
	`indexed_at` real NOT NULL,
	`updated_at` real NOT NULL,
	`file_size` integer NOT NULL,
	`parse_time_ms` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `symbol_index_file_path_unique` ON `symbol_index` (`file_path`);--> statement-breakpoint
CREATE INDEX `symbol_index_file_path_idx` ON `symbol_index` (`file_path`);--> statement-breakpoint
CREATE INDEX `symbol_index_updated_at_idx` ON `symbol_index` (`updated_at`);--> statement-breakpoint
CREATE INDEX `symbol_index_language_idx` ON `symbol_index` (`language`);--> statement-breakpoint
CREATE TABLE `symbol_index_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`total_files` integer NOT NULL,
	`indexed_files` integer NOT NULL,
	`failed_files` integer NOT NULL,
	`avg_parse_time_ms` real NOT NULL,
	`total_symbols` integer NOT NULL,
	`typescript_files` integer DEFAULT 0 NOT NULL,
	`javascript_files` integer DEFAULT 0 NOT NULL,
	`python_files` integer DEFAULT 0 NOT NULL,
	`indexing_duration_ms` integer NOT NULL,
	`cache_hit_rate` real NOT NULL,
	`started_at` real NOT NULL,
	`completed_at` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `symbol_index_stats_completed_at_idx` ON `symbol_index_stats` (`completed_at`);