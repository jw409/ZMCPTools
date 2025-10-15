// This file proves you're using the local version
// Auto-generated at build time - DO NOT EDIT MANUALLY

import { Logger } from './utils/logger.js';

const logger = new Logger('build-info');

export const BUILD_INFO = {
  version: "0.4.1",
  hostname: "aircooled3",
  timestamp: "2025-10-15T04:31:41.061Z",
  humanReadable: "Oct 14, 2025, 09:31 PM PDT"
} as const;

export const LOCAL_VERSION_MARKER = `LOCAL_BUILD_v${BUILD_INFO.version}_${BUILD_INFO.hostname}_${BUILD_INFO.timestamp}`;

logger.info(`🔧 USING LOCAL ZMCP-TOOLS BUILD v${BUILD_INFO.version} (built on ${BUILD_INFO.hostname} at ${BUILD_INFO.humanReadable})`);
