/**
 * Path Sandbox Bridge - TypeScript bridge to Python PathSandbox
 *
 * Validates file paths using the Python security library in talent-os.
 * This provides defense-in-depth by ensuring all file access is validated
 * by the same security layer used by remote agents.
 *
 * FPGA stage: Uses subprocess calls (simple, proves it works)
 * ASIC stage: Could use persistent Python service for performance
 */

import { spawn } from 'child_process';
import { join } from 'path';

export interface PathValidationResult {
  allowed: boolean;
  reason?: string;
  resolvedPath?: string;
}

export class PathSandboxBridge {
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    // Use uv run python for consistency with TalentOS
    this.pythonPath = 'uv';

    // Path to validation script
    const projectRoot = process.cwd();
    this.scriptPath = join(projectRoot, 'talent-os', 'bin', 'validate_path.py');
  }

  /**
   * Validate a file path using Python PathSandbox
   */
  async validatePath(
    path: string,
    allowedPaths: string[],
    projectRoot: string
  ): Promise<PathValidationResult> {
    return new Promise((resolve, reject) => {
      const args = [
        'run',
        'python',
        this.scriptPath,
        '--path', path,
        '--allowed', JSON.stringify(allowedPaths),
        '--project-root', projectRoot
      ];

      const child = spawn(this.pythonPath, args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Path validation failed: ${stderr}`));
          return;
        }

        try {
          const result: PathValidationResult = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse validation result: ${stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to spawn validation process: ${error.message}`));
      });
    });
  }

  /**
   * Validate a resource URI using Python ResourceURISandbox
   */
  async validateUri(
    uri: string,
    allowedPaths: string[],
    projectRoot: string
  ): Promise<PathValidationResult> {
    return new Promise((resolve, reject) => {
      const args = [
        'run',
        'python',
        this.scriptPath,
        '--uri', uri,
        '--allowed', JSON.stringify(allowedPaths),
        '--project-root', projectRoot
      ];

      const child = spawn(this.pythonPath, args, {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`URI validation failed: ${stderr}`));
          return;
        }

        try {
          const result: PathValidationResult = JSON.parse(stdout);
          resolve(result);
        } catch (error) {
          reject(new Error(`Failed to parse validation result: ${stdout}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to spawn validation process: ${error.message}`));
      });
    });
  }
}
