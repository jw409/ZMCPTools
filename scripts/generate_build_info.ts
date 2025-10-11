#!/usr/bin/env tsx
/**
 * Generate build information for TEST_LOCAL_VERSION.ts
 * Captures hostname, timestamp, and version at build time
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { hostname } from 'os';

// Read version from package.json
const packageJson = await import('../package.json', { assert: { type: 'json' } });
const version = packageJson.default.version;

// Get build metadata
const buildHostname = hostname();
const buildTimestamp = new Date().toISOString();
const buildDate = new Date().toLocaleString('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short'
});

// Generate the file content
const content = `// This file proves you're using the local version
// Auto-generated at build time - DO NOT EDIT MANUALLY

import { Logger } from './utils/logger.js';

const logger = new Logger('build-info');

export const BUILD_INFO = {
  version: "${version}",
  hostname: "${buildHostname}",
  timestamp: "${buildTimestamp}",
  humanReadable: "${buildDate}"
} as const;

export const LOCAL_VERSION_MARKER = \`LOCAL_BUILD_v\${BUILD_INFO.version}_\${BUILD_INFO.hostname}_\${BUILD_INFO.timestamp}\`;

logger.info(\`🔧 USING LOCAL ZMCP-TOOLS BUILD v\${BUILD_INFO.version} (built on \${BUILD_INFO.hostname} at \${BUILD_INFO.humanReadable})\`);
`;

// Write to src/TEST_LOCAL_VERSION.ts
const outputPath = resolve(import.meta.dirname, '../src/TEST_LOCAL_VERSION.ts');
writeFileSync(outputPath, content, 'utf8');

console.log('✅ Generated TEST_LOCAL_VERSION.ts with build info:');
console.log(`   Version: ${version}`);
console.log(`   Hostname: ${buildHostname}`);
console.log(`   Built: ${buildDate}`);
