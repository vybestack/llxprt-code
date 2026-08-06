/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import type { Mock } from 'bun:test';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { Config } from './config.js';
import { GitService } from '../services/gitService.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  buildFsMockBody,
  buildToolsMockBody,
  buildContentGeneratorMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildSettingsMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  createBaseParams,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './configTestHarness.js';

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = vi.hoisted<HoistedConfigMocks>(() => ({
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
}));

const initializeShellParser = vi.fn(() => Promise.resolve(true));

vi.mock('../utils/shell-parser.js', () => ({
  initializeParser: initializeShellParser,
  isParserAvailable: () => true,
  parseShellCommand: () => null,
  extractCommandNames: () => [],
  hasCommandSubstitution: () => false,
  splitCommandsWithTree: () => [],
  parseCommandDetails: () => null,
  hasPromptCommandTransform: () => false,
}));

const __actual = { ...(await import('fs')) };
vi.mock('fs', () => buildFsMockBody(__actual));

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual2 = { ...(await import('@vybestack/llxprt-code-tools')) };
vi.mock('@vybestack/llxprt-code-tools', () => buildToolsMockBody(__actual2));

// Mock individual tools if their constructors are complex or have side effects

const __actual3 = { ...(await import('../core/contentGenerator.js')) };
vi.mock('../core/contentGenerator.js', () =>
  buildContentGeneratorMockBody(__actual3),
);

vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

vi.mock('@vybestack/llxprt-code-settings', () => buildSettingsMockBody());

const __actual4 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual4),
);

vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual5 = { ...(await import('../utils/events.js')) };
vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual5, hoistedConfigMocks),
);

vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

describe('Server Config (config.ts)', () => {
  const baseParams = createBaseParams(
    getSettingsService() as unknown as SettingsService,
  );

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

      const initialization = initializeTestConfig(config);
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
        initializeTestConfig(firstConfig),
        initializeTestConfig(secondConfig),
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

      await expect(initializeTestConfig(config)).resolves.toBeUndefined();

      expect(ToolRegistry).toHaveBeenCalledOnce();
    });

    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (
        GitService.prototype.initialize as Mock<(...args: never[]) => unknown>
      ).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      await expect(initializeTestConfig(config)).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (
        GitService.prototype.initialize as Mock<(...args: never[]) => unknown>
      ).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(initializeTestConfig(config)).resolves.toBeUndefined();
    });

    it('should throw an error if initialized more than once', async () => {
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await expect(initializeTestConfig(config)).resolves.toBeUndefined();
      await expect(initializeTestConfig(config)).rejects.toThrow(
        'Config was already initialized',
      );
    });

    it('should initialize and expose a ResourceRegistry instance', async () => {
      const config = new Config({
        ...baseParams,
        checkpointing: false,
      });

      await initializeTestConfig(config);

      const getResourceRegistry = (
        config as unknown as {
          getResourceRegistry?: () => unknown;
        }
      ).getResourceRegistry;
      expect(getResourceRegistry).toBeTypeOf('function');
      expect(getResourceRegistry?.call(config)).toBeInstanceOf(
        ResourceRegistry,
      );
    });
  });
});
