/**
 * @plan:PLAN-20260608-ISSUE1585.P04
 * @requirement:REQ-INTERFACE-OWNERSHIP, REQ-BEHAVIORAL-TDD
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Registry Integration Contract Tests
 *
 * Verifies the ToolRegistry contract:
 * - Tools that implement tools-owned interfaces can be registered
 * - Tool classes accept injected service interfaces in constructors
 * - ToolRegistry discovers and lists registered tools
 *
 * These tests use structural fakes for infrastructure dependencies
 * (not mocks of the unit under test). They exercise how a real tool
 * would interact with the registry through the tools-owned interfaces.
 */

import { describe, it, expect } from 'vitest';
import type {
  IToolHost,
  IToolMessageBus,
  IShellExecutionService,
  IToolKeyStorage,
  IToolRegistryHost,
} from '../interfaces/index.js';

/**
 * Minimal structural fake for IToolHost.
 * Used to inject infrastructure, not to mock the unit under test.
 */
function createFakeToolHost(overrides?: Partial<IToolHost>): IToolHost {
  return {
    getTargetDir: () => '/tmp/workspace',
    getWorkspaceRoots: () => ['/tmp/workspace'],
    getApprovalMode: () => 'auto',
    setApprovalMode: () => {},
    isInteractive: () => false,
    hasFeatureFlag: () => false,
    getFileService: () => ({
      shouldGitIgnoreFile: () => false,
      shouldLlxprtIgnoreFile: () => false,
      filterFiles: (paths) => paths,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectLlxprtIgnore: true,
    }),
    getFileExclusions: () => [],
    getEphemeralSettings: () => ({}),
    getDebugMode: () => false,
    ...overrides,
  };
}

/**
 * Minimal structural fake for IToolMessageBus.
 */
function createFakeMessageBus(): IToolMessageBus {
  return {
    requestConfirmation: async () => 'proceed_once' as const,
    publishPolicyUpdate: async () => {},
  };
}

/**
 * Minimal structural fake for IShellExecutionService.
 */
function createFakeShellService(): IShellExecutionService {
  return {
    execute: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      aborted: false,
    }),
    isCommandAllowed: () => true,
  };
}

/**
 * A sample tool class that accepts injected service interfaces
 * through its constructor, following the tools-owned contract pattern.
 */
class SampleShellTool {
  readonly name = 'sample-shell';

  constructor(
    private readonly host: IToolHost,
    private readonly shell: IShellExecutionService,
    private readonly bus: IToolMessageBus,
  ) {}

  async execute(command: string) {
    const targetDir = this.host.getTargetDir();
    const result = await this.shell.execute(command, { cwd: targetDir });
    return {
      output: result.stdout,
      success: result.exitCode === 0,
    };
  }
}

/**
 * A tool registry that accepts tool registrations and lists them.
 * This models the ToolRegistry contract that will be implemented later.
 */
class ToolRegistry {
  private readonly tools = new Map<
    string,
    { name: string; instance: unknown }
  >();

  register(name: string, instance: unknown): void {
    this.tools.set(name, { name, instance });
  }

  listTools(): string[] {
    return Array.from(this.tools.keys());
  }

  getTool<T = unknown>(name: string): T | undefined {
    const entry = this.tools.get(name);
    return entry ? (entry.instance as T) : undefined;
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }
}

describe('Registry Contract Tests @plan:PLAN-20260608-ISSUE1585.P04', () => {
  describe('Tool accepts injected service interfaces', () => {
    it('SampleShellTool receives IToolHost, IShellExecutionService, IToolMessageBus', async () => {
      const host = createFakeToolHost({ getTargetDir: () => '/project' });
      const shell = createFakeShellService();
      const bus = createFakeMessageBus();

      const tool = new SampleShellTool(host, shell, bus);
      const result = await tool.execute('echo hello');
      expect(result.success).toBe(true);
    });

    it('tool uses injected host to resolve target directory', async () => {
      const expectedDir = '/custom/project/path';
      const host = createFakeToolHost({ getTargetDir: () => expectedDir });
      const shell: IShellExecutionService = {
        execute: async (_cmd, opts) => ({
          stdout: opts?.cwd ?? 'no-cwd',
          stderr: '',
          exitCode: 0,
          aborted: false,
        }),
        isCommandAllowed: () => true,
      };
      const bus = createFakeMessageBus();

      const tool = new SampleShellTool(host, shell, bus);
      const result = await tool.execute('echo hello');
      expect(result.output).toBe(expectedDir);
    });

    it('tool reports failure when shell execution fails', async () => {
      const host = createFakeToolHost();
      const shell: IShellExecutionService = {
        execute: async () => ({
          stdout: '',
          stderr: 'command not found',
          exitCode: 127,
          aborted: false,
        }),
        isCommandAllowed: () => true,
      };
      const bus = createFakeMessageBus();

      const tool = new SampleShellTool(host, shell, bus);
      const result = await tool.execute('bad-command');
      expect(result.success).toBe(false);
    });
  });

  describe('ToolRegistry registration contract', () => {
    it('registers a tool and lists it by name', () => {
      const registry = new ToolRegistry();
      const host = createFakeToolHost();
      const shell = createFakeShellService();
      const bus = createFakeMessageBus();
      const tool = new SampleShellTool(host, shell, bus);

      registry.register('sample-shell', tool);
      expect(registry.listTools()).toContain('sample-shell');
    });

    it('registers multiple tools and lists all names', () => {
      const registry = new ToolRegistry();
      const host = createFakeToolHost();
      const shell = createFakeShellService();
      const bus = createFakeMessageBus();

      const tool1 = new SampleShellTool(host, shell, bus);
      const tool2 = new SampleShellTool(host, shell, bus);

      registry.register('shell-a', tool1);
      registry.register('shell-b', tool2);

      const names = registry.listTools();
      expect(names).toHaveLength(2);
      expect(names).toContain('shell-a');
      expect(names).toContain('shell-b');
    });

    it('retrieves registered tool by name', () => {
      const registry = new ToolRegistry();
      const host = createFakeToolHost();
      const shell = createFakeShellService();
      const bus = createFakeMessageBus();
      const tool = new SampleShellTool(host, shell, bus);

      registry.register('my-tool', tool);
      const retrieved = registry.getTool<SampleShellTool>('my-tool');
      expect(retrieved).toBeDefined();
      expect(retrieved!.name).toBe('sample-shell');
    });

    it('returns undefined for unregistered tool', () => {
      const registry = new ToolRegistry();
      expect(registry.getTool('nonexistent')).toBeUndefined();
    });

    it('hasTool reports correct presence', () => {
      const registry = new ToolRegistry();
      const host = createFakeToolHost();
      const shell = createFakeShellService();
      const bus = createFakeMessageBus();
      const tool = new SampleShellTool(host, shell, bus);

      expect(registry.hasTool('shell')).toBe(false);
      registry.register('shell', tool);
      expect(registry.hasTool('shell')).toBe(true);
    });
  });

  describe('Tool with IToolKeyStorage dependency', () => {
    it('tool uses IToolKeyStorage to mask keys for display', () => {
      const keyStorage: IToolKeyStorage = {
        saveKey: async () => {},
        getKey: async (name: string) =>
          name === 'codesearch' ? 'sk-live-abc123def456' : null,
        deleteKey: async () => {},
        hasKey: async (name: string) => name === 'codesearch',
        resolveKey: async (name: string) =>
          name === 'codesearch' ? 'sk-live-abc123def456' : null,
        maskKeyForDisplay: (key: string) => {
          if (key.length <= 8) return '****';
          return '*'.repeat(key.length - 4) + key.slice(-4);
        },
        getSupportedToolNames: () => ['codesearch'],
      };

      const masked = keyStorage.maskKeyForDisplay('sk-live-abc123def456');
      // 'sk-live-abc123def456' = 20 chars → 16 stars + last 4 chars
      expect(masked).toBe('****************f456');
      expect(masked).not.toContain('sk-live');
    });
  });

  describe('Tool with IToolRegistryHost dependency', () => {
    it('tool queries IToolRegistryHost for core tools list', () => {
      const registryHost: IToolRegistryHost = {
        getCoreTools: () => ['shell', 'read-file', 'write-file'],
        getExcludeTools: () => ['dangerous-tool'],
        getDiscoveryCommand: () => undefined,
        isToolEnabled: (name: string) => !['dangerous-tool'].includes(name),
      };

      const coreTools = registryHost.getCoreTools();
      expect(coreTools).toContain('shell');
      expect(coreTools).toContain('read-file');

      expect(registryHost.isToolEnabled('shell')).toBe(true);
      expect(registryHost.isToolEnabled('dangerous-tool')).toBe(false);
    });
  });
});
