/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test setup for AnthropicProvider core tests.
 * Extracted from AnthropicProvider.test.ts to support splitting.
 */

import type { vi } from 'vitest';
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

export type AnthropicContentBlock =
  | {
      type: 'text';
      text: string;
      cache_control?: { type: string; ttl?: string };
    }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: unknown;
      cache_control?: { type: string; ttl?: string };
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
      cache_control?: { type: string; ttl?: string };
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

// Mock the ToolFormatter

// Mock the prompts module

// Mock the retry utility

// Shared mock instance for messages.create

// Mock the Anthropic SDK

export interface MockAnthropicInstance {
  messages: {
    create: ReturnType<typeof vi.fn>;
  };
}

export interface AnthropicTestSetup {
  provider: AnthropicProvider;
  runtimeContext: ProviderRuntimeContext;
  settingsService: SettingsService;
  buildCallOptions: (
    contents: IContent[],
    overrides?: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'>,
  ) => ReturnType<typeof createProviderCallOptions>;
}

export function setupAnthropicProvider(): AnthropicTestSetup {
  const result = createProviderWithRuntime<AnthropicProvider>(
    ({ settingsService: svc }) => {
      svc.set('auth-key', 'test-api-key');
      svc.set('activeProvider', 'anthropic');
      svc.setProviderSetting('anthropic', 'streaming', 'disabled');
      return new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
      );
    },
    {
      runtimeId: 'anthropic.provider.test',
      metadata: { source: 'AnthropicProvider.test-helpers.ts' },
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

  return {
    provider,
    runtimeContext,
    settingsService,
    buildCallOptions,
  };
}
