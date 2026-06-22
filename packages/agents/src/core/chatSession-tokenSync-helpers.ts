/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for ChatSession token-sync test files. Extracted from the
 * original monolithic chatSession.tokenSync.test.ts so no file-level
 * max-lines disable is needed.
 */

import { vi } from 'vitest';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export interface MockContentGenerator {
  generateContent: ReturnType<typeof vi.fn>;
  generateContentStream: ReturnType<typeof vi.fn>;
  countTokens: ReturnType<typeof vi.fn>;
  embedContent: ReturnType<typeof vi.fn>;
}

export interface TokenSyncTestFixture {
  mockConfig: Config;
  runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
  providerRuntimeSnapshot: ProviderRuntimeContext;
  mockContentGenerator: MockContentGenerator;
  historyService: HistoryService;
}

/**
 * Builds the shared mutable state used by token-sync tests. Each test file
 * calls this in its beforeEach to obtain fresh mocks without duplicating the
 * ~80-line setup block.
 */
export function createTokenSyncTestFixture(): TokenSyncTestFixture {
  const mockProvider = {
    name: 'test-provider',
    generateContent: vi.fn().mockResolvedValue({
      content: [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Test response' }],
        },
      ],
    }),
    generateContentStream: vi.fn(),
    generateChatCompletion: vi.fn().mockImplementation(() =>
      (async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Test response' }],
        };
      })(),
    ),
  } as never;

  const providerManager = {
    getActiveProvider: vi.fn(() => mockProvider),
  } as never;

  const runtimeSetup = createChatSessionRuntime({
    provider: mockProvider,
    providerManager,
    configOverrides: {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      setModel: vi.fn(),
      getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
      setQuotaErrorOccurred: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getProviderManager: vi.fn().mockReturnValue(providerManager),
    },
  });

  const mockConfig = runtimeSetup.config;
  const providerRuntimeSnapshot: ProviderRuntimeContext = {
    ...runtimeSetup.runtime,
    config: mockConfig,
  };
  providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

  const mockContentGenerator: MockContentGenerator = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  };

  const historyService = new HistoryService();

  return {
    mockConfig,
    runtimeSetup,
    providerRuntimeSnapshot,
    mockContentGenerator,
    historyService,
  };
}

export { providerRuntime };
