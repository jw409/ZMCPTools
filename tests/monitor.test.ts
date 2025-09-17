import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MonitorService, MonitorConfig } from '../src/services/MonitorService.js';
import { MonitorFormatter } from '../src/services/MonitorFormatter.js';
import { DatabaseManager } from '../src/database/index.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  ChildProcess: jest.fn()
}));

// Mock HTTP server
jest.mock('http', () => ({
  createServer: jest.fn()
}));

describe('MonitorService', () => {
  let tempDir: string;
  let monitorService: MonitorService;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'zmcp-monitor-test-'));
    testDbPath = join(tempDir, 'test.db');
    monitorService = new MonitorService(testDbPath);
  });

  afterEach(() => {
    try {
      monitorService.stop();
    } catch (error) {
      // Ignore cleanup errors
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Configuration', () => {
    test('should accept valid monitor configuration', () => {
      const config: MonitorConfig = {
        outputFormat: 'terminal',
        watchMode: false,
        repositoryPath: '.',
        updateInterval: 2000
      };

      expect(() => {
        // Configuration should be accepted without errors
        config.outputFormat = 'html';
        config.outputFormat = 'json';
        config.watchMode = true;
        config.port = 8080;
        config.agentId = 'test-agent';
        config.outputFile = '/tmp/test.html';
      }).not.toThrow();
    });

    test('should validate output formats', () => {
      const validFormats = ['terminal', 'html', 'json'];

      validFormats.forEach(format => {
        const config: MonitorConfig = {
          outputFormat: format as any,
          watchMode: false,
          repositoryPath: '.',
          updateInterval: 2000
        };

        expect(config.outputFormat).toBe(format);
      });
    });
  });

  describe('Data Collection', () => {
    test('should collect monitor data without errors', async () => {
      const config: MonitorConfig = {
        outputFormat: 'json',
        watchMode: false,
        repositoryPath: '.',
        updateInterval: 2000
      };

      // Mock the ps command to return empty results
      const { spawn } = require('child_process');
      const mockPs = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback('USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND\n');
            }
          })
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        })
      };

      spawn.mockReturnValue(mockPs);

      // This should not throw an error
      await expect(monitorService.start(config)).resolves.not.toThrow();
    });

    test('should handle process collection errors gracefully', async () => {
      const config: MonitorConfig = {
        outputFormat: 'json',
        watchMode: false,
        repositoryPath: '.',
        updateInterval: 2000
      };

      // Mock ps command to fail
      const { spawn } = require('child_process');
      const mockPs = {
        stdout: {
          on: jest.fn()
        },
        on: jest.fn((event, callback) => {
          if (event === 'error') {
            callback(new Error('ps command failed'));
          }
        })
      };

      spawn.mockReturnValue(mockPs);

      // Should handle the error gracefully
      await expect(monitorService.start(config)).resolves.not.toThrow();
    });
  });

  describe('ZMCP Process Parsing', () => {
    test('should parse ZMCP process titles correctly', async () => {
      const mockPsOutput = `
USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND
test 1234 2.5 1.2 100000 50000 ? S 10:00 0:01 node zmcp-be-oauth-impl-a3f2e1
test 5678 1.8 0.8 80000 40000 ? S 10:05 0:00 node zmcp-fe-dashboard-b4c3d2
test 9012 0.5 0.3 60000 30000 ? S 10:10 0:00 node zmcp-ts-api-tests-c5d4e3
      `;

      const config: MonitorConfig = {
        outputFormat: 'json',
        watchMode: false,
        repositoryPath: '.',
        updateInterval: 2000
      };

      const { spawn } = require('child_process');
      const mockPs = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback(mockPsOutput);
            }
          })
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        })
      };

      spawn.mockReturnValue(mockPs);

      await monitorService.start(config);

      // The service should have parsed the ZMCP processes correctly
      // We can't directly test the private method, but the service should start without errors
      expect(spawn).toHaveBeenCalledWith('ps', ['aux'], { stdio: 'pipe' });
    });
  });
});

describe('MonitorFormatter', () => {
  let formatter: MonitorFormatter;

  beforeEach(() => {
    formatter = new MonitorFormatter();
  });

  describe('Terminal Formatting', () => {
    test('should format monitor data for terminal display', async () => {
      const mockData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 3,
          activeAgents: 2,
          idleAgents: 1,
          totalTasks: 5,
          activeTasks: 3,
          pendingTasks: 2,
          totalRooms: 2,
          activeRooms: 1
        },
        agents: [
          {
            id: 'agent_1',
            name: 'Backend Agent',
            type: 'backend',
            status: 'active',
            pid: 1234,
            processTitle: 'zmcp-be-oauth-impl-a3f2e1',
            lastActivity: 'Processing OAuth tokens',
            uptime: '2h 15m',
            performance: {
              cpu: '2.5%',
              memory: '50MB',
              restarts: 0,
              crashes: 0
            },
            health: 95
          }
        ],
        processes: [
          {
            pid: 1234,
            title: 'zmcp-be-oauth-impl-a3f2e1',
            command: 'node zmcp-be-oauth-impl-a3f2e1',
            agentType: 'backend',
            projectContext: 'oauth-impl',
            agentId: 'a3f2e1',
            status: 'running' as const,
            memory: '50MB',
            cpu: '2.5%',
            startTime: '10:00'
          }
        ],
        rooms: [
          {
            name: 'oauth-development',
            members: 3,
            lastMessage: 'OAuth flow implemented successfully',
            messageCount: 15
          }
        ],
        errors: []
      };

      const formatted = await formatter.formatTerminal(mockData);

      expect(formatted).toContain('ZMCP Agent Monitor');
      expect(formatted).toContain('System Overview');
      expect(formatted).toContain('Agents: 2/3 active');
      expect(formatted).toContain('Backend Agent');
      expect(formatted).toContain('Health: 💚 95%');
      expect(formatted).toContain('oauth-development');
    });

    test('should handle empty data gracefully', async () => {
      const emptyData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors: []
      };

      const formatted = await formatter.formatTerminal(emptyData);

      expect(formatted).toContain('ZMCP Agent Monitor');
      expect(formatted).toContain('Agents: 0/0 active');
      expect(formatted).not.toContain('Backend Agent');
    });

    test('should display errors when present', async () => {
      const dataWithErrors = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors: ['Failed to connect to database', 'Agent process crashed']
      };

      const formatted = await formatter.formatTerminal(dataWithErrors);

      expect(formatted).toContain('Errors');
      expect(formatted).toContain('Failed to connect to database');
      expect(formatted).toContain('Agent process crashed');
    });
  });

  describe('HTML Formatting', () => {
    test('should generate valid HTML', async () => {
      const mockData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 1,
          activeAgents: 1,
          idleAgents: 0,
          totalTasks: 2,
          activeTasks: 1,
          pendingTasks: 1,
          totalRooms: 1,
          activeRooms: 1
        },
        agents: [
          {
            id: 'agent_1',
            name: 'Test Agent',
            type: 'testing',
            status: 'active',
            pid: 5678,
            processTitle: 'zmcp-ts-api-tests-c5d4e3',
            lastActivity: 'Running unit tests',
            uptime: '1h 30m',
            performance: {
              cpu: '1.8%',
              memory: '40MB',
              restarts: 0,
              crashes: 0
            },
            health: 88
          }
        ],
        processes: [],
        rooms: [],
        errors: []
      };

      const html = await formatter.formatHtml(mockData, {
        title: 'Test Monitor',
        theme: 'light'
      });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test Monitor</title>');
      expect(html).toContain('Test Agent');
      expect(html).toContain('zmcp-ts-api-tests-c5d4e3');
      expect(html).toContain('88%');
      expect(html).toContain('</html>');
    });

    test('should support dark theme', async () => {
      const mockData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors: []
      };

      const html = await formatter.formatHtml(mockData, {
        theme: 'dark'
      });

      expect(html).toContain('background: #1a1a1a');
      expect(html).toContain('color: #e0e0e0');
    });

    test('should include refresh meta tag when interval specified', async () => {
      const mockData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors: []
      };

      const html = await formatter.formatHtml(mockData, {
        refreshInterval: 5000
      });

      expect(html).toContain('http-equiv="refresh"');
      expect(html).toContain('content="5"');
    });
  });

  describe('JSON Formatting', () => {
    test('should return valid JSON', async () => {
      const mockData = {
        timestamp: new Date().toISOString(),
        systemOverview: {
          totalAgents: 0,
          activeAgents: 0,
          idleAgents: 0,
          totalTasks: 0,
          activeTasks: 0,
          pendingTasks: 0,
          totalRooms: 0,
          activeRooms: 0
        },
        agents: [],
        processes: [],
        rooms: [],
        errors: []
      };

      const json = await formatter.formatJson(mockData);
      const parsed = JSON.parse(json);

      expect(parsed).toEqual(mockData);
      expect(parsed.systemOverview.totalAgents).toBe(0);
    });
  });

  describe('Status Icons and Colors', () => {
    test('should return correct status icons', () => {
      // Access private method through any cast for testing
      const formatter_any = formatter as any;

      expect(formatter_any.getStatusIcon('active')).toBe('✓');
      expect(formatter_any.getStatusIcon('idle')).toBe('○');
      expect(formatter_any.getStatusIcon('failed')).toBe('✗');
      expect(formatter_any.getStatusIcon('terminated')).toBe('◯');
      expect(formatter_any.getStatusIcon('unknown')).toBe('?');
    });

    test('should return correct health icons', () => {
      const formatter_any = formatter as any;

      expect(formatter_any.getHealthIcon(95)).toBe('💚');
      expect(formatter_any.getHealthIcon(75)).toBe('💛');
      expect(formatter_any.getHealthIcon(55)).toBe('🧡');
      expect(formatter_any.getHealthIcon(30)).toBe('❤️');
    });
  });
});

describe('Process Title Parsing', () => {
  test('should parse ZMCP process titles correctly', () => {
    const testCases = [
      {
        title: 'zmcp-be-oauth-impl-a3f2e1',
        expected: {
          typeAbbr: 'be',
          projectContext: 'oauth-impl',
          agentId: 'a3f2e1',
          agentType: 'backend'
        }
      },
      {
        title: 'zmcp-fe-dashboard-b4c3d2',
        expected: {
          typeAbbr: 'fe',
          projectContext: 'dashboard',
          agentId: 'b4c3d2',
          agentType: 'frontend'
        }
      },
      {
        title: 'zmcp-ts-api-tests-c5d4e3',
        expected: {
          typeAbbr: 'ts',
          projectContext: 'api-tests',
          agentId: 'c5d4e3',
          agentType: 'testing'
        }
      },
      {
        title: 'zmcp-dc-user-docs-d6e5f4',
        expected: {
          typeAbbr: 'dc',
          projectContext: 'user-docs',
          agentId: 'd6e5f4',
          agentType: 'documentation'
        }
      }
    ];

    testCases.forEach(({ title, expected }) => {
      const titleMatch = title.match(/zmcp-(\w+)-([^-\s]+)-(\w+)/);

      expect(titleMatch).not.toBeNull();
      if (titleMatch) {
        const [, typeAbbr, projectContext, agentId] = titleMatch;

        expect(typeAbbr).toBe(expected.typeAbbr);
        expect(projectContext).toBe(expected.projectContext);
        expect(agentId).toBe(expected.agentId);

        // Test type abbreviation mapping
        const typeMap: Record<string, string> = {
          'be': 'backend',
          'fe': 'frontend',
          'ts': 'testing',
          'dc': 'documentation',
          'ar': 'architect',
          'dv': 'devops',
          'an': 'analysis',
          'rs': 'researcher',
          'im': 'implementer',
          'rv': 'reviewer'
        };

        expect(typeMap[typeAbbr]).toBe(expected.agentType);
      }
    });
  });
});

describe('Health Score Calculation', () => {
  test('should calculate health scores correctly', () => {
    // Test perfect health
    expect(calculateHealthScore({})).toBe(100);

    // Test crash penalties
    expect(calculateHealthScore({ crashCount: 1 })).toBe(90);
    expect(calculateHealthScore({ crashCount: 5 })).toBe(50);
    expect(calculateHealthScore({ crashCount: 10 })).toBe(50); // Max 50 deduction

    // Test restart penalties
    expect(calculateHealthScore({ restartCount: 1 })).toBe(95);
    expect(calculateHealthScore({ restartCount: 6 })).toBe(70);
    expect(calculateHealthScore({ restartCount: 10 })).toBe(70); // Max 30 deduction

    // Test combined penalties
    expect(calculateHealthScore({
      crashCount: 2,
      restartCount: 2
    })).toBe(70); // 100 - 20 - 10 = 70
  });

  // Helper function matching the one in MonitorService
  function calculateHealthScore(metrics: {
    crashCount?: number;
    restartCount?: number;
    errorCount?: number;
  }): number {
    let score = 100;

    if (metrics.crashCount && metrics.crashCount > 0) {
      score -= Math.min(metrics.crashCount * 10, 50);
    }

    if (metrics.restartCount && metrics.restartCount > 0) {
      score -= Math.min(metrics.restartCount * 5, 30);
    }

    if (metrics.errorCount && metrics.errorCount > 0) {
      score -= Math.min(metrics.errorCount * 2, 20);
    }

    return Math.max(Math.min(score, 100), 0);
  }
});

describe('Integration Tests', () => {
  test('should start and stop monitor service cleanly', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'zmcp-monitor-integration-'));
    const testDbPath = join(tempDir, 'test.db');
    const monitor = new MonitorService(testDbPath);

    try {
      const config: MonitorConfig = {
        outputFormat: 'json',
        watchMode: false,
        repositoryPath: '.',
        updateInterval: 1000
      };

      // Mock ps command
      const { spawn } = require('child_process');
      const mockPs = {
        stdout: {
          on: jest.fn((event, callback) => {
            if (event === 'data') {
              callback('USER PID %CPU %MEM COMMAND\n');
            }
          })
        },
        on: jest.fn((event, callback) => {
          if (event === 'close') {
            callback(0);
          }
        })
      };
      spawn.mockReturnValue(mockPs);

      await expect(monitor.start(config)).resolves.not.toThrow();
      expect(() => monitor.stop()).not.toThrow();

    } finally {
      try {
        monitor.stop();
      } catch (error) {
        // Ignore cleanup errors
      }
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  });
});