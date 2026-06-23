/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test setup for AnthropicProvider extended thinking tests.
 * Extracted from AnthropicProvider.thinking.test.ts to support splitting.
 */

import { vi } from 'vitest';
import { AnthropicProvider } from '../AnthropicProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { setActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

// Mock the prompts module
vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

// Mock the retry utility
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

// Shared mock instance for messages.create
export const mockMessagesCreate = vi.fn();

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

export interface ThinkingTestSetup {
  provider: AnthropicProvider;
  runtimeContext: ProviderRuntimeContext;
  settingsService: SettingsService;
  buildCallOptions: (
    contents: IContent[],
    overrides?: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'>,
  ) => ReturnType<typeof createProviderCallOptions>;
}

/**
 * Creates a provider + runtime context for thinking tests.
 * Must be called inside beforeEach; caller must call
 * clearActiveProviderRuntimeContext() in afterEach.
 */
export function setupThinkingProvider(): ThinkingTestSetup {
  let ephemeralSettingsGetter: () => Record<string, unknown> = () => ({});

  const result = createProviderWithRuntime<AnthropicProvider>(
    ({ settingsService: svc }) => {
      svc.set('auth-key', 'test-api-key');
      svc.set('activeProvider', 'anthropic');
      svc.setProviderSetting('anthropic', 'streaming', 'disabled');

      ephemeralSettingsGetter = () => ({
        ...svc.getAllGlobalSettings(),
        ...svc.getProviderSettings('anthropic'),
      });

      return new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: ephemeralSettingsGetter,
      });
    },
    {
      runtimeId: 'anthropic.thinking.test',
      metadata: { source: 'AnthropicProvider.thinking.test-helpers.ts' },
    },
  );

  const { provider, runtime: runtimeContext, settingsService } = result;

  runtimeContext.config ??= createRuntimeConfigStub(settingsService);

  runtimeContext.config.getEphemeralSettings = () => ({
    ...settingsService.getAllGlobalSettings(),
    ...settingsService.getProviderSettings(provider.name),
  });

  runtimeContext.config.getEphemeralSetting = (key: string) => {
    const providerValue = settingsService.getProviderSettings(provider.name)[
      key
    ];
    if (providerValue !== undefined) {
      return providerValue;
    }
    return settingsService.get(key);
  };

  setActiveProviderRuntimeContext(runtimeContext);

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
    });

  return { provider, runtimeContext, settingsService, buildCallOptions };
}
