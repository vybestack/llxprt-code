/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import {
  Config,
  DEFAULT_FILE_FILTERING_OPTIONS,
  type ConfigParameters,
} from './config.js';
import * as path from 'node:path';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  buildToolsMockBody,
  buildTelemetryMockBody,
  buildGitServiceMockBody,
  buildIdeIntegrationMockBody,
  buildMemoryDiscoveryMockBody,
  buildEventsMockBody,
  buildFetchMockBody,
  createBaseParams,
  resetAgentClientMock,
  sharedConfigTestConstants,
  type HoistedConfigMocks,
} from './__tests__/configTestHarness.js';

const { USER_MEMORY, TARGET_DIR, TELEMETRY_SETTINGS } =
  sharedConfigTestConstants;

// Hoisted mocks referenced by mock factories below (vitest hoist-safe).
const hoistedConfigMocks = {
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
} as HoistedConfigMocks;

// Mock dependencies that might be called during Config construction or createServerConfig.
const __actual2 = { ...(await import('@vybestack/llxprt-code-tools')) };
void vi.mock('@vybestack/llxprt-code-tools', () =>
  buildToolsMockBody(__actual2),
);

// Mock individual tools if their constructors are complex or have side effects

void vi.mock('../telemetry/index.js', () => buildTelemetryMockBody());

void vi.mock('../services/gitService.js', () => buildGitServiceMockBody());

const __actual4 = {
  ...(await import('@vybestack/llxprt-code-ide-integration')),
};
void vi.mock('@vybestack/llxprt-code-ide-integration', () =>
  buildIdeIntegrationMockBody(__actual4),
);

void vi.mock('../utils/memoryDiscovery.js', () =>
  buildMemoryDiscoveryMockBody(hoistedConfigMocks),
);

const __actual5 = { ...(await import('../utils/events.js')) };
void vi.mock('../utils/events.js', () =>
  buildEventsMockBody(__actual5, hoistedConfigMocks),
);

void vi.mock('../utils/fetch.js', () => buildFetchMockBody(hoistedConfigMocks));

describe('Server Config (config.ts)', () => {
  const baseParams = createBaseParams(new SettingsService());

  beforeEach(() => {
    resetAgentClientMock();
    hoistedConfigMocks.loadJitSubdirectoryMemory.mockResolvedValue({
      files: [],
    });
  });
  it('Config constructor should store userMemory correctly', () => {
    const config = new Config(baseParams);

    expect(config.getProvidedInstructions()).toBe(USER_MEMORY);
    // Verify other getters if needed
    expect(config.getTargetDir()).toBe(path.resolve(TARGET_DIR)); // Check resolved path
  });

  it('Config constructor should default userMemory to empty string if not provided', () => {
    const paramsWithoutMemory: ConfigParameters = { ...baseParams };
    delete paramsWithoutMemory.userMemory;
    const config = new Config(paramsWithoutMemory);

    expect(config.getProvidedInstructions()).toBe('');
  });

  it('retains declarative JIT settings without constructing memory state', () => {
    const config = new Config({ ...baseParams, jitContextEnabled: true });
    expect(config.isJitContextEnabled()).toBe(true);
    expect(config.getProvidedInstructions()).toBe(USER_MEMORY);
  });

  it('retains externally supplied instructions with JIT disabled', () => {
    const config = new Config({ ...baseParams, jitContextEnabled: false });
    expect(config.getProvidedInstructions()).toBe(USER_MEMORY);
  });

  it('copies declarative memory settings on read', () => {
    const config = new Config({ ...baseParams, contextFileName: 'PROJECT.md' });
    const settings = config.getMemorySettings();
    Reflect.set(settings.filenames, '0', 'OTHER.md');
    Reflect.set(settings.filtering, 'respectGitIgnore', true);
    expect(config.getMemorySettings().filtering.respectGitIgnore).toBe(false);
    expect(settings.filenames).not.toStrictEqual(
      config.getMemorySettings().filenames,
    );
    expect(config.getMemorySettings().filenames).toStrictEqual(['PROJECT.md']);
  });

  it('defaults blank instruction filenames and copies externally supplied filename declarations', () => {
    const blank = new Config({ ...baseParams, contextFileName: '  ' });
    expect(blank.getMemorySettings().filenames).toStrictEqual(['LLXPRT.md']);
    const filenames = ['ALPHA.md'];
    const isolated = new Config({
      ...baseParams,
      memorySettings: {
        filenames,
        importFormat: 'tree',
        maxDirectories: 200,
        filtering: { respectGitIgnore: false, respectLlxprtIgnore: true },
      },
    });
    filenames.push('BETA.md');
    expect(isolated.getMemorySettings().filenames).toStrictEqual(['ALPHA.md']);
  });

  it('retains explicit context filename declarations', () => {
    const contextFileName = 'CUSTOM_AGENTS.md';
    const paramsWithContextFile: ConfigParameters = {
      ...baseParams,
      contextFileName,
    };
    const config = new Config(paramsWithContextFile);
    expect(config.getMemorySettings().filenames).toStrictEqual([
      contextFileName,
    ]);
  });

  it('defaults the root-specific instruction filename declaration', () => {
    const config = new Config(baseParams);
    expect(config.getMemorySettings().filenames).toStrictEqual(['LLXPRT.md']);
  });

  it('should set default file filtering settings when not provided', () => {
    const config = new Config(baseParams);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(
      DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
    );
  });

  it('should set custom file filtering settings when provided', () => {
    const paramsWithFileFiltering: ConfigParameters = {
      ...baseParams,
      fileFiltering: {
        respectGitIgnore: false,
      },
    };
    const config = new Config(paramsWithFileFiltering);
    expect(config.getFileFilteringRespectGitIgnore()).toBe(false);
  });

  it('Config constructor should set telemetry to true when provided as true', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: true },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(true);
  });

  it('Config constructor should set telemetry to false when provided as false', () => {
    const paramsWithTelemetry: ConfigParameters = {
      ...baseParams,
      telemetry: { enabled: false },
    };
    const config = new Config(paramsWithTelemetry);
    expect(config.getTelemetryEnabled()).toBe(false);
  });

  it('Config constructor should default telemetry to default value if not provided', () => {
    const paramsWithoutTelemetry: ConfigParameters = { ...baseParams };
    delete paramsWithoutTelemetry.telemetry;
    const config = new Config(paramsWithoutTelemetry);
    expect(config.getTelemetryEnabled()).toBe(TELEMETRY_SETTINGS.enabled);
  });

  it('retains the declared workspace root as data without constructing discovery', () => {
    const config = new Config(baseParams);
    expect(config.getTargetDir()).toBe(baseParams.targetDir);
  });
});
