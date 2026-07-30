/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
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

vi.mock('fs', (importOriginal) => buildFsMockBody(importOriginal()));

// Mock dependencies that might be called during Config construction or createServerConfig.
vi.mock('@vybestack/llxprt-code-tools', (importOriginal) =>
  buildToolsMockBody(
    importOriginal() as typeof import('@vybestack/llxprt-code-tools'),
  ),
);

// Mock individual tools if their constructors are complex or have side effects

vi.mock('../core/contentGenerator.js', (importOriginal) =>
  buildContentGeneratorMockBody(importOriginal()),
);

vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

vi.mock('@vybestack/llxprt-code-settings', () => buildSettingsMockBody());

vi.mock('@vybestack/llxprt-code-ide-integration', (importOriginal) =>
  buildIdeIntegrationMockBody(
    importOriginal() as typeof import('@vybestack/llxprt-code-ide-integration'),
  ),
);

vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

vi.mock('../utils/events.js', (importOriginal) =>
  buildEventsMockBody(importOriginal(), hoistedConfigMocks),
);

vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

describe('Server Config (config.ts)', () => {
  const baseParams = createBaseParams(
    getSettingsService() as unknown as SettingsService,
  );

  beforeEach(() => {
    resetAgentClientMock();
  });

  describe('initialize', () => {
    it('should throw an error if checkpointing is enabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      await expect(initializeTestConfig(config)).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      (GitService.prototype.initialize as Mock).mockRejectedValue(gitError);

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
