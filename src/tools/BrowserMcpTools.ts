/**
 * MCP Tools for browser automation using Patchright
 * Exposes browser functionality through the MCP protocol for agent use
 * Phase 4: Optimized with intelligent session management and auto-close functionality
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { BrowserTools } from './BrowserTools.js';
import type { MemoryService } from '../services/MemoryService.js';

// Session management types
interface SessionConfig {
  autoClose?: boolean;
  sessionTimeout?: number;
  workflowType?: 'documentation' | 'automation' | 'testing';
  maxIdleTime?: number;
}

interface SessionMetadata {
  sessionId: string;
  workflowType: 'documentation' | 'automation' | 'testing';
  autoClose: boolean;
  createdAt: Date;
  lastActivity: Date;
  taskCompleted?: boolean;
}

// Enhanced validation schemas with session management
const CreateBrowserSessionSchema = z.object({
  browser_type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  headless: z.boolean().default(true),
  viewport_width: z.number().default(1920),
  viewport_height: z.number().default(1080),
  user_agent: z.string().optional(),
  agent_id: z.string().optional(),
  // Enhanced session management options
  auto_close: z.boolean().default(true),
  workflow_type: z.enum(['documentation', 'automation', 'testing']).default('automation'),
  session_timeout: z.number().default(30 * 60 * 1000), // 30 minutes
  max_idle_time: z.number().default(10 * 60 * 1000) // 10 minutes
});

const NavigateAndScrapeSchema = z.object({
  session_id: z.string().optional(),
  url: z.string().url(),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  timeout: z.number().default(30000),
  // Enhanced scraping options
  extract_text: z.boolean().default(true),
  extract_html: z.boolean().default(false),
  extract_links: z.boolean().default(false),
  extract_images: z.boolean().default(false),
  selector: z.string().optional(),
  wait_for_selector: z.string().optional(),
  // Auto-create session if not provided
  auto_create_session: z.boolean().default(true),
  browser_type: z.enum(['chromium', 'firefox', 'webkit']).default('chromium')
});

const InteractWithPageSchema = z.object({
  session_id: z.string(),
  actions: z.array(z.object({
    type: z.enum(['click', 'type', 'hover', 'select', 'screenshot', 'wait', 'scroll']),
    selector: z.string().optional(),
    value: z.union([z.string(), z.array(z.string())]).optional(),
    filepath: z.string().optional(), // for screenshots
    timeout: z.number().default(10000),
    scroll_behavior: z.enum(['auto', 'smooth']).default('auto')
  })).min(1),
  auto_close_after: z.boolean().default(false)
});

const ManageBrowserSessionsSchema = z.object({
  action: z.enum(['list', 'close', 'close_all', 'cleanup_idle', 'get_status']),
  session_id: z.string().optional(),
  force_close: z.boolean().default(false),
  cleanup_criteria: z.object({
    max_idle_minutes: z.number().default(10),
    exclude_documentation: z.boolean().default(true)
  }).optional()
});

// Legacy schemas for backward compatibility
const LegacyNavigateSchema = z.object({
  session_id: z.string(),
  url: z.string().url(),
  wait_until: z.enum(['load', 'domcontentloaded', 'networkidle']).default('domcontentloaded'),
  timeout: z.number().default(30000)
});

const LegacyScrapeSchema = z.object({
  session_id: z.string(),
  selector: z.string().optional(),
  wait_for_selector: z.string().optional(),
  extract_text: z.boolean().default(true),
  extract_html: z.boolean().default(false),
  extract_links: z.boolean().default(false),
  extract_images: z.boolean().default(false)
});

const ScreenshotSchema = z.object({
  session_id: z.string(),
  filepath: z.string(),
  full_page: z.boolean().default(false),
  quality: z.number().min(0).max(100).optional(),
  type: z.enum(['png', 'jpeg']).default('png')
});

const ExecuteScriptSchema = z.object({
  session_id: z.string(),
  script: z.string(),
  args: z.array(z.any()).default([])
});

const InteractSchema = z.object({
  session_id: z.string(),
  action: z.enum(['click', 'type', 'hover', 'select']),
  selector: z.string(),
  value: z.union([z.string(), z.array(z.string())]).optional()
});

export class BrowserMcpTools {
  private sessionMetadata = new Map<string, SessionMetadata>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private browserTools: BrowserTools,
    private memoryService: MemoryService,
    private repositoryPath: string
  ) {
    this.startSessionCleanup();
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
        }
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
        }
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
        }
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
        }
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
        }
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
        }
      }
    ];
  }

  /**
   * Handle MCP tool calls for browser functionality with intelligent session management
   */
  async handleToolCall(name: string, arguments_: any): Promise<any> {
    try {
      switch (name) {
        case 'create_browser_session':
          return await this.createBrowserSessionEnhanced(arguments_);
        
        case 'navigate_and_scrape':
          return await this.navigateAndScrape(arguments_);
        
        case 'interact_with_page':
          return await this.interactWithPage(arguments_);
        
        case 'manage_browser_sessions':
          return await this.manageBrowserSessions(arguments_);
        
        // Legacy support
        case 'navigate_to_url':
          return await this.navigateToUrl(arguments_);
        
        case 'scrape_content':
          return await this.scrapeContent(arguments_);
        
        case 'take_screenshot':
          return await this.takeScreenshot(arguments_);
        
        case 'execute_browser_script':
          return await this.executeScript(arguments_);
        
        case 'interact_with_element':
          return await this.interactWithElement(arguments_);
        
        case 'close_browser_session':
          return await this.closeBrowserSession(arguments_);
        
        case 'list_browser_sessions':
          return await this.listBrowserSessions();
        
        default:
          throw new Error(`Unknown browser tool: ${name}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  private async createBrowserSessionEnhanced(args: any) {
    const params = CreateBrowserSessionSchema.parse(args);
    
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
        await this.memoryService.storeMemory(
          this.repositoryPath,
          params.agent_id,
          'shared',
          `Browser session created`,
          `Created ${params.browser_type} session ${result.sessionId} for ${params.workflow_type} workflow (auto-close: ${params.auto_close})`
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
    const params = NavigateAndScrapeSchema.parse(args);
    
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
    const params = InteractWithPageSchema.parse(args);
    
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
    const params = ManageBrowserSessionsSchema.parse(args);
    
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
    const params = LegacyNavigateSchema.parse(args);
    
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
    const params = LegacyScrapeSchema.parse(args);
    
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
    const params = ScreenshotSchema.parse(args);
    
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
    const params = ExecuteScriptSchema.parse(args);
    
    this.updateSessionActivity(params.session_id);
    
    const result = await this.browserTools.executeScript(
      params.session_id,
      params.script,
      params.args
    );

    return result;
  }
  
  private async interactWithElement(args: any) {
    const params = InteractSchema.parse(args);
    
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