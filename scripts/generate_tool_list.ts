#!/usr/bin/env tsx
/**
 * Auto-generate TOOL_LIST.md from actual MCP tool registrations
 * Usage: npm run generate:docs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { glob } from 'glob';

interface Tool {
  name: string;
  category: string;
  description: string;
  deprecated?: boolean;
}

interface Resource {
  uriTemplate: string;
  category: string;
  description: string;
  params?: string;
}

async function extractTools(): Promise<Tool[]> {
  const tools: Tool[] = [];
  const toolFiles = await glob('src/tools/**/*.ts');

  for (const file of toolFiles) {
    const content = readFileSync(file, 'utf-8');

    // Extract tool definitions (looking for name: 'mcp__zmcp-tools__*')
    const toolMatches = content.matchAll(/name:\s*['"](mcp__zmcp-tools__[^'"]+)['"]/g);
    const descMatches = content.matchAll(/description:\s*['"]([^'"]+)['"]/g);

    const names = Array.from(toolMatches).map(m => m[1].replace('mcp__zmcp-tools__', ''));
    const descs = Array.from(descMatches).map(m => m[1]);

    // Infer category from filename
    const category = file.includes('Browser') ? 'Browser Automation' :
                    file.includes('Knowledge') ? 'Knowledge Graph' :
                    file.includes('TreeSummary') ? 'Tree Summary' :
                    file.includes('Analysis') ? 'Project Analysis' :
                    file.includes('AIDOM') ? 'Browser AI DOM' :
                    file.includes('Progress') ? 'Progress Reporting' :
                    'Other';

    names.forEach((name, i) => {
      tools.push({
        name,
        category,
        description: descs[i] || 'No description',
        deprecated: content.includes('@deprecated')
      });
    });
  }

  return tools;
}

async function extractResources(): Promise<Resource[]> {
  const resources: Resource[] = [];

  // Resources are defined in ResourceManager.ts listResources() method
  const resourceManagerPath = 'src/managers/ResourceManager.ts';
  const content = readFileSync(resourceManagerPath, 'utf-8');

  // Extract resource definitions from the listResources() return array
  // Pattern: uriTemplate: "scheme://pattern"
  const uriMatches = content.matchAll(/uriTemplate:\s*["']([^"']+)["']/g);
  const nameMatches = content.matchAll(/name:\s*["']([^"']+)["']/g);
  const descMatches = content.matchAll(/description:\s*\n?\s*["']([^"']+)["']/g);

  const uris = Array.from(uriMatches).map(m => m[1]);
  const names = Array.from(nameMatches);
  const descs = Array.from(descMatches);

  // Match URIs with their descriptions (they appear in order in the code)
  uris.forEach((uri, i) => {
    const scheme = uri.split('://')[0];
    const category = scheme === 'file' ? 'File Analysis' :
                    scheme === 'project' ? 'Project Analysis' :
                    scheme === 'knowledge' ? 'Knowledge Graph' :
                    scheme === 'agents' ? 'Agent Management' :
                    scheme === 'vector' ? 'Vector Search' :
                    scheme === 'logs' ? 'Logging' :
                    scheme === 'communication' ? 'Communication' :
                    scheme === 'scraping' ? 'Web Scraping' :
                    scheme === 'docs' ? 'Documentation' :
                    'Other';

    // Get description (it follows the uriTemplate in the code)
    const desc = descs[i]?.[1] || names[i]?.[1] || 'No description';

    resources.push({
      uriTemplate: uri,
      category,
      description: desc
    });
  });

  return resources;
}

function groupBy<T>(arr: T[], key: keyof T): Map<string, T[]> {
  return arr.reduce((acc, item) => {
    const group = String(item[key]);
    if (!acc.has(group)) acc.set(group, []);
    acc.get(group)!.push(item);
    return acc;
  }, new Map<string, T[]>());
}

async function generateToolList() {
  const tools = await extractTools();
  const resources = await extractResources();

  const activeTools = tools.filter(t => !t.deprecated);
  const deprecatedTools = tools.filter(t => t.deprecated);

  const toolsByCategory = groupBy(activeTools, 'category');
  const resourcesByCategory = groupBy(resources, 'category');

  const totalTools = activeTools.length;

  let md = `# ZMCPTools - Complete Tool Reference

This document provides a comprehensive reference for all MCP tools and resources available in ZMCPTools.

⚠️  **AUTO-GENERATED** from source code by \`npm run generate:docs\`
Last generated: ${new Date().toISOString()}

## ⚡ Token Optimization Notice

**ZMCPTools now uses MCP Resources for read-only operations** - saving ~13,000+ tokens in system prompts!

- **Resources** (~30 tokens): URI-based read operations (file analysis, searches, status)
- **Tools** (~200 tokens): Action-based mutations and complex workflows

See [GitHub Issue #35](https://github.com/jw409/ZMCPTools/issues/35) for migration details.

## Table of Contents

- [🔍 MCP Resources (Token-Optimized)](#mcp-resources-token-optimized)
`;

  // Add tool categories to TOC
  for (const [category, categoryTools] of toolsByCategory) {
    const slug = category.toLowerCase().replace(/\s+/g, '-');
    md += `- [${category} (${categoryTools.length} tools)](#${slug})\n`;
  }

  md += `\n**Total Active Tools**: ${totalTools}\n\n---\n\n`;

  // Resources section
  md += `## 🔍 MCP Resources (Token-Optimized)\n\n`;
  md += `**New in v0.5.0**: Read-only operations are now available as **MCP Resources** instead of Tools, providing 97% token reduction.\n\n`;

  for (const [category, categoryResources] of resourcesByCategory) {
    md += `### ${category} Resources\n\n`;
    md += `| Resource URI Template | Description | Query Parameters |\n`;
    md += `|----------------------|-------------|------------------|\n`;

    for (const resource of categoryResources) {
      const params = resource.params || '-';
      md += `| \`${resource.uriTemplate}\` | ${resource.description} | ${params} |\n`;
    }
    md += `\n`;
  }

  // Tools sections
  for (const [category, categoryTools] of toolsByCategory) {
    const slug = category.toLowerCase().replace(/\s+/g, '-');
    md += `## ${category}\n\n`;
    md += `<a name="${slug}"></a>\n\n`;

    for (const tool of categoryTools.sort((a, b) => a.name.localeCompare(b.name))) {
      md += `### \`${tool.name}\`\n\n`;
      md += `${tool.description}\n\n`;
    }
  }

  // Deprecated section
  if (deprecatedTools.length > 0) {
    md += `## ⚠️ Deprecated Tools\n\n`;
    md += `The following tools have been deprecated and will be removed in a future version:\n\n`;

    for (const tool of deprecatedTools) {
      md += `- \`${tool.name}\` - ${tool.description}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `**Token optimization**: Resources use ~30 tokens vs ~200 tokens for equivalent tools\n`;
  md += `**Total savings**: ~13,000+ tokens in system prompts vs tool-based approach\n`;

  // Write to etc/ directory
  writeFileSync('etc/TOOL_LIST.md', md);
  console.log('✅ Generated etc/TOOL_LIST.md');

  // Generate RESOURCE_REGISTRY.md
  await generateResourceRegistry(resources);

  // Generate AGENT_TOOL_LIST.md (simplified for agent contexts)
  await generateAgentToolList(activeTools);
}

async function generateResourceRegistry(resources: Resource[]) {
  const resourcesByCategory = groupBy(resources, 'category');

  let md = `# MCP Resource Registry

**AUTO-GENERATED** from source code by \`npm run generate:docs\`
Last generated: ${new Date().toISOString()}

## Available MCP Resources

MCP Resources provide 97% token reduction compared to tools for read-only operations.

`;

  for (const [category, categoryResources] of resourcesByCategory) {
    md += `### ${category}\n\n`;
    md += `| URI Template | Description |\n`;
    md += `|--------------|-------------|\n`;

    for (const resource of categoryResources) {
      md += `| \`${resource.uriTemplate}\` | ${resource.description} |\n`;
    }
    md += `\n`;
  }

  md += `---\n\n**Total Resources**: ${resources.length}\n\n`;

  // Add log rotation documentation
  md += `### Log Rotation\n\n`;
  md += `**Automatic archiving**: Run \`npm run logs:rotate\` or \`npm run logs:rotate:dry-run\`\n`;
  md += `- Archives logs older than 7 days to \`var/harvest/archived_logs/\`\n`;
  md += `- Purges archived logs older than 90 days\n`;
  md += `- Configure: \`--days=N --keep-archives-days=N\`\n`;
  md += `- Safe for scavenger/teacher talent modules (archives preserved)\n`;

  writeFileSync('etc/RESOURCE_REGISTRY.md', md);
  console.log('✅ Generated etc/RESOURCE_REGISTRY.md');
}

async function generateAgentToolList(tools: Tool[]) {
  const toolsByCategory = groupBy(tools, 'category');

  let md = `# Agent Tool List

**AUTO-GENERATED** from source code by \`npm run generate:docs\`
Last generated: ${new Date().toISOString()}

Simplified tool reference for agent contexts (removes verbose descriptions).

## Available Tools by Category

`;

  for (const [category, categoryTools] of toolsByCategory) {
    md += `### ${category} (${categoryTools.length})\n\n`;
    for (const tool of categoryTools.sort((a, b) => a.name.localeCompare(b.name))) {
      md += `- \`${tool.name}\`\n`;
    }
    md += `\n`;
  }

  md += `---\n\n**Total Tools**: ${tools.length}\n`;

  writeFileSync('etc/AGENT_TOOL_LIST.md', md);
  console.log('✅ Generated etc/AGENT_TOOL_LIST.md');
}

generateToolList().catch(console.error);
