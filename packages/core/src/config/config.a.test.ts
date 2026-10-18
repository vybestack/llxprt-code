/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'bun:test';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { Config } from './config.js';
import { GitService } from '../services/gitService.js';
import { WorkspaceCheckpointOwner } from '../services/workspace-checkpoint-owner.js';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { McpRuntimeOwner } from '@vybestack/llxprt-code-agents';
import { WorkspaceMcpCatalogOwner } from '../services/workspace-mcp-catalog-owner.js';

import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  createBaseParams,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './__tests__/configTestHarness.js';

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
} as HoistedConfigMocks;

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
void vi.mock('../utils/shell-parser.js', () => parserInfrastructure);
void vi.mock(
  '@vybestack/llxprt-code-core/utils/shell-parser.js',
  () => parserInfrastructure,
);

const __actual = { ...(await import('fs')) };
void vi.mock('fs', () => buildFsMockBody(__actual));

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual2 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () => ({
  ...buildToolsMockBody(__actual2),
  ToolRegistry: vi.fn(
    (...args: ConstructorParameters<typeof ToolRegistry>) =>
      new __actual2.ToolRegistry(...args),
  ),
}));

// Mock individual tools if their constructors are complex or have side effects

const __actual3 = { ...(await import('../core/contentGenerator.js')) };
void vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual3),
);

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual5 = { ...(await import('../utils/events.js')) };
void vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual5, hoistedConfigMocks),
);

describe('Server Config (config.ts)', () => {
  const owners: Array<{ dispose(): void | Promise<void> }> = [];

  async function initializeWorkspace(config: Config): Promise<void> {
    owners.push(config);
    const workspace = await McpRuntimeOwner.create(
      createTestOAuthBinding(),
      config,
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
  const baseParams = createBaseParams(new SettingsService());
  const paths: string[] = [];
  afterEach(async () => {
    for (const path of paths.splice(0))
      await rm(path, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetAgentClientMock();
    initializeShellParser.mockClear();
    (
      ToolRegistry as unknown as Mock<(...args: never[]) => unknown>
    ).mockClear();
  });

  describe('initialize', () => {
    it('initializes the shell parser before creating the tool registry', async () => {
      const parserInitialization = Promise.withResolvers<boolean>();
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
        (ToolRegistry as unknown as Mock<(...args: never[]) => unknown>).mock
          .invocationCallOrder[0],
      );
    });

    it('waits for shared parser initialization across concurrent configs', async () => {
      const parserInitialization = Promise.withResolvers<boolean>();
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

      const runtime = await McpRuntimeOwner.create(
        createTestOAuthBinding(),
        config,
      );
      owners.push(runtime);
      await runtime.initialize();
      expect(runtime.messageBus).toBe(runtime.policyOwner.session.messageBus);

      expect(ToolRegistry).toHaveBeenCalledOnce();
    });

    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      vi.spyOn(GitService.prototype, 'initialize').mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      const checkpoints = new WorkspaceCheckpointOwner(
        config.getTargetDir(),
        config.projectHistoryDir,
        config.getCheckpointingEnabled(),
      );
      const initialization = checkpoints.initialize();
      const disposal = checkpoints.dispose();
      await expect(initialization).rejects.toThrow(gitError);
      await expect(disposal).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      vi.spyOn(GitService.prototype, 'initialize').mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      const runtime = await McpRuntimeOwner.create(
        createTestOAuthBinding(),
        config,
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
      const runtime = await McpRuntimeOwner.create(
        createTestOAuthBinding(),
        config,
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

    it('returns an independently owned workspace catalog without storing registries on Config', async () => {
      const config = new Config({ ...baseParams, checkpointing: false });
      const catalog = new WorkspaceMcpCatalogOwner(
        () => true,
        async () => {
          throw new Error('No resource transport selected');
        },
      );
      owners.push(catalog);
      catalog.resourcePublication.setResourcesForServer('fixture', [
        { name: 'entry', uri: 'fixture:///entry' },
      ]);
      expect(
        catalog.resourceSelection.findResource('fixture:fixture:///entry'),
      ).toMatchObject({
        serverName: 'fixture',
        name: 'entry',
        uri: 'fixture:///entry',
      });
      expect('getResourceRegistry' in config).toBe(false);
      expect('getPromptRegistry' in config).toBe(false);
      await catalog.dispose();
      expect(() => catalog.resourceSelection.listResources()).toThrow(
        'stopped',
      );
    });
  });
});
