
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ResourceManager } from '../managers/ResourceManager.js';
import type { McpTool } from '../schemas/tools/index.js';

const ReadMcpResourceSchema = z.object({
  uri: z.string().describe('The full URI of the MCP resource to read (e.g., "symbols://stats").'),
});

export const getMetaMcpTools = (resourceManager: ResourceManager): McpTool[] => {
  const readMcpResourceTool: McpTool = {
    name: 'read_mcp_resource',
    description: 'Reads an MCP resource by its URI. Acts as a meta-tool to access the resource API.',
    inputSchema: zodToJsonSchema(ReadMcpResourceSchema),
    handler: async (params: z.infer<typeof ReadMcpResourceSchema>) => {
      try {
        const resourceContent = await resourceManager.readResource(params.uri);
        // The content already has the desired structure { uri, mimeType, text }
        // We just need to extract the text and parse if it's JSON
        if (resourceContent.mimeType === 'application/json') {
          return JSON.parse(resourceContent.text);
        }
        return resourceContent.text;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        console.error(`Error reading MCP resource '${params.uri}':`, error);
        return {
          success: false,
          error: `Failed to read resource '${params.uri}': ${errorMessage}`,
        };
      }
    },
  };

  return [readMcpResourceTool];
};
