import { and, eq, desc, like, sql } from "drizzle-orm";
import { BaseRepository, createRepositoryConfig } from "./index.js";
import { DatabaseManager } from "../database/index.js";
import { 
  websites, 
  insertWebsiteSchema,
  selectWebsiteSchema,
  updateWebsiteSchema,
  type Website, 
  type NewWebsite, 
  type WebsiteUpdate 
} from "../schemas/scraping.js";
import { randomUUID } from "crypto";

export class WebsiteRepository extends BaseRepository<
  typeof websites,
  Website,
  NewWebsite,
  WebsiteUpdate
> {
  constructor(drizzleManager: DatabaseManager) {
    super(drizzleManager, createRepositoryConfig(
      websites,
      websites.id,
      insertWebsiteSchema,
      selectWebsiteSchema,
      updateWebsiteSchema,
      "WebsiteRepository"
    ));
  }

  async create(data: NewWebsite): Promise<Website> {
    const website: Website = {
      id: randomUUID(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    };

    return await super.create(website);
  }

  async findById(id: string): Promise<Website | null> {
    return await super.findById(id);
  }

  async findByDomain(domain: string): Promise<Website | null> {
    try {
      const result = await this.drizzle
        .select()
        .from(websites)
        .where(eq(websites.domain, domain))
        .get();

      return result || null;
    } catch (error) {
      this.logger.error("Failed to find website by domain", { error, domain });
      throw error;
    }
  }

  async findOrCreateByDomain(domain: string, defaultData: Partial<NewWebsite> = {}): Promise<Website> {
    try {
      let website = await this.findByDomain(domain);
      
      if (!website) {
        const websiteData: NewWebsite = {
          id: randomUUID(),
          name: defaultData.name || domain,
          domain,
          metaDescription: defaultData.metaDescription,
        };
        website = await this.create(websiteData);
        this.logger.debug("Created new website for domain", { domain, websiteId: website.id });
      }

      return website;
    } catch (error) {
      this.logger.error("Failed to find or create website by domain", { error, domain });
      throw error;
    }
  }

  async update(id: string, data: WebsiteUpdate): Promise<Website | null> {
    const updateData = {
      ...data,
      updatedAt: new Date().toISOString(),
    };

    return await super.update(id, updateData);
  }

  async delete(id: string): Promise<boolean> {
    return await super.delete(id);
  }

  async listWebsites(options: {
    limit?: number;
    offset?: number;
    searchTerm?: string;
  } = {}): Promise<Website[]> {
    try {
      const { limit = 50, offset = 0, searchTerm } = options;

      let query = this.drizzle
        .select()
        .from(websites);

      if (searchTerm) {
        query = query.where(
          sql`${websites.name} LIKE ${"%" + searchTerm + "%"} OR ${websites.domain} LIKE ${"%" + searchTerm + "%"}`
        ) as any;
      }

      const results = await query
        .orderBy(desc(websites.updatedAt))
        .limit(limit)
        .offset(offset)
        .all();

      return results;
    } catch (error) {
      this.logger.error("Failed to list websites", { error, options });
      throw error;
    }
  }

  async count(searchTerm?: string): Promise<number> {
    try {
      let query = this.drizzle
        .select({ count: sql<number>`count(*)` })
        .from(websites);

      if (searchTerm) {
        query = query.where(
          sql`${websites.name} LIKE ${"%" + searchTerm + "%"} OR ${websites.domain} LIKE ${"%" + searchTerm + "%"}`
        ) as any;
      }

      const result = await query.get();
      return result?.count || 0;
    } catch (error) {
      this.logger.error("Failed to count websites", { error, searchTerm });
      throw error;
    }
  }

  extractDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      this.logger.warn("Failed to extract domain from URL", { url, error });
      // Fallback to basic string manipulation
      const match = url.match(/^https?:\/\/([^\/]+)/);
      return match ? match[1] : url;
    }
  }
}