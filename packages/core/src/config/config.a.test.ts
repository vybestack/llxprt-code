/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as nodeFs from 'node:fs';
import * as actualTools from '../../../tools/index.ts';
import * as actualSettings from '../../../settings/index.ts';
import * as actualIdeIntegration from '../../../ide-integration/index.ts';
import { coreEvents as actualCoreEvents } from '../utils/events.js';
import { Config } from './config.js';
import { GitService } from '../services/gitService.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { initializeTestConfig } from '../test-utils/config.js';
import {
  buildEventsMockBody,
  buildFetchMockBody,
  buildFsMockBody,
  buildGitServiceMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildSettingsMockBody,
  buildTelemetryMockBody,
  buildToolsMockBody,
  createBaseParams,
  gitServiceInitializeMock,
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

vi.mock('fs', () => buildFsMockBody(nodeFs));

// Mock dependencies that might be called during Config construction or createServerConfig.
vi.mock('@vybestack/llxprt-code-tools', () => buildToolsMockBody(actualTools));

// Mock individual tools if their constructors are complex or have side effects

vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());
vi.mock('../services/gitService.js', () => buildGitServiceMockBody());
vi.mock('@vybestack/llxprt-code-settings', () =>
  buildSettingsMockBody(actualSettings),
);
vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(actualIdeIntegration),
);
vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);
vi.mock('../utils/events.js', () =>
  buildEventsMockBody({ coreEvents: actualCoreEvents }, hoistedConfigMocks),
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
      gitServiceInitializeMock.mockRejectedValue(gitError);

      const config = new Config({
        ...baseParams,
        checkpointing: true,
      });

      await expect(initializeTestConfig(config)).rejects.toThrow(gitError);
    });

    it('should not throw an error if checkpointing is disabled and GitService fails', async () => {
      const gitError = new Error('Git is not installed');
      gitServiceInitializeMock.mockRejectedValue(gitError);

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
