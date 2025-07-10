import { eq, and, or, desc, asc, count } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { Logger } from '../utils/logger.js';
import { DatabaseManager } from '../database/index.js';
import { allTables } from '../schemas/index.js';

// Generic database operations interface
export interface DatabaseOperations<TSelect, TInsert, TUpdate> {
  create(data: TInsert): Promise<TSelect>;
  findById(id: string | number): Promise<TSelect | null>;
  findByField(field: string, value: any): Promise<TSelect[]>;
  exists(id: string | number): Promise<boolean>;
  update(id: string | number, data: TUpdate): Promise<TSelect | null>;
  delete(id: string | number): Promise<boolean>;
  list(options?: ListOptions): Promise<PaginatedResult<TSelect>>;
  count(where?: any): Promise<number>;
}

// Repository configuration interface
export interface RepositoryConfig<TTable extends SQLiteTable> {
  table: TTable;
  primaryKey: SQLiteColumn;
  insertSchema: z.ZodSchema;
  selectSchema: z.ZodSchema;
  updateSchema: z.ZodSchema;
  loggerCategory?: string;
}

// Query options and pagination
export interface ListOptions {
  where?: any;
  orderBy?: any;
  limit?: number;
  offset?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// Query builder helpers
export interface QueryBuilder<TSelect> {
  where(condition: any): QueryBuilder<TSelect>;
  orderBy(column: any, direction?: 'asc' | 'desc'): QueryBuilder<TSelect>;
  limit(count: number): QueryBuilder<TSelect>;
  offset(count: number): QueryBuilder<TSelect>;
  execute(): Promise<TSelect[]>;
  first(): Promise<TSelect | null>;
  count(): Promise<number>;
}

// Error types for better error handling
export class RepositoryError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly tableName: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

export class ValidationError extends RepositoryError {
  constructor(
    message: string,
    tableName: string,
    public readonly validationErrors: z.ZodError
  ) {
    super(message, 'validation', tableName);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends RepositoryError {
  constructor(tableName: string, id: string | number) {
    super(`Record with id ${id} not found`, 'findById', tableName);
    this.name = 'NotFoundError';
  }
}

/**
 * Base repository class providing common CRUD operations for Drizzle ORM
 * 
 * @template TTable - Drizzle table type
 * @template TSelect - Type for selected records  
 * @template TInsert - Type for insert operations
 * @template TUpdate - Type for update operations
 */
export abstract class BaseRepository<
  TTable extends SQLiteTable,
  TSelect = any,
  TInsert = any, 
  TUpdate = any
> implements DatabaseOperations<TSelect, TInsert, TUpdate> {
  protected readonly drizzle: BetterSQLite3Database<typeof allTables>;
  protected readonly logger: Logger;
  protected readonly table: TTable;
  protected readonly primaryKey: SQLiteColumn;
  protected readonly insertSchema: z.ZodSchema<TInsert>;
  protected readonly selectSchema: z.ZodSchema<TSelect>;
  protected readonly updateSchema: z.ZodSchema<TUpdate>;

  constructor(
    protected readonly drizzleManager: DatabaseManager,
    config: RepositoryConfig<TTable>
  ) {
    this.drizzle = drizzleManager.drizzle;
    this.table = config.table;
    this.primaryKey = config.primaryKey;
    this.insertSchema = config.insertSchema;
    this.selectSchema = config.selectSchema;
    this.updateSchema = config.updateSchema;
    this.logger = new Logger(config.loggerCategory || `repository-${this.getTableName()}`);
  }

  /**
   * Create a new record
   */
  async create(data: TInsert): Promise<TSelect> {
    try {
      // Validate input data
      const validatedData = this.insertSchema.parse(data);
      
      this.logger.debug('Creating record', { table: this.getTableName(), data: validatedData });
      
      return this.drizzleManager.transaction((tx) => {
        // Insert the record
        const result = tx.insert(this.table).values(validatedData as any).returning().all();
        
        if (!result || (Array.isArray(result) && result.length === 0)) {
          throw new RepositoryError(
            'Failed to create record - no result returned',
            'create',
            this.getTableName()
          );
        }

        const created = result[0] as TSelect;
        this.logger.info('Record created successfully', { 
          table: this.getTableName(), 
          id: this.extractId(created) 
        });
        
        return created;
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(
          'Invalid input data for create operation',
          this.getTableName(),
          error
        );
      }
      
      this.logger.error('Failed to create record', { 
        table: this.getTableName(), 
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to create record: ${error instanceof Error ? error.message : String(error)}`,
        'create',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Find a record by its primary key
   */
  async findById(id: string | number): Promise<TSelect | null> {
    try {
      this.logger.debug('Finding record by ID', { table: this.getTableName(), id });
      
      const results = await this.drizzle
        .select()
        .from(this.table)
        .where(eq(this.primaryKey, id))
        .limit(1);

      const record = results[0] as TSelect | undefined;
      
      if (record) {
        this.logger.debug('Record found', { table: this.getTableName(), id });
        return record;
      }
      
      this.logger.debug('Record not found', { table: this.getTableName(), id });
      return null;
    } catch (error) {
      this.logger.error('Failed to find record by ID', { 
        table: this.getTableName(), 
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to find record by ID: ${error instanceof Error ? error.message : String(error)}`,
        'findById',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Find records by a specific field value
   */
  async findByField(field: string, value: any): Promise<TSelect[]> {
    try {
      this.logger.debug('Finding records by field', { 
        table: this.getTableName(), 
        field, 
        value 
      });
      
      // Find the column in the table schema
      const column = this.findColumnByName(field);
      if (!column) {
        throw new RepositoryError(
          `Column ${field} not found in table ${this.getTableName()}`,
          'findByField',
          this.getTableName()
        );
      }

      const results = await this.drizzle
        .select()
        .from(this.table)
        .where(eq(column, value));

      this.logger.debug('Records found by field', { 
        table: this.getTableName(), 
        field, 
        count: results.length 
      });
      
      return results as TSelect[];
    } catch (error) {
      this.logger.error('Failed to find records by field', { 
        table: this.getTableName(), 
        field,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to find records by field: ${error instanceof Error ? error.message : String(error)}`,
        'findByField',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Check if a record exists by primary key
   */
  async exists(id: string | number): Promise<boolean> {
    try {
      const record = await this.findById(id);
      return record !== null;
    } catch (error) {
      this.logger.error('Failed to check record existence', { 
        table: this.getTableName(), 
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to check record existence: ${error instanceof Error ? error.message : String(error)}`,
        'exists',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Update a record by primary key
   */
  async update(id: string | number, data: TUpdate): Promise<TSelect | null> {
    try {
      // Validate update data
      const validatedData = this.updateSchema.parse(data);
      
      this.logger.debug('Updating record', { 
        table: this.getTableName(), 
        id, 
        data: validatedData 
      });
      
      return this.drizzleManager.transaction((tx) => {
        // Check if record exists first (using tx for consistency)
        const existing = tx.select().from(this.table).where(eq(this.primaryKey, id)).get();
        if (!existing) {
          throw new NotFoundError(this.getTableName(), id);
        }

        // Perform update
        const result = tx
          .update(this.table)
          .set(validatedData as any)
          .where(eq(this.primaryKey, id))
          .returning()
          .all();

        if (!result || (Array.isArray(result) && result.length === 0)) {
          throw new RepositoryError(
            'Failed to update record - no result returned',
            'update',
            this.getTableName()
          );
        }

        const updated = result[0] as TSelect;
        this.logger.info('Record updated successfully', { 
          table: this.getTableName(), 
          id 
        });
        
        return updated;
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(
          'Invalid input data for update operation',
          this.getTableName(),
          error
        );
      }
      
      if (error instanceof NotFoundError || error instanceof RepositoryError) {
        throw error;
      }
      
      this.logger.error('Failed to update record', { 
        table: this.getTableName(), 
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to update record: ${error instanceof Error ? error.message : String(error)}`,
        'update',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Delete a record by primary key
   */
  async delete(id: string | number): Promise<boolean> {
    try {
      this.logger.debug('Deleting record', { table: this.getTableName(), id });
      
      return this.drizzleManager.transaction((tx) => {
        // Check if record exists first (using tx for consistency)
        const existing = tx.select().from(this.table).where(eq(this.primaryKey, id)).get();
        if (!existing) {
          this.logger.debug('Record not found for deletion', { table: this.getTableName(), id });
          return false;
        }

        // Perform deletion
        const result = tx
          .delete(this.table)
          .where(eq(this.primaryKey, id))
          .run();

        const deleted = result.changes > 0;
        
        if (deleted) {
          this.logger.info('Record deleted successfully', { table: this.getTableName(), id });
        } else {
          this.logger.warn('No records were deleted', { table: this.getTableName(), id });
        }
        
        return deleted;
      });
    } catch (error) {
      this.logger.error('Failed to delete record', { 
        table: this.getTableName(), 
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to delete record: ${error instanceof Error ? error.message : String(error)}`,
        'delete',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * List records with optional filtering, sorting, and pagination
   */
  async list(options: ListOptions = {}): Promise<PaginatedResult<TSelect>> {
    try {
      const { where, orderBy, limit = 50, offset = 0 } = options;
      
      this.logger.debug('Listing records', { 
        table: this.getTableName(), 
        limit, 
        offset,
        hasWhere: !!where,
        hasOrderBy: !!orderBy
      });

      // Build base query
      let query = this.drizzle.select().from(this.table) as any;
      
      // Apply where clause
      if (where) {
        query = query.where(where);
      }
      
      // Apply ordering
      if (orderBy) {
        if (Array.isArray(orderBy)) {
          query = query.orderBy(...orderBy);
        } else {
          query = query.orderBy(orderBy);
        }
      }
      
      // Apply pagination
      query = query.limit(limit).offset(offset);
      
      // Execute query
      const results = await query;
      
      // Get total count for pagination
      const totalCount = await this.count(where);
      
      const paginatedResult: PaginatedResult<TSelect> = {
        data: results as TSelect[],
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount
      };

      this.logger.debug('Records listed successfully', { 
        table: this.getTableName(), 
        count: results.length,
        total: totalCount,
        hasMore: paginatedResult.hasMore
      });
      
      return paginatedResult;
    } catch (error) {
      this.logger.error('Failed to list records', { 
        table: this.getTableName(),
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to list records: ${error instanceof Error ? error.message : String(error)}`,
        'list',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Count records with optional where clause
   */
  async count(where?: any): Promise<number> {
    try {
      this.logger.debug('Counting records', { 
        table: this.getTableName(),
        hasWhere: !!where
      });

      let query = this.drizzle
        .select({ count: count() })
        .from(this.table) as any;
      
      if (where) {
        query = query.where(where);
      }
      
      const result = await query;
      const recordCount = result[0]?.count || 0;
      
      this.logger.debug('Records counted', { 
        table: this.getTableName(), 
        count: recordCount 
      });
      
      return recordCount;
    } catch (error) {
      this.logger.error('Failed to count records', { 
        table: this.getTableName(),
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to count records: ${error instanceof Error ? error.message : String(error)}`,
        'count',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Create a query builder for complex queries
   */
  query(): QueryBuilder<TSelect> {
    return new DrizzleQueryBuilder(this.drizzle, this.table, this.logger);
  }

  /**
   * Execute multiple operations in a transaction with enhanced error handling
   */
  async transaction<T>(fn: (repository: this) => Promise<T>): Promise<T> {
    const tableName = this.getTableName();
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting repository transaction', { table: tableName });
      
      return await this.drizzleManager.transaction((tx) => {
        // Create a transaction-scoped repository instance
        const txRepository = Object.create(this);
        txRepository.drizzle = tx;
        
        return fn(txRepository);
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error('Repository transaction failed', { 
        table: tableName,
        duration,
        error: errorMessage,
        errorType: error instanceof Error ? error.constructor.name : 'unknown'
      });
      
      // Re-throw specialized errors as-is
      if (error instanceof RepositoryError || error instanceof ValidationError || error instanceof NotFoundError) {
        throw error;
      }
      
      throw new RepositoryError(
        `Transaction failed: ${errorMessage}`,
        'transaction',
        tableName,
        error
      );
    }
  }

  /**
   * Bulk insert operations
   */
  async bulkCreate(data: TInsert[]): Promise<TSelect[]> {
    try {
      // Validate all input data
      const validatedData = data.map(item => this.insertSchema.parse(item));
      
      this.logger.debug('Bulk creating records', { 
        table: this.getTableName(), 
        count: validatedData.length 
      });
      
      return this.drizzleManager.transaction((tx) => {
        const results = tx.insert(this.table).values(validatedData as any).returning().all();
        
        this.logger.info('Bulk create completed successfully', { 
          table: this.getTableName(), 
          count: Array.isArray(results) ? results.length : 1
        });
        
        return results as unknown as TSelect[];
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ValidationError(
          'Invalid input data for bulk create operation',
          this.getTableName(),
          error
        );
      }
      
      this.logger.error('Failed to bulk create records', { 
        table: this.getTableName(),
        count: data.length,
        error: error instanceof Error ? error.message : String(error)
      });
      
      throw new RepositoryError(
        `Failed to bulk create records: ${error instanceof Error ? error.message : String(error)}`,
        'bulkCreate',
        this.getTableName(),
        error
      );
    }
  }

  /**
   * Find column by name (helper method)
   */
  protected findColumnByName(name: string): SQLiteColumn | null {
    // In Drizzle, column names match property names, so we can access them directly
    return (this.table as any)[name] || null;
  }

  /**
   * Extract primary key value from record (helper method)
   */
  protected extractId(record: TSelect): string | number {
    const pkName = this.primaryKey.name;
    return (record as any)[pkName];
  }

  /**
   * Get the table name from the Drizzle table object
   */
  protected getTableName(): string {
    try {
      // Try to get the table name from the symbol first
      const symbolName = (this.table as any)[Symbol.for('drizzle:Name')];
      if (symbolName) {
        return symbolName;
      }
      
      // Fallback to getSQL approach
      return (this.table.getSQL() as any).usedTables[0] || 'unknown-table';
    } catch {
      return 'unknown-table';
    }
  }
}

/**
 * Query builder implementation for complex queries
 */
class DrizzleQueryBuilder<TSelect> implements QueryBuilder<TSelect> {
  private conditions: any[] = [];
  private orderByClause?: any;
  private limitCount?: number;
  private offsetCount?: number;

  constructor(
    private drizzle: BetterSQLite3Database<typeof allTables>,
    private table: SQLiteTable,
    private logger: Logger
  ) {}

  where(condition: any): QueryBuilder<TSelect> {
    this.conditions.push(condition);
    return this;
  }

  orderBy(column: any, direction: 'asc' | 'desc' = 'asc'): QueryBuilder<TSelect> {
    this.orderByClause = direction === 'desc' ? desc(column) : asc(column);
    return this;
  }

  limit(count: number): QueryBuilder<TSelect> {
    this.limitCount = count;
    return this;
  }

  offset(count: number): QueryBuilder<TSelect> {
    this.offsetCount = count;
    return this;
  }

  async execute(): Promise<TSelect[]> {
    let query = this.drizzle.select().from(this.table) as any;
    
    // Apply where conditions
    if (this.conditions.length > 0) {
      const combinedConditions = this.conditions.length === 1 
        ? this.conditions[0] 
        : and(...this.conditions);
      query = query.where(combinedConditions);
    }
    
    // Apply ordering
    if (this.orderByClause) {
      query = query.orderBy(this.orderByClause);
    }
    
    // Apply limit
    if (this.limitCount !== undefined) {
      query = query.limit(this.limitCount);
    }
    
    // Apply offset
    if (this.offsetCount !== undefined) {
      query = query.offset(this.offsetCount);
    }
    
    const results = await query;
    return results as TSelect[];
  }

  async first(): Promise<TSelect | null> {
    const results = await this.limit(1).execute();
    return results[0] || null;
  }

  async count(): Promise<number> {
    let query = this.drizzle.select({ count: count() }).from(this.table) as any;
    
    if (this.conditions.length > 0) {
      const combinedConditions = this.conditions.length === 1 
        ? this.conditions[0] 
        : and(...this.conditions);
      query = query.where(combinedConditions);
    }
    
    const result = await query;
    return result[0]?.count || 0;
  }
}