/**
 * Talent MCP Server Entry Point
 *
 * Starts a talent-specific MCP server for domU (talent) context.
 * Provides coordination tools (email, meetings) separate from global orchestrator.
 *
 * Usage:
 *   node dist/talent-server/index.js --talent-id backend-boris-001
 *   node dist/talent-server/index.js --talent-id frontend-felix-001 --transport http --port 4270
 *
 * Shebang is added by tsup build config.
 */

import { TalentMcpServer } from './TalentMcpServer.js';

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  const talentIdIndex = args.indexOf('--talent-id');
  const transportIndex = args.indexOf('--transport');
  const portIndex = args.indexOf('--port');
  const hostIndex = args.indexOf('--host');
  const coordRootIndex = args.indexOf('--coordination-root');

  const talentId = talentIdIndex !== -1 && args[talentIdIndex + 1]
    ? args[talentIdIndex + 1]
    : 'unknown-talent';

  const transport = transportIndex !== -1 && args[transportIndex + 1]
    ? args[transportIndex + 1] as 'stdio' | 'http'
    : 'stdio';

  const httpPort = portIndex !== -1 && args[portIndex + 1]
    ? parseInt(args[portIndex + 1])
    : 4270;

  const httpHost = hostIndex !== -1 && args[hostIndex + 1]
    ? args[hostIndex + 1]
    : '127.0.0.1';

  const coordinationRoot = coordRootIndex !== -1 && args[coordRootIndex + 1]
    ? args[coordRootIndex + 1]
    : undefined;

  // MCP servers must not output to stdout - using stderr for startup messages
  process.stderr.write('🎭 ZMCPTools Talent Server (DomU)\n');
  process.stderr.write(`   Talent ID: ${talentId}\n`);
  process.stderr.write(`   Transport: ${transport.toUpperCase()}\n`);

  if (talentId === 'unknown-talent') {
    process.stderr.write('\n⚠️  Warning: No --talent-id specified, using "unknown-talent"\n');
    process.stderr.write('   Usage: node dist/talent-server/index.js --talent-id <talent-id>\n\n');
  }

  const server = new TalentMcpServer({
    name: 'zmcp-talent-tools',
    version: '1.0.0',
    talentId,
    transport,
    httpPort,
    httpHost,
    coordinationRoot,
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    process.stderr.write('\n🛑 Shutting down gracefully...\n');
    try {
      await server.stop();
      process.stderr.write('✅ Server stopped successfully\n');
      process.exit(0);
    } catch (error) {
      process.stderr.write(`❌ Error during shutdown: ${error}\n`);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start the server
  await server.start();
  process.stderr.write('✅ Talent MCP Server started successfully\n');
}

// Only run main if this file is being executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`❌ Failed to start Talent MCP Server: ${error}\n`);
    process.exit(1);
  });
}
