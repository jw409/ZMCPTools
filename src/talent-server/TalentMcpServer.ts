/**
 * Talent MCP Server (DomU)
 *
 * Provides coordination tools for talent-to-talent communication.
 * Separate from global orchestrator (Dom0) to prevent tool namespace pollution.
 *
 * Key Features:
 * - Email communication between talents
 * - Meeting participation and coordination
 * - Cooperative path resolution via /tmp registration
 * - Minimal dependencies (no coupling to global server)
 *
 * Usage:
 *   node dist/talent-server/index.js --talent-id backend-boris-001 --transport stdio
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import express from 'express';
import http from 'http';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TalentEmailTools } from '../tools/TalentEmailTools.js';
import { TalentMeetingTools } from '../tools/TalentMeetingTools.js';

const COORDINATION_REGISTRY = '/tmp/zmcp-coordination-root.json';

export interface TalentMcpServerOptions {
  name: string;
  version: string;
  talentId: string;
  coordinationRoot?: string;
  talentsPath?: string;
  meetingsPath?: string;
  transport?: 'stdio' | 'http';
  httpPort?: number;
  httpHost?: string;
}

interface CoordinationRegistry {
  coordination_root: string;
  created_by: string;
  created_at: string;
  pid: number;
  hostname: string;
}

export class TalentMcpServer {
  private mcpServer: Server;
  private talentId: string;
  private coordinationRoot: string;
  private talentsPath: string;
  private meetingsPath: string;
  private httpServer?: http.Server;
  private emailTools: TalentEmailTools;
  private meetingTools: TalentMeetingTools;

  constructor(private options: TalentMcpServerOptions) {
    this.talentId = options.talentId;

    // Determine coordination root with priority order
    this.coordinationRoot = this.determineCoordinationRoot();

    // Set other paths relative to coordination root
    this.talentsPath = path.join(this.coordinationRoot, 'var', 'talents');
    this.meetingsPath = path.join(this.coordinationRoot, 'var', 'meetings');

    // Log startup info to stderr (MCP servers use stderr for logging)
    process.stderr.write('🎭 Starting Talent MCP Server (DomU)\n');
    process.stderr.write(`   Talent ID: ${this.talentId}\n`);
    process.stderr.write(`   Coordination Root: ${this.coordinationRoot}\n`);
    process.stderr.write(`   CWD: ${process.cwd()}\n`);

    this.mcpServer = new Server(
      {
        name: options.name,
        version: options.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize tools with coordination root paths
    const coordinationBasePath = path.join(this.coordinationRoot, 'var', 'coordination');
    this.emailTools = new TalentEmailTools(coordinationBasePath, this.talentsPath);
    this.meetingTools = new TalentMeetingTools(this.meetingsPath);

    this.setupMcpHandlers();
  }

  /**
   * Determine coordination root with priority order:
   * 1. Explicit --coordination-root CLI arg
   * 2. ZMCP_COORDINATION_ROOT environment variable
   * 3. /tmp/zmcp-coordination-root.json registration file
   * 4. Current working directory (creates registration)
   */
  private determineCoordinationRoot(): string {
    // 1. CLI arg wins
    if (this.options.coordinationRoot) {
      return path.resolve(this.options.coordinationRoot);
    }

    // 2. Check environment
    if (process.env.ZMCP_COORDINATION_ROOT) {
      return path.resolve(process.env.ZMCP_COORDINATION_ROOT);
    }

    // 3. Check registration file
    try {
      if (fs.existsSync(COORDINATION_REGISTRY)) {
        const content = fs.readFileSync(COORDINATION_REGISTRY, 'utf-8');
        const reg: CoordinationRegistry = JSON.parse(content);
        process.stderr.write(`   Using registered coordination root from ${COORDINATION_REGISTRY}\n`);
        return reg.coordination_root;
      }
    } catch (error) {
      process.stderr.write(`   Warning: Failed to read coordination registry: ${error}\n`);
    }

    // 4. Use CWD and create registration (first talent wins)
    const root = process.cwd();
    try {
      const registry: CoordinationRegistry = {
        coordination_root: root,
        created_by: this.talentId,
        created_at: new Date().toISOString(),
        pid: process.pid,
        hostname: os.hostname(),
      };
      fs.writeFileSync(COORDINATION_REGISTRY, JSON.stringify(registry, null, 2));
      process.stderr.write(`   Created coordination registry at ${COORDINATION_REGISTRY}\n`);
    } catch (error) {
      process.stderr.write(`   Warning: Failed to create coordination registry: ${error}\n`);
    }

    return root;
  }

  private setupMcpHandlers(): void {
    // List tools handler
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.getAvailableTools();
      return {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Call tool handler
    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tools = this.getAvailableTools();
      const tool = tools.find((t) => t.name === name);

      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool "${name}" not found`);
      }

      try {
        const result = await tool.handler(args || {});
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: false,
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Get available talent coordination tools
   * ONLY coordination tools - no orchestration, no global tools
   */
  private getAvailableTools(): Tool[] {
    return [
      // Email coordination
      ...this.emailTools.getTools(),

      // Meeting coordination
      ...this.meetingTools.getTools(),
    ];
  }

  async start(): Promise<void> {
    process.stderr.write('🚀 Starting Talent MCP Server...\n');

    const transportType = this.options.transport || 'stdio';

    if (transportType === 'http') {
      await this.startHttpTransport();
    } else {
      await this.startStdioTransport();
    }

    process.stderr.write('✅ Talent MCP Server started successfully\n');
    process.stderr.write(`📡 Transport: ${transportType.toUpperCase()}\n`);
  }

  private async startStdioTransport(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
  }

  private async startHttpTransport(): Promise<void> {
    const app = express();
    const port = this.options.httpPort || 0; // 0 = dynamic port
    const host = this.options.httpHost || '127.0.0.1';

    this.httpServer = http.createServer(app);

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        talent_id: this.talentId,
        coordination_root: this.coordinationRoot,
        cwd: process.cwd(),
        server: 'talent-mcp',
        version: this.options.version,
      });
    });

    // MCP endpoint
    app.post('/mcp', async (req, res) => {
      const transport = new StreamableHTTPServerTransport(req, res);
      await this.mcpServer.connect(transport);
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(port, host, () => {
        const addr = this.httpServer!.address();
        const actualPort = typeof addr === 'object' ? addr?.port : port;
        process.stderr.write(`🌐 HTTP server listening on http://${host}:${actualPort}\n`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    process.stderr.write('🛑 Stopping Talent MCP Server...\n');

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }

    process.stderr.write('✅ Talent MCP Server stopped\n');
  }

  /**
   * Get server info for debugging/monitoring
   */
  getServerInfo() {
    return {
      talentId: this.talentId,
      coordinationRoot: this.coordinationRoot,
      talentsPath: this.talentsPath,
      meetingsPath: this.meetingsPath,
      cwd: process.cwd(),
    };
  }
}
