/**
 * Node.js compatibility utilities for TSX execution
 */

/**
 * Get the appropriate TSX command based on Node.js version
 * Node.js 20.6+ requires --import flag instead of --loader
 */
export function getTsxCommand(): string {
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
  const minorVersion = parseInt(nodeVersion.slice(1).split('.')[1]);
  
  // Node.js 20.6+ uses --import, older versions use --loader
  if (majorVersion > 20 || (majorVersion === 20 && minorVersion >= 6)) {
    return 'node --import tsx/esm';
  } else {
    return 'tsx';
  }
}

/**
 * Get the full command to execute a TypeScript file with appropriate Node.js flags
 */
export function getNodeTsxExecution(scriptPath: string): string {
  const tsxCommand = getTsxCommand();
  return `${tsxCommand} ${scriptPath}`;
}

/**
 * Get Node.js version information
 */
export function getNodeVersion(): { major: number; minor: number; patch: number; full: string } {
  const nodeVersion = process.version;
  const parts = nodeVersion.slice(1).split('.');
  
  return {
    major: parseInt(parts[0]),
    minor: parseInt(parts[1]),
    patch: parseInt(parts[2]),
    full: nodeVersion
  };
}

/**
 * Check if the current Node.js version supports the new --import flag
 */
export function supportsImportFlag(): boolean {
  const { major, minor } = getNodeVersion();
  return major > 20 || (major === 20 && minor >= 6);
}

/**
 * Get the appropriate NPX command for tsx execution
 */
export function getNpxTsxCommand(): string {
  if (supportsImportFlag()) {
    return 'npx --yes tsx';
  } else {
    return 'npx tsx';
  }
}

/**
 * Environment-specific TSX execution setup
 */
export function setupTsxEnvironment(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const nodeVersion = getNodeVersion();
  const baseEnv = { ...process.env };
  
  if (supportsImportFlag()) {
    return {
      command: 'node',
      args: ['--import', 'tsx/esm'],
      env: {
        ...baseEnv,
        NODE_OPTIONS: '--import tsx/esm'
      }
    };
  } else {
    return {
      command: 'tsx',
      args: [],
      env: baseEnv
    };
  }
}