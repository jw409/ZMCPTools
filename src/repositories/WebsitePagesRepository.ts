import { and, eq, desc, like, sql, inArray } from "drizzle-orm";
import { BaseRepository, createRepositoryConfig } from "./index.js";
import { DatabaseManager } from "../database/index.js";
import { 
  websitePages, 
  insertWebsitePageSchema,
  selectWebsitePageSchema,
  updateWebsitePageSchema,
  type WebsitePage, 
  type NewWebsitePage, 
  type WebsitePageUpdate 
} from "../schemas/scraping.js";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

export class WebsitePagesRepository extends BaseRepository<
  typeof websitePages,
  WebsitePage,
  NewWebsitePage,
  WebsitePageUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      websitePages,
      websitePages.id,
      insertWebsitePageSchema,
      selectWebsitePageSchema,
      updateWebsitePageSchema,
      "WebsitePagesRepository"
    ));
  }

  async create(data: NewWebsitePage): Promise<WebsitePage> {
    const page: WebsitePage = {
      id: randomUUID(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    return await super.create(page);
  }

  async findById(id: string): Promise<WebsitePage | null> {
    return await super.findById(id);
  }

  async findByUrl(websiteId: string, url: string): Promise<WebsitePage | null> {
    try {
      const result = await this.query()
        .where(and(
          eq(websitePages.websiteId, websiteId),
          eq(websitePages.url, url)
        ))
        .first();

      return result || null;
    } catch (error) {
      this.logger.error("Failed to find website page by URL", { error, websiteId, url });
      throw error;
    }
  }

  async findByContentHash(websiteId: string, contentHash: string): Promise<WebsitePage | null> {
    try {
      const result = await this.query()
        .where(and(
          eq(websitePages.websiteId, websiteId),
          eq(websitePages.contentHash, contentHash)
        ))
        .first();

      return result || null;
    } catch (error) {
      this.logger.error("Failed to find website page by content hash", { error, websiteId, contentHash });
      throw error;
    }
  }

  async createOrUpdate(data: NewWebsitePage): Promise<{ page: WebsitePage, isNew: boolean }> {
    try {
      const existingPage = await this.findByUrl(data.websiteId, data.url);
      
      if (existingPage) {
        // Check if content has changed by comparing hashes
        if (existingPage.contentHash === data.contentHash) {
          this.logger.debug("Page content unchanged, skipping update", { 
            pageId: existingPage.id, 
            url: data.url 
          });
          return { page: existingPage, isNew: false };
        }

        // Content changed, update the page
        const updatedPage = await this.update(existingPage.id, {
          contentHash: data.contentHash,
          htmlContent: data.htmlContent,
          sanitizedHtmlContent: data.sanitizedHtmlContent,
          markdownContent: data.markdownContent,
          domJsonContent: data.domJsonContent,
          screenshotBase64: data.screenshotBase64,
          screenshotMetadata: data.screenshotMetadata,
          title: data.title,
          selector: data.selector,
          httpStatus: data.httpStatus,
          errorMessage: data.errorMessage,
          javascriptEnabled: data.javascriptEnabled,
        });

        this.logger.debug("Updated website page with new content", { 
          pageId: existingPage.id, 
          url: data.url,
          oldHash: existingPage.contentHash,
          newHash: data.contentHash
        });
        
        return { page: updatedPage!, isNew: false };
      } else {
        // Create new page
        const newPage = await this.create(data);
        return { page: newPage, isNew: true };
      }
    } catch (error) {
      this.logger.error("Failed to create or update website page", { error, data });
      throw error;
    }
  }

  async update(id: string, data: WebsitePageUpdate): Promise<WebsitePage | null> {
    try {
      const updateData = {
        ...data,
        updatedAt: new Date().toISOString(),
      };

      const result = await this.drizzle
        .update(websitePages)
        .set(updateData)
        .where(eq(websitePages.id, id))
        .returning()
        .get();

      this.logger.debug("Updated website page", { pageId: id, fields: Object.keys(data) });
      return result || null;
    } catch (error) {
      this.logger.error("Failed to update website page", { error, id, data });
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      const result = await this.drizzle
        .delete(websitePages)
        .where(eq(websitePages.id, id))
        .returning({ id: websitePages.id });

      const deleted = result.length > 0;
      this.logger.debug("Deleted website page", { pageId: id, deleted });
      return deleted;
    } catch (error) {
      this.logger.error("Failed to delete website page", { error, id });
      throw error;
    }
  }

  async deleteByWebsiteId(websiteId: string): Promise<number> {
    try {
      const result = await this.drizzle
        .delete(websitePages)
        .where(eq(websitePages.websiteId, websiteId))
        .returning({ id: websitePages.id });

      const deletedCount = result.length;
      this.logger.debug("Deleted website pages", { websiteId, deletedCount });
      return deletedCount;
    } catch (error) {
      this.logger.error("Failed to delete website pages", { error, websiteId });
      throw error;
    }
  }

  async listByWebsiteId(websiteId: string, options: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
  } = {}): Promise<WebsitePage[]> {
    try {
      const { limit = 50, offset = 0, searchTerm } = options;

      let whereConditions = eq(websitePages.websiteId, websiteId);

      if (searchTerm) {
        whereConditions = and(
          eq(websitePages.websiteId, websiteId),
          sql`${websitePages.title} LIKE ${"%" + searchTerm + "%"} OR ${websitePages.url} LIKE ${"%" + searchTerm + "%"}`
        );
      }

      const results = await this.query()
        .where(whereConditions)
        .orderBy(websitePages.updatedAt, 'desc')
        .limit(limit)
        .offset(offset)
        .execute();

      return results;
    } catch (error) {
      this.logger.error("Failed to list website pages", { error, websiteId, options });
      throw error;
    }
  }

  async countByWebsiteId(websiteId: string, searchTerm?: string): Promise<number> {
    try {
      let whereConditions = eq(websitePages.websiteId, websiteId);

      if (searchTerm) {
        whereConditions = and(
          eq(websitePages.websiteId, websiteId),
          sql`${websitePages.title} LIKE ${"%" + searchTerm + "%"} OR ${websitePages.url} LIKE ${"%" + searchTerm + "%"}`
        );
      }

      const result = await this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(websitePages)
        .where(whereConditions)
        .get();
        
      return result?.count || 0;
    } catch (error) {
      this.logger.error("Failed to count website pages", { error, websiteId, searchTerm });
      throw error;
    }
  }

  async getPagesForVectorIndexing(websiteId: string, limit = 100): Promise<Array<{
    id: string;
    url: string;
    title?: string;
    markdownContent?: string;
    websiteId: string;
  }>> {
    try {
      const results = await this.drizzle
        .select({
          id: websitePages.id,
          url: websitePages.url,
          title: websitePages.title,
          markdownContent: websitePages.markdownContent,
          websiteId: websitePages.websiteId,
        })
        .from(websitePages)
        .where(and(
          eq(websitePages.websiteId, websiteId),
          sql`${websitePages.markdownContent} IS NOT NULL AND ${websitePages.markdownContent} != ''`
        ))
        .limit(limit)
        .all();

      return results;
    } catch (error) {
      this.logger.error("Failed to get pages for vector indexing", { error, websiteId, limit });
      throw error;
    }
  }

  // Helper method to generate content hash
  generateContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // Helper method to normalize URL (remove fragments, tracking params, etc.)
  normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      
      // Remove fragment
      urlObj.hash = '';
      
      // Remove common tracking parameters
      const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
        'fbclid', 'gclid', 'ref', 'source'
      ];
      
      trackingParams.forEach(param => {
        urlObj.searchParams.delete(param);
      });
      
      // Sort search params for consistency
      urlObj.searchParams.sort();
      
      // Remove trailing slash from pathname (except root)
      if (urlObj.pathname.length > 1 && urlObj.pathname.endsWith('/')) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      
      return urlObj.toString();
    } catch (error) {
      this.logger.warn("Failed to normalize URL", { url, error });
      return url;
    }
  }
}