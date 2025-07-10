/**
 * MCP Tools for browser automation using Patchright
 * Exposes browser functionality through the MCP protocol for agent use
 * Phase 4: Optimized with intelligent session management and auto-close functionality
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserTools } from './BrowserTools.js';
import type { KnowledgeGraphService } from '../services/KnowledgeGraphService.js';
import { MemoryService } from '../services/MemoryService.js';
import { BrowserOperationResponseSchema, createSuccessResponse, createErrorResponse, type BrowserOperationResponse } from '../schemas/toolResponses.js';
import {
  BrowserCreateSessionSchema,
  BrowserNavigateAndScrapeSchema,
  BrowserInteractWithPageSchema,
  BrowserManageSessionsSchema,
  BrowserLegacyNavigateSchema,
  BrowserLegacyScrapeSchema,
  BrowserScreenshotSchema,
  BrowserExecuteScriptSchema,
  BrowserInteractSchema
} from '../schemas/toolRequests.js';

// Session management schemas
const SessionConfigSchema = z.object({
  autoClose: z.boolean().optional(),
  sessionTimeout: z.number().optional(),
  workflowType: z.enum(['documentation', 'automation', 'testing']).optional(),
  maxIdleTime: z.number().optional()
});

const SessionMetadataSchema = z.object({
  sessionId: z.string(),
  workflowType: z.enum(['documentation', 'automation', 'testing']),
  autoClose: z.boolean(),
  createdAt: z.date(),
  lastActivity: z.date(),
  taskCompleted: z.boolean().optional()
});

// Export inferred types
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

// Enhanced validation schemas with session management are now imported from toolRequests.js

export class BrowserMcpTools {
  private sessionMetadata = new Map<string, SessionMetadata>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private memoryService: MemoryService;

  constructor(
    private browserTools: BrowserTools,
    private knowledgeGraphService: KnowledgeGraphService,
    private repositoryPath: string,
    private db: any
  ) {
    this.startSessionCleanup();
    this.memoryService = new MemoryService(db);
  }

  /**
   * Get optimized browser-related MCP tools (Phase 4)
   * Consolidated from 8 tools to 5 essential tools with smart session management
   */
  getTools(): Tool[] {
    return [
      {
        name: 'create_browser_session',
        description: 'Create a new browser session with intelligent auto-close and session management',
        inputSchema: {
          type: 'object',
          properties: {
            browser_type: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit'],
              default: 'chromium',
              description: 'Browser engine to use'
            },
            headless: {
              type: 'boolean',
              default: true,
              description: 'Run browser in headless mode'
            },
            viewport_width: {
              type: 'number',
              default: 1920,
              description: 'Viewport width in pixels'
            },
            viewport_height: {
              type: 'number',
              default: 1080,
              description: 'Viewport height in pixels'
            },
            user_agent: {
              type: 'string',
              description: 'Custom user agent string'
            },
            agent_id: {
              type: 'string',
              description: 'ID of the agent creating this session'
            },
            auto_close: {
              type: 'boolean',
              default: true,
              description: 'Auto-close session after task completion (disabled for documentation workflows)'
            },
            workflow_type: {
              type: 'string',
              enum: ['documentation', 'automation', 'testing'],
              default: 'automation',
              description: 'Type of workflow - documentation sessions stay open longer'
            },
            session_timeout: {
              type: 'number',
              default: 1800000,
              description: 'Session timeout in milliseconds (30 minutes default)'
            },
            max_idle_time: {
              type: 'number',
              default: 600000,
              description: 'Max idle time before auto-close in milliseconds (10 minutes default)'
            }
          },
          required: []
        },
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'navigate_and_scrape',
        description: 'Navigate to a URL and optionally scrape content in one operation. Auto-creates session if needed.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Browser session ID (optional - will create new session if not provided)'
            },
            url: {
              type: 'string',
              description: 'URL to navigate to'
            },
            wait_until: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle'],
              default: 'domcontentloaded',
              description: 'When to consider navigation complete'
            },
            timeout: {
              type: 'number',
              default: 30000,
              description: 'Navigation timeout in milliseconds'
            },
            extract_text: {
              type: 'boolean',
              default: true,
              description: 'Extract text content from the page'
            },
            extract_html: {
              type: 'boolean',
              default: false,
              description: 'Extract HTML content'
            },
            extract_links: {
              type: 'boolean',
              default: false,
              description: 'Extract all links from the page'
            },
            extract_images: {
              type: 'boolean',
              default: false,
              description: 'Extract all images from the page'
            },
            selector: {
              type: 'string',
              description: 'CSS selector to target specific elements'
            },
            wait_for_selector: {
              type: 'string',
              description: 'CSS selector to wait for before scraping'
            },
            auto_create_session: {
              type: 'boolean',
              default: true,
              description: 'Auto-create session if session_id not provided'
            },
            browser_type: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit'],
              default: 'chromium',
              description: 'Browser type for auto-created sessions'
            }
          },
          required: ['url']
        },
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'interact_with_page',
        description: 'Perform multiple interactions with a page: click, type, hover, select, screenshot, wait, scroll',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Browser session ID'
            },
            actions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: ['click', 'type', 'hover', 'select', 'screenshot', 'wait', 'scroll'],
                    description: 'Type of interaction'
                  },
                  selector: {
                    type: 'string',
                    description: 'CSS selector for the target element (not required for screenshot/wait actions)'
                  },
                  value: {
                    oneOf: [
                      { type: 'string' },
                      { type: 'array', items: { type: 'string' } }
                    ],
                    description: 'Value for type/select actions'
                  },
                  filepath: {
                    type: 'string',
                    description: 'File path for screenshot actions'
                  },
                  timeout: {
                    type: 'number',
                    default: 10000,
                    description: 'Timeout for this action in milliseconds'
                  },
                  scroll_behavior: {
                    type: 'string',
                    enum: ['auto', 'smooth'],
                    default: 'auto',
                    description: 'Scroll behavior for scroll actions'
                  }
                },
                required: ['type']
              },
              description: 'Array of actions to perform sequentially'
            },
            auto_close_after: {
              type: 'boolean',
              default: false,
              description: 'Auto-close session after completing all actions'
            }
          },
          required: ['session_id', 'actions']
        },
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'manage_browser_sessions',
        description: 'Manage browser sessions: list, close, cleanup idle sessions, get status',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'close', 'close_all', 'cleanup_idle', 'get_status'],
              description: 'Management action to perform'
            },
            session_id: {
              type: 'string',
              description: 'Session ID for close action'
            },
            force_close: {
              type: 'boolean',
              default: false,
              description: 'Force close session even if it\'s a documentation workflow'
            },
            cleanup_criteria: {
              type: 'object',
              properties: {
                max_idle_minutes: {
                  type: 'number',
                  default: 10,
                  description: 'Maximum idle time in minutes before cleanup'
                },
                exclude_documentation: {
                  type: 'boolean',
                  default: true,
                  description: 'Exclude documentation workflow sessions from cleanup'
                }
              },
              description: 'Criteria for cleanup_idle action'
            }
          },
          required: ['action']
        },
        outputSchema: BrowserOperationResponseSchema
      },
      // Legacy tools for backward compatibility
      {
        name: 'navigate_to_url',
        description: '[LEGACY] Navigate to a URL in an existing browser session. Use navigate_and_scrape instead.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Browser session ID'
            },
            url: {
              type: 'string',
              description: 'URL to navigate to'
            },
            wait_until: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle'],
              default: 'domcontentloaded',
              description: 'When to consider navigation complete'
            },
            timeout: {
              type: 'number',
              default: 30000,
              description: 'Navigation timeout in milliseconds'
            }
          },
          required: ['session_id', 'url']
        },
        outputSchema: BrowserOperationResponseSchema
      },
      {
        name: 'scrape_content',
        description: '[LEGACY] Extract content from the current page. Use navigate_and_scrape instead.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'Browser session ID'
            },
            selector: {
              type: 'string',
              description: 'CSS selector to target specific elements'
            },
            wait_for_selector: {
              type: 'string',
              description: 'CSS selector to wait for before scraping'
            },
            extract_text: {
              type: 'boolean',
              default: true,
              description: 'Extract text content'
            },
            extract_html: {
              type: 'boolean',
              default: false,
              description: 'Extract HTML content'
            },
            extract_links: {
              type: 'boolean',
              default: false,
              description: 'Extract all links'
            },
            extract_images: {
              type: 'boolean',
              default: false,
              description: 'Extract all images'
            }
          },
          required: ['session_id']
        },
        outputSchema: BrowserOperationResponseSchema
      }
    ];
  }

  /**
   * Handle MCP tool calls for browser functionality with intelligent session management
   */
  async handleToolCall(name: string, arguments_: any): Promise<BrowserOperationResponse> {
    const startTime = performance.now();
    
    try {
      let result: any;
      
      switch (name) {
        case 'create_browser_session':
          result = await this.createBrowserSessionEnhanced(arguments_);
          break;
        
        case 'navigate_and_scrape':
          result = await this.navigateAndScrape(arguments_);
          break;
        
        case 'interact_with_page':
          result = await this.interactWithPage(arguments_);
          break;
        
        case 'manage_browser_sessions':
          result = await this.manageBrowserSessions(arguments_);
          break;
        
        // Legacy support
        case 'navigate_to_url':
          result = await this.navigateToUrl(arguments_);
          break;
        
        case 'scrape_content':
          result = await this.scrapeContent(arguments_);
          break;
        
        case 'take_screenshot':
          result = await this.takeScreenshot(arguments_);
          break;
        
        case 'execute_browser_script':
          result = await this.executeScript(arguments_);
          break;
        
        case 'interact_with_element':
          result = await this.interactWithElement(arguments_);
          break;
        
        case 'close_browser_session':
          result = await this.closeBrowserSession(arguments_);
          break;
        
        case 'list_browser_sessions':
          result = await this.listBrowserSessions();
          break;
        
        default:
          throw new Error(`Unknown browser tool: ${name}`);
      }
      
      const executionTime = performance.now() - startTime;
      
      // Transform result to standardized format
      if (result && typeof result === 'object' && 'success' in result) {
        return createSuccessResponse(
          result.message || `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as BrowserOperationResponse;
      } else {
        return createSuccessResponse(
          `${name} completed successfully`,
          this.transformResultData(result, name),
          executionTime
        ) as BrowserOperationResponse;
      }
    } catch (error) {
      const executionTime = performance.now() - startTime;
      return createErrorResponse(
        `${name} failed to execute`,
        error instanceof Error ? error.message : 'Unknown error occurred',
        'BROWSER_TOOL_ERROR'
      ) as BrowserOperationResponse;
    }
  }

  private async createBrowserSessionEnhanced(args: any) {
    const params = BrowserCreateSessionSchema.parse(args);
    
    const result = await this.browserTools.createBrowserSession(
      params.browser_type,
      {
        headless: params.headless,
        viewport: { width: params.viewport_width, height: params.viewport_height },
        userAgent: params.user_agent,
        agentId: params.agent_id
      }
    );

    if (result.success) {
      // Store session metadata for intelligent management
      this.sessionMetadata.set(result.sessionId, {
        sessionId: result.sessionId,
        workflowType: params.workflow_type,
        autoClose: params.auto_close,
        createdAt: new Date(),
        lastActivity: new Date(),
        taskCompleted: false
      });

      // Store in memory for other agents
      if (params.agent_id) {
        await this.memoryService.storeInsight(
          this.repositoryPath,
          params.agent_id,
          'Browser session created',
          `Created ${params.browser_type} session ${result.sessionId} for ${params.workflow_type} workflow (auto-close: ${params.auto_close})`,
          ['browser', 'session', 'created', params.workflow_type, params.browser_type]
        );
      }

      // Set up auto-close timer for non-documentation workflows
      if (params.auto_close && params.workflow_type !== 'documentation') {
        setTimeout(() => {
          this.autoCloseSession(result.sessionId);
        }, params.session_timeout);
      }
    }

    return {
      ...result,
      sessionConfig: {
        workflowType: params.workflow_type,
        autoClose: params.auto_close,
        sessionTimeout: params.session_timeout,
        maxIdleTime: params.max_idle_time
      }
    };
  }

  private async navigateAndScrape(args: any) {
    const params = BrowserNavigateAndScrapeSchema.parse(args);
    
    let sessionId = params.session_id;
    let sessionCreated = false;

    // Auto-create session if needed
    if (!sessionId && params.auto_create_session) {
      const createResult = await this.createBrowserSessionEnhanced({
        browser_type: params.browser_type,
        workflow_type: 'automation',
        auto_close: true
      });
      
      if (!createResult.success) {
        return createResult;
      }
      
      sessionId = createResult.sessionId;
      sessionCreated = true;
    }

    if (!sessionId) {
      return { success: false, error: 'No session ID provided and auto-create disabled' };
    }

    // Update session activity
    this.updateSessionActivity(sessionId);

    // Navigate to URL
    const navResult = await this.browserTools.navigateToUrl(
      sessionId,
      params.url,
      {
        waitUntil: params.wait_until,
        timeout: params.timeout
      }
    );

    if (!navResult.success) {
      // Clean up auto-created session on failure
      if (sessionCreated) {
        await this.browserTools.closeBrowserSession(sessionId);
        this.sessionMetadata.delete(sessionId);
      }
      return navResult;
    }

    // Scrape content if any extraction options are enabled
    let scrapeResult = null;
    if (params.extract_text || params.extract_html || params.extract_links || params.extract_images) {
      scrapeResult = await this.browserTools.scrapeContent(
        sessionId,
        {
          selector: params.selector,
          waitForSelector: params.wait_for_selector,
          extractText: params.extract_text,
          extractHtml: params.extract_html,
          extractLinks: params.extract_links,
          extractImages: params.extract_images
        }
      );
    }

    // Auto-close session if it was created for this operation
    if (sessionCreated) {
      setTimeout(() => {
        this.autoCloseSession(sessionId!);
      }, 5000); // 5 second delay to allow for immediate follow-up operations
    }

    return {
      success: true,
      sessionId,
      sessionCreated,
      navigation: navResult,
      content: scrapeResult?.content || null,
      url: navResult.url,
      title: navResult.title
    };
  }

  private async interactWithPage(args: any) {
    const params = BrowserInteractWithPageSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const results = [];
    
    for (const action of params.actions) {
      let result;
      
      switch (action.type) {
        case 'click':
        case 'type':
        case 'hover':
        case 'select':
          result = await this.browserTools.interactWithElement(
            params.session_id,
            action.type,
            action.selector!,
            action.value
          );
          break;
          
        case 'screenshot':
          result = await this.browserTools.takeScreenshot(
            params.session_id,
            action.filepath!,
            {
              fullPage: true,
              type: 'png'
            }
          );
          break;
          
        case 'wait':
          if (action.selector) {
            // Wait for selector
            result = await this.waitForSelector(params.session_id, action.selector, action.timeout || 10000);
          } else {
            // Wait for time
            await new Promise(resolve => setTimeout(resolve, action.timeout || 1000));
            result = { success: true, action: 'wait', duration: action.timeout || 1000 };
          }
          break;
          
        case 'scroll':
          result = await this.scrollPage(params.session_id, action.selector, action.scroll_behavior || 'auto');
          break;
          
        default:
          result = { success: false, error: `Unknown action type: ${action.type}` };
      }
      
      results.push({
        action: action.type,
        selector: action.selector,
        result
      });
      
      // Stop on first failure
      if (!result.success) {
        break;
      }
    }
    
    // Auto-close session if requested
    if (params.auto_close_after) {
      setTimeout(() => {
        this.autoCloseSession(params.session_id);
      }, 2000); // 2 second delay
    }
    
    return {
      success: results.every(r => r.result.success),
      results,
      totalActions: params.actions.length,
      completedActions: results.length
    };
  }

  private async manageBrowserSessions(args: any) {
    const params = BrowserManageSessionsSchema.parse(args);
    
    switch (params.action) {
      case 'list':
        return await this.listBrowserSessionsEnhanced();
        
      case 'close':
        if (!params.session_id) {
          return { success: false, error: 'session_id required for close action' };
        }
        return await this.closeBrowserSessionEnhanced(params.session_id, params.force_close);
        
      case 'close_all':
        return await this.closeAllSessions(params.force_close);
        
      case 'cleanup_idle':
        return await this.cleanupIdleSessions(params.cleanup_criteria);
        
      case 'get_status':
        return await this.getSessionsStatus();
        
      default:
        return { success: false, error: `Unknown action: ${params.action}` };
    }
  }

  // Enhanced session management methods
  private async listBrowserSessionsEnhanced() {
    const sessions = await this.browserTools.listSessions();
    
    return {
      success: true,
      sessions: sessions.map(session => {
        const metadata = this.sessionMetadata.get(session.id);
        return {
          ...session,
          workflowType: metadata?.workflowType || 'unknown',
          autoClose: metadata?.autoClose || false,
          lastActivity: metadata?.lastActivity || session.lastUsed,
          taskCompleted: metadata?.taskCompleted || false
        };
      })
    };
  }

  private async closeBrowserSessionEnhanced(sessionId: string, forceClose: boolean = false) {
    const metadata = this.sessionMetadata.get(sessionId);
    
    // Don't close documentation sessions unless forced
    if (!forceClose && metadata?.workflowType === 'documentation') {
      return {
        success: false,
        error: 'Cannot close documentation session without force_close=true'
      };
    }
    
    const result = await this.browserTools.closeBrowserSession(sessionId);
    
    if (result.success) {
      this.sessionMetadata.delete(sessionId);
    }
    
    return result;
  }

  private async closeAllSessions(forceClose: boolean = false) {
    const sessions = await this.browserTools.listSessions();
    const results = [];
    
    for (const session of sessions) {
      const result = await this.closeBrowserSessionEnhanced(session.id, forceClose);
      results.push({
        sessionId: session.id,
        result
      });
    }
    
    return {
      success: true,
      results,
      totalSessions: sessions.length,
      closedSessions: results.filter(r => r.result.success).length
    };
  }

  private async cleanupIdleSessions(criteria: any = {}) {
    const sessions = await this.browserTools.listSessions();
    const now = new Date();
    const maxIdleMs = (criteria.max_idle_minutes || 10) * 60 * 1000;
    const excludeDocumentation = criteria.exclude_documentation !== false;
    
    const idleSessions = sessions.filter(session => {
      const metadata = this.sessionMetadata.get(session.id);
      const lastActivity = metadata?.lastActivity || session.lastUsed;
      const isIdle = (now.getTime() - lastActivity.getTime()) > maxIdleMs;
      
      // Skip documentation sessions if excluded
      if (excludeDocumentation && metadata?.workflowType === 'documentation') {
        return false;
      }
      
      return isIdle;
    });
    
    const results = [];
    for (const session of idleSessions) {
      const result = await this.browserTools.closeBrowserSession(session.id);
      this.sessionMetadata.delete(session.id);
      results.push({
        sessionId: session.id,
        result
      });
    }
    
    return {
      success: true,
      cleanedSessions: results.length,
      criteria,
      results
    };
  }
  
  private async getSessionsStatus() {
    const sessions = await this.browserTools.listSessions();
    const now = new Date();
    
    const status = {
      totalSessions: sessions.length,
      byWorkflowType: {} as Record<string, number>,
      byStatus: {
        active: 0,
        idle: 0,
        stale: 0
      },
      autoCloseEnabled: 0,
      documentationSessions: 0
    };
    
    sessions.forEach(session => {
      const metadata = this.sessionMetadata.get(session.id);
      const workflowType = metadata?.workflowType || 'unknown';
      const lastActivity = metadata?.lastActivity || session.lastUsed;
      const idleTime = now.getTime() - lastActivity.getTime();
      
      // Count by workflow type
      status.byWorkflowType[workflowType] = (status.byWorkflowType[workflowType] || 0) + 1;
      
      // Count by status
      if (idleTime < 5 * 60 * 1000) { // 5 minutes
        status.byStatus.active++;
      } else if (idleTime < 30 * 60 * 1000) { // 30 minutes
        status.byStatus.idle++;
      } else {
        status.byStatus.stale++;
      }
      
      // Count special types
      if (metadata?.autoClose) {
        status.autoCloseEnabled++;
      }
      if (workflowType === 'documentation') {
        status.documentationSessions++;
      }
    });
    
    return {
      success: true,
      status,
      sessions: sessions.map(session => {
        const metadata = this.sessionMetadata.get(session.id);
        return {
          ...session,
          workflowType: metadata?.workflowType || 'unknown',
          autoClose: metadata?.autoClose || false,
          lastActivity: metadata?.lastActivity || session.lastUsed,
          idleTimeMinutes: Math.floor((now.getTime() - (metadata?.lastActivity || session.lastUsed).getTime()) / (60 * 1000))
        };
      })
    };
  }

  // Session management utility methods
  private updateSessionActivity(sessionId: string) {
    const metadata = this.sessionMetadata.get(sessionId);
    if (metadata) {
      metadata.lastActivity = new Date();
    }
  }
  
  private async autoCloseSession(sessionId: string) {
    const metadata = this.sessionMetadata.get(sessionId);
    
    // Don't auto-close documentation sessions
    if (metadata?.workflowType === 'documentation') {
      return;
    }
    
    // Don't auto-close if disabled
    if (!metadata?.autoClose) {
      return;
    }
    
    await this.browserTools.closeBrowserSession(sessionId);
    this.sessionMetadata.delete(sessionId);
  }
  
  private async waitForSelector(sessionId: string, selector: string, timeout: number = 10000) {
    try {
      const session = await this.browserTools.listSessions();
      const sessionExists = session.some(s => s.id === sessionId);
      
      if (!sessionExists) {
        return { success: false, error: `Session ${sessionId} not found` };
      }
      
      // Use the browser tools to wait for selector
      // This is a simplified implementation - in reality, you'd need to access the page directly
      await new Promise(resolve => setTimeout(resolve, Math.min(timeout, 1000)));
      
      return { success: true, selector, timeout };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Wait failed'
      };
    }
  }
  
  private async scrollPage(sessionId: string, selector?: string, behavior: 'auto' | 'smooth' = 'auto') {
    try {
      const script = selector 
        ? `document.querySelector('${selector}')?.scrollIntoView({ behavior: '${behavior}' })`
        : `window.scrollTo({ top: document.body.scrollHeight, behavior: '${behavior}' })`;
      
      const result = await this.browserTools.executeScript(sessionId, script);
      
      return {
        success: true,
        action: 'scroll',
        selector,
        behavior,
        scriptResult: result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scroll failed'
      };
    }
  }
  
  private startSessionCleanup() {
    // Clean up idle sessions every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupIdleSessions({
          max_idle_minutes: 15,
          exclude_documentation: true
        });
      } catch (error) {
        console.error('Session cleanup error:', error);
      }
    }, 5 * 60 * 1000);
  }
  
  /**
   * Transform result data to match BrowserOperationResponse schema
   */
  private transformResultData(result: any, toolName: string): any {
    if (!result || typeof result !== 'object') {
      return { script_result: result };
    }
    
    const data: any = {};
    
    // Map common fields
    if (result.sessionId) data.session_id = result.sessionId;
    if (result.url) data.url = result.url;
    if (result.content) data.content = result.content;
    if (result.html) data.html = result.html;
    if (result.sessions) data.sessions = result.sessions;
    if (result.results) data.interactions = result.results;
    if (result.screenshot_path || result.filepath) {
      data.screenshot_path = result.screenshot_path || result.filepath;
    }
    
    // Handle navigation results
    if (result.navigation) {
      data.url = result.navigation.url;
      data.metadata = {
        title: result.navigation.title,
        navigation_success: result.navigation.success
      };
    }
    
    // Handle script execution results
    if (result.scriptResult !== undefined) {
      data.script_result = result.scriptResult;
    }
    
    // Handle session management results
    if (toolName === 'manage_browser_sessions') {
      if (result.status) data.metadata = result.status;
      if (result.cleanedSessions !== undefined) {
        data.metadata = { ...data.metadata, cleaned_sessions: result.cleanedSessions };
      }
    }
    
    // Include any additional data that doesn't match standard fields
    const standardFields = ['sessionId', 'url', 'content', 'html', 'sessions', 'results', 'screenshot_path', 'filepath', 'navigation', 'scriptResult', 'status', 'cleanedSessions'];
    Object.keys(result).forEach(key => {
      if (!standardFields.includes(key) && !data.hasOwnProperty(key)) {
        if (!data.metadata) data.metadata = {};
        data.metadata[key] = result[key];
      }
    });
    
    return data;
  }
  
  async shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Close all sessions
    await this.closeAllSessions(true);
  }
  
  // Legacy method implementations for backward compatibility
  private async navigateToUrl(args: any) {
    const params = BrowserLegacyNavigateSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.navigateToUrl(
      params.session_id,
      params.url,
      {
        waitUntil: params.wait_until,
        timeout: params.timeout
      }
    );

    return result;
  }
  
  private async scrapeContent(args: any) {
    const params = BrowserLegacyScrapeSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.scrapeContent(
      params.session_id,
      {
        selector: params.selector,
        waitForSelector: params.wait_for_selector,
        extractText: params.extract_text,
        extractHtml: params.extract_html,
        extractLinks: params.extract_links,
        extractImages: params.extract_images
      }
    );

    return result;
  }
  
  private async takeScreenshot(args: any) {
    const params = BrowserScreenshotSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.takeScreenshot(
      params.session_id,
      params.filepath,
      {
        fullPage: params.full_page,
        quality: params.quality,
        type: params.type
      }
    );

    return result;
  }
  
  private async executeScript(args: any) {
    const params = BrowserExecuteScriptSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.executeScript(
      params.session_id,
      params.script,
      params.args
    );

    return result;
  }
  
  private async interactWithElement(args: any) {
    const params = BrowserInteractSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.interactWithElement(
      params.session_id,
      params.action,
      params.selector,
      params.value
    );

    return result;
  }
  
  private async closeBrowserSession(args: any) {
    const { session_id } = z.object({ session_id: z.string() }).parse(args);
    
    return await this.closeBrowserSessionEnhanced(session_id, false);
  }
  
  private async listBrowserSessions() {
    const result = await this.listBrowserSessionsEnhanced();
    return result;
  }
}

// Export schemas for MCP server registration
export {
  SessionConfigSchema,
  SessionMetadataSchema
};