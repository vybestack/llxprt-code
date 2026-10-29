/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { ToolRegistry as NativeToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  Config,
  type ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { GitService } from '@vybestack/llxprt-code-core';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { createTestMcpRuntime } from './helpers/create-mcp-runtime.js';
const initializeShellParser = vi.fn(() => Promise.resolve(true));
const parserInfrastructure = {
  initializeParser: initializeShellParser,
  isParserAvailable: () => true,
  parseShellCommand: () => null,
  extractCommandNames: () => [],
  hasCommandSubstitution: () => false,
  splitCommandsWithTree: () => [],
  parseCommandDetails: () => null,
  hasPromptCommandTransform: () => false,
};
void vi.mock(
  '@vybestack/llxprt-code-core/utils/shell-parser.js',
  () => parserInfrastructure,
);
const actualFs = { ...(await import('fs')) };
void vi.mock('fs', () => ({
  ...actualFs,
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi
    .fn()
    .mockReturnValue({ isDirectory: vi.fn().mockReturnValue(true) }),
  realpathSync: vi.fn((p: string) => p),
}));
const actualTools = { ...(await import('@vybestack/llxprt-code-tools')) };
const ToolRegistry = vi.fn(
  (...args: ConstructorParameters<typeof NativeToolRegistry>) =>
    new actualTools.ToolRegistry(...args),
);
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...actualTools,
  ToolRegistry,
  MemoryTool: vi.fn(),
  setLlxprtMdFilename: vi.fn(),
  getCurrentLlxprtMdFilename: vi.fn(() => 'LLXPRT.md'),
  DEFAULT_CONTEXT_FILENAME: 'LLXPRT.md',
  LLXPRT_CONFIG_DIR: '.llxprt',
}));
const initializeGit = vi.fn();
class GitServiceInfrastructure {
  initialize(): Promise<void> {
    return initializeGit();
  }
}
void vi.mock('@vybestack/llxprt-code-core/services/gitService.js', () => ({
  GitService: GitServiceInfrastructure,
}));
void vi.mock('@vybestack/llxprt-code-core/utils/memoryDiscovery.js', () => ({
  loadGlobalMemory: vi.fn().mockResolvedValue({ files: [] }),
  loadEnvironmentMemory: vi.fn().mockResolvedValue({ files: [] }),
  loadJitSubdirectoryMemory: vi.fn(),
  loadCoreMemory: vi.fn().mockResolvedValue({ files: [] }),
  concatenateInstructions: vi.fn().mockReturnValue(''),
  getAllLlxprtMdFilenames: vi.fn().mockReturnValue([]),
  loadServerHierarchicalMemory: vi
    .fn()
    .mockResolvedValue({ memoryContent: '', fileCount: 0, filePaths: [] }),
}));
function parserInitializationGate(): {
  promise: Promise<boolean>;
  resolve(value: boolean): void;
} {
  let release: (value: boolean) => void = () => {
    throw new Error('Parser initialization gate has not been constructed');
  };
  const promise = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  return { promise, resolve: (value) => release(value) };
}

describe('Server Config (config.ts)', () => {
  const owners: Array<{ dispose(): void | Promise<void> }> = [];

  async function initializeWorkspace(config: Config): Promise<void> {
    owners.push(config);
    const workspace = await createTestMcpRuntime(
      { oauth: createTestOAuthBinding(), config },
      {},
    );
    owners.push(workspace);
    await workspace.initialize();
  }

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const owner of owners.splice(0).reverse()) {
      try {
        await owner.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Workspace startup fixture cleanup failed',
      );
  });
  const settingsService = new SettingsService();
  const baseParams: ConfigParameters = {
    cwd: '/tmp',
    embeddingModel: 'gemini-embedding',
    sandbox: { command: 'docker', image: 'llxprt-code-sandbox' },
    targetDir: '/path/to/target',
    debugMode: false,
    question: 'test question',
    userMemory: 'Test User Memory',
    telemetry: { enabled: false },
    sessionId: 'test-session-id',
    model: 'gemini-pro',
    initialSettings: settingsService.getAllGlobalSettings(),
  };
  const paths: string[] = [];
  afterEach(async () => {
    for (const path of paths.splice(0))
      await rm(path, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    initializeShellParser.mockClear();
    ToolRegistry.mockClear();
  });

  describe('initialize', () => {
    it('initializes the shell parser before creating the tool registry', async () => {
      const parserInitialization = parserInitializationGate();
      initializeShellParser.mockReturnValueOnce(parserInitialization.promise);
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      const initialization = initializeWorkspace(config);
      await waitFor(() => {
        expect(initializeShellParser).toHaveBeenCalledOnce();
      });

      expect(ToolRegistry).not.toHaveBeenCalled();

      parserInitialization.resolve(true);
      await initialization;

      expect(ToolRegistry).toHaveBeenCalledOnce();
      expect(initializeShellParser.mock.invocationCallOrder[0]).toBeLessThan(
        ToolRegistry.mock.invocationCallOrder[0],
      );
    });

    it('waits for shared parser initialization across concurrent configs', async () => {
      const parserInitialization = parserInitializationGate();
      initializeShellParser
        .mockReturnValueOnce(parserInitialization.promise)
        .mockReturnValueOnce(parserInitialization.promise);
      const firstConfig = new Config({
        ...baseParams,
        checkpointing: false,
      });
      const secondConfig = new Config({
        ...baseParams,
        checkpointing: false,
      });

      const initializations = [
        initializeWorkspace(firstConfig),
        initializeWorkspace(secondConfig),
      ];
      await waitFor(() => {
        expect(initializeShellParser).toHaveBeenCalledTimes(2);
      });

      expect(initializeShellParser.mock.results[0].value).toBe(
        initializeShellParser.mock.results[1].value,
      );
      expect(ToolRegistry).not.toHaveBeenCalled();

      parserInitialization.resolve(true);
      await Promise.all(initializations);

      expect(ToolRegistry).toHaveBeenCalledTimes(2);
    });

    it('continues startup when the shell parser cannot load', async () => {
      initializeShellParser.mockResolvedValueOnce(false);
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      const runtime = await createTestMcpRuntime(
        { oauth: createTestOAuthBinding(), config },
        {},
      );
      owners.push(runtime);
      await runtime.initialize();
      expect(runtime.messageBus).toBe(runtime.policyOwner.session.messageBus);

      expect(ToolRegistry).toHaveBeenCalledOnce();
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      vi.spyOn(GitService.prototype, 'initialize').mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      const runtime = await createTestMcpRuntime(
        { oauth: createTestOAuthBinding(), config },
        {},
      );
      owners.push(runtime);
      await runtime.initialize();
      expect(runtime.messageBus).toBe(runtime.policyOwner.session.messageBus);
    });

    it('retains its original workspace through repeated owner initialization', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'startup-cached-skills-'));
      paths.push(directory);
      const originalPath = join(directory, '.agents', 'skills', 'original');
      await mkdir(originalPath, { recursive: true });
      await writeFile(
        join(originalPath, 'SKILL.md'),
        '---\nname: original\ndescription: original publication\n---\nphysical original skill',
      );
      const config = new Config({
        ...baseParams,
        targetDir: directory,
        cwd: directory,
        trustedFolder: true,
        checkpointing: false,
        skillsSupport: true,
      });
      owners.push(config);
      const runtime = await createTestMcpRuntime(
        { oauth: createTestOAuthBinding(), config },
        {},
      );
      owners.push(runtime);
      await runtime.initialize();
      expect(runtime.messageBus).toBe(runtime.policyOwner.session.messageBus);
      const registry = runtime.toolSelection;
      const original = runtime.workspaceSkills.initialize();
      await original;
      await rm(originalPath, { recursive: true });
      const changedPath = join(directory, '.agents', 'skills', 'changed');
      await mkdir(changedPath);
      await writeFile(
        join(changedPath, 'SKILL.md'),
        '---\nname: changed\ndescription: later publication\n---\nnot admitted by repeated startup',
      );
      const repeated = runtime.workspaceSkills.initialize();
      expect(repeated).toBe(original);
      await repeated;
      expect(
        runtime.workspaceSkills.operations.list().map((skill) => skill.name),
      ).toStrictEqual(['original']);
      expect(
        registry.getAllToolNames().filter((name) => name === 'activate_skill'),
      ).toHaveLength(1);
      expect(registry.getTool('activate_skill')).toBeDefined();
    });
  });
});
