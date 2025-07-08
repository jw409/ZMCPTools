import { z } from 'zod';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema, createSelectSchema, createUpdateSchema, type GetZodType } from 'drizzle-zod';

// Zod v4 schemas for validation
export const sourceTypeSchema = z.enum([
  'api',
  'guide', 
  'reference',
  'tutorial',
  'documentation',
  'blog',
  'wiki'
]);

export const updateFrequencySchema = z.enum([
  'never',
  'daily',
  'weekly',
  'monthly',
  'on_demand'
]);

export const scrapeJobStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
  'timeout'
]);

export const documentationStatusSchema = z.enum([
  'not_started',
  'scraping',
  'completed',
  'failed',
  'stale'
]);

// Schema validation helpers
export const selectorsSchema = z.record(z.string(), z.string()).optional();
export const allowPatternsSchema = z.array(z.string()).default([]);
export const ignorePatternsSchema = z.array(z.string()).default([]);
export const sourceMetadataSchema = z.record(z.string(), z.unknown()).optional();
export const jobDataSchema = z.record(z.string(), z.unknown());
export const resultDataSchema = z.record(z.string(), z.unknown()).optional();

const DocumentationSourceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(200),
  url: z.string().url(),
  sourceType: sourceTypeSchema.default('guide'),
  crawlDepth: z.number().int().min(1).max(10).default(3),
  updateFrequency: updateFrequencySchema.default('daily'),
  selectors: selectorsSchema,
  allowPatterns: allowPatternsSchema,
  ignorePatterns: ignorePatternsSchema,
  includeSubdomains: z.boolean().default(false),
  lastScraped: z.string().datetime().optional(),
  status: documentationStatusSchema.default('not_started'),
  createdAt: z.string().datetime().default(() => new Date().toISOString()),
  updatedAt: z.string().datetime().default(() => new Date().toISOString()),
  sourceMetadata: sourceMetadataSchema,
});

// Drizzle table definitions
export const documentationSources = sqliteTable('documentation_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  sourceType: text('sourceType', { enum: ['api', 'guide', 'reference', 'tutorial', 'documentation', 'blog', 'wiki'] }).notNull().default('guide'),
  crawlDepth: integer('crawlDepth').notNull().default(3),
  updateFrequency: text('updateFrequency', { enum: ['never', 'daily', 'weekly', 'monthly', 'on_demand'] }).notNull().default('daily'),
  selectors: text('selectors', { mode: 'json' }).$type<Record<string, string>>(),
  allowPatterns: text('allowPatterns', { mode: 'json' }).$type<string[]>().default([]),
  ignorePatterns: text('ignorePatterns', { mode: 'json' }).$type<string[]>().default([]),
  includeSubdomains: integer('includeSubdomains', { mode: 'boolean' }).default(false),
  lastScraped: text('lastScraped'), // ISO datetime string
  status: text('status', { enum: ['not_started', 'scraping', 'completed', 'failed', 'stale'] }).notNull().default('not_started'),
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
  updatedAt: text('updatedAt').notNull().default('CURRENT_TIMESTAMP'),
  sourceMetadata: text('sourceMetadata', { mode: 'json' }).$type<Record<string, unknown>>(),
});

export const scrapeJobs = sqliteTable('scrape_jobs', {
  id: text('id').primaryKey(),
  sourceId: text('sourceId').notNull(),
  jobData: text('jobData', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  status: text('status', { enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'timeout'] }).notNull().default('pending'),
  lockedBy: text('lockedBy'),
  lockedAt: text('lockedAt'), // ISO datetime string
  lockTimeout: integer('lockTimeout').notNull().default(3600), // seconds
  createdAt: text('createdAt').notNull().default('CURRENT_TIMESTAMP'),
  startedAt: text('startedAt'), // ISO datetime string
  completedAt: text('completedAt'), // ISO datetime string
  errorMessage: text('errorMessage'),
  pagesScraped: integer('pagesScraped'),
  resultData: text('resultData', { mode: 'json' }).$type<Record<string, unknown>>(),
});

// Additional table for individual scraped entries/pages
export const scrapeJobEntries = sqliteTable('scrape_job_entries', {
  id: text('id').primaryKey(),
  jobId: text('jobId').notNull(),
  url: text('url').notNull(),
  title: text('title'),
  content: text('content'),
  contentType: text('contentType').default('text/html'),
  contentLength: integer('contentLength'),
  relevanceScore: real('relevanceScore').default(1.0),
  extractedData: text('extractedData', { mode: 'json' }).$type<Record<string, unknown>>(),
  scrapedAt: text('scrapedAt').notNull().default('CURRENT_TIMESTAMP'),
  httpStatus: integer('httpStatus'),
  errorMessage: text('errorMessage'),
});

// Drizzle relations
export const documentationSourcesRelations = relations(documentationSources, ({ many }) => ({
  scrapeJobs: many(scrapeJobs),
}));

export const scrapeJobsRelations = relations(scrapeJobs, ({ one, many }) => ({
  source: one(documentationSources, {
    fields: [scrapeJobs.sourceId],
    references: [documentationSources.id],
  }),
  entries: many(scrapeJobEntries),
}));

export const scrapeJobEntriesRelations = relations(scrapeJobEntries, ({ one }) => ({
  job: one(scrapeJobs, {
    fields: [scrapeJobEntries.jobId],
    references: [scrapeJobs.id],
  }),
}));

// Generated Zod schemas using drizzle-zod
export const insertDocumentationSourceSchema = createInsertSchema(documentationSources);

export const selectDocumentationSourceSchema = createSelectSchema(documentationSources);
export const updateDocumentationSourceSchema = createUpdateSchema(documentationSources);

export const insertScrapeJobSchema = createInsertSchema(scrapeJobs, {
  sourceId: (schema) => schema.min(1),
  lockTimeout: (schema) => schema.min(1),
});

export const selectScrapeJobSchema = createSelectSchema(scrapeJobs);
export const updateScrapeJobSchema = createUpdateSchema(scrapeJobs);

export const insertScrapeJobEntrySchema = createInsertSchema(scrapeJobEntries, {
  jobId: (schema) => schema.min(1),
  url: (schema) => schema.min(1),
  relevanceScore: (schema) => schema.min(0).max(1),
});

export const selectScrapeJobEntrySchema = createSelectSchema(scrapeJobEntries);
export const updateScrapeJobEntrySchema = createUpdateSchema(scrapeJobEntries);

// Type exports - Simple TypeScript interfaces matching camelCase table fields
export type DocumentationSource = {
  id: string;
  name: string;
  url: string;
  sourceType: 'api' | 'guide' | 'reference' | 'tutorial' | 'documentation' | 'blog' | 'wiki';
  crawlDepth: number;
  updateFrequency: 'never' | 'daily' | 'weekly' | 'monthly' | 'on_demand';
  selectors?: Record<string, string>;
  allowPatterns: string[];
  ignorePatterns: string[];
  includeSubdomains: boolean;
  lastScraped?: string;
  status: 'not_started' | 'scraping' | 'completed' | 'failed' | 'stale';
  createdAt: string;
  updatedAt: string;
  sourceMetadata?: Record<string, unknown>;
};

export type NewDocumentationSource = Omit<DocumentationSource, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
};

export type DocumentationSourceUpdate = Partial<Omit<DocumentationSource, 'id'>>;

export type ScrapeJob = {
  id: string;
  sourceId: string;
  jobData: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  lockedBy?: string;
  lockedAt?: string;
  lockTimeout: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  pagesScraped?: number;
  resultData?: Record<string, unknown>;
};

export type NewScrapeJob = Omit<ScrapeJob, 'createdAt'> & {
  createdAt?: string;
};

export type ScrapeJobUpdate = Partial<Omit<ScrapeJob, 'id'>>;

export type ScrapeJobEntry = {
  id: string;
  jobId: string;
  url: string;
  title?: string;
  content?: string;
  contentType: string;
  contentLength?: number;
  relevanceScore: number;
  extractedData?: Record<string, unknown>;
  scrapedAt: string;
  httpStatus?: number;
  errorMessage?: string;
};

export type NewScrapeJobEntry = Omit<ScrapeJobEntry, 'scrapedAt'> & {
  scrapedAt?: string;
};

export type ScrapeJobEntryUpdate = Partial<Omit<ScrapeJobEntry, 'id'>>;

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type UpdateFrequency = z.infer<typeof updateFrequencySchema>;
export type ScrapeJobStatus = z.infer<typeof scrapeJobStatusSchema>;
export type DocumentationStatus = z.infer<typeof documentationStatusSchema>;

// API request schemas (manual - not table schemas)
export const scrapeDocumentationRequestSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(200).optional(),
  sourceType: sourceTypeSchema.default('guide'),
  crawlDepth: z.number().int().min(1).max(10).default(3),
  allowPatterns: allowPatternsSchema,
  ignorePatterns: ignorePatternsSchema,
  includeSubdomains: z.boolean().default(false),
  selectors: selectorsSchema,
  forceRefresh: z.boolean().default(false),
  agentId: z.string().optional(),
});

export const searchDocumentationRequestSchema = z.object({
  query: z.string().min(1),
  sourceId: z.string().optional(),
  sourceType: sourceTypeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(10),
  similarityThreshold: z.number().min(0).max(1).default(0.7),
  includeContent: z.boolean().default(false),
});

export const scrapeJobFilterSchema = z.object({
  sourceId: z.string().optional(),
  status: scrapeJobStatusSchema.optional(),
  lockedBy: z.string().optional(),
  createdAfter: z.string().datetime().optional(),
  createdBefore: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export type ScrapeDocumentationRequest = z.infer<typeof scrapeDocumentationRequestSchema>;
export type SearchDocumentationRequest = z.infer<typeof searchDocumentationRequestSchema>;
export type ScrapeJobFilter = z.infer<typeof scrapeJobFilterSchema>;