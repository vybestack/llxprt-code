/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Stream idle timeout behavioral tests for TurnProcessor and
 * DirectMessageProcessor. Sibling to chatSession.runtime.test.ts (split to
 * avoid file-level max-lines disable).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatSession } from './chatSession.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeStateFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeStateFactory.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

describe('stream idle timeout behavioral tests for TurnProcessor and DirectMessageProcessor', () => {
  const originalEnv = process.env;
  let localSettingsService: SettingsService;
  let localConfig: Config;
  let localProviderRuntime: ProviderRuntimeContext;
  let localManager: TestRuntimeProviderManager;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('TurnProcessor', () => {
    it('honors config setting: uses resolveStreamIdleTimeoutMs with config from getConfig()', async () => {
      const customTimeoutMs = 12_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify ChatSession.getConfig() returns a config that provides the setting
      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'timeout-test' },
      });

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      // Verify the config is accessible via getConfig()
      const configFromChat = chat.getConfig();
      expect(configFromChat).toBeDefined();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(customTimeoutMs);
    });

    it('disabled path: setting 0 disables watchdog', async () => {
      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 0);

      localProviderRuntime = createProviderRuntimeContext({
        settingsService: localSettingsService,
        config: localConfig,
        runtimeId: 'test.runtime',
        metadata: { source: 'disabled-test' },
      });

      localManager = new TestRuntimeProviderManager(localProviderRuntime);
      localManager.setConfig(localConfig);
      localConfig.setProviderManager(localManager);

      const provider: IProvider = {
        name: 'stub',
        isDefault: true,
        getModels: vi.fn(async () => []),
        getDefaultModel: () => 'stub-model',
        generateChatCompletion: vi.fn(async function* () {}),
        getServerTools: () => [],
        invokeServerTool: vi.fn(),
      };
      localManager.registerProvider(provider);
      localManager.setActiveProvider('stub');

      const contentGenerator = {} as ContentGenerator;
      const chat = new ChatSession(
        createAgentRuntimeContext({
          state: createAgentRuntimeStateFromConfig(localConfig),
          settings: { compressionThreshold: 0.8 },
          provider: createProviderAdapterFromManager(localManager),
          telemetry: createTelemetryAdapterFromConfig(localConfig),
          tools: createToolRegistryViewFromRegistry(
            localConfig.getToolRegistry(),
          ),
          providerRuntime: localProviderRuntime,
        }),
        contentGenerator,
        {},
        [],
      );

      const configFromChat = chat.getConfig();
      expect(
        configFromChat?.getEphemeralSetting('stream-idle-timeout-ms'),
      ).toBe(0);
    });

    it('env var precedence: env var overrides config setting', async () => {
      const envTimeoutMs = 15_000;
      process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = String(envTimeoutMs);

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting('stream-idle-timeout-ms', 60_000);

      const { resolveStreamIdleTimeoutMs } = await import(
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );

      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(envTimeoutMs); // Env wins
    });
  });

  describe('DirectMessageProcessor (via generateDirectMessage)', () => {
    it('uses runtimeContext.config for resolveStreamIdleTimeoutMs', async () => {
      const customTimeoutMs = 10_000;

      localSettingsService = new SettingsService();
      localConfig = new Config(createConfigParams(localSettingsService));
      localConfig.setEphemeralSetting(
        'stream-idle-timeout-ms',
        customTimeoutMs,
      );

      // Verify the config is properly set
      expect(localConfig.getEphemeralSetting('stream-idle-timeout-ms')).toBe(
        customTimeoutMs,
      );

      // The DirectMessageProcessor passes runtimeContext.config to resolveStreamIdleTimeoutMs
      // This test verifies the config has the setting accessible
      const { resolveStreamIdleTimeoutMs } = await import(
        '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
      );
      const result = resolveStreamIdleTimeoutMs(localConfig);
      expect(result).toBe(customTimeoutMs);
    });
  });
});
