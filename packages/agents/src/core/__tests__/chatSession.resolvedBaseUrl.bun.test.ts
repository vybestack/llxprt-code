/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ANTHROPIC_DEFAULT_BASE_URL } from '@vybestack/llxprt-code-providers';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderAdapterFromManager } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ChatSession } from '../chatSession.js';
import { TestRuntimeProviderManager } from '../../test-utils/runtimeProviderManager.js';

const UNUSED_CONTENT_GENERATOR: ContentGenerator = {
  generateContent: () => Promise.reject(new Error('Not used by this test')),
  generateContentStream: () =>
    Promise.reject(new Error('Not used by this test')),
  countTokens: () => Promise.reject(new Error('Not used by this test')),
  embedContent: () => Promise.reject(new Error('Not used by this test')),
};

function createProvider(name: string): RuntimeProvider {
  return {
    name,
    getModels: () => Promise.resolve([]),
    getServerTools: () => [],
    invokeServerTool: () => Promise.resolve(undefined),
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {},
  };
}

function createChatSession(options: {
  manager: TestRuntimeProviderManager;
  providerName: string;
  baseUrl?: string;
}): ChatSession {
  const settingsService = new SettingsService();
  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    runtimeId: 'resolved-base-url-test',
    metadata: { source: 'chatSession.resolvedBaseUrl.bun.test' },
  });
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'resolved-base-url-test',
    provider: options.providerName,
    model: 'test-model',
    sessionId: 'resolved-base-url-test',
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
  });
  const runtimeContext = createAgentRuntimeContext({
    state: runtimeState,
    history: new HistoryService(),
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128_000,
      preserveThreshold: 0.2,
    },
    provider: createProviderAdapterFromManager(options.manager),
    telemetry: {
      logApiRequest: () => {},
      logApiResponse: () => {},
      logApiError: () => {},
    },
    tools: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    providerRuntime,
  });

  return new ChatSession(runtimeContext, UNUSED_CONTENT_GENERATOR, {}, []);
}

describe('ChatSession.getResolvedBaseUrl', () => {
  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-4
   */
  it('S1: prefers the load balancer last-selected endpoint', () => {
    const manager = new TestRuntimeProviderManager();
    const provider = {
      ...createProvider('router'),
      getLastSelectedBaseUrl: () => 'https://lb-child.example/v1',
    };
    manager.registerProvider(provider);
    const chat = createChatSession({
      manager,
      providerName: provider.name,
      baseUrl: 'https://runtime.example/v1',
    });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBe('https://lb-child.example/v1');
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-4
   */
  it('S2: returns the runtime base URL for a plain provider', () => {
    const manager = new TestRuntimeProviderManager();
    const provider = createProvider('openai');
    manager.registerProvider(provider);
    const chat = createChatSession({
      manager,
      providerName: provider.name,
      baseUrl: 'https://proxy.example/v1',
    });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBe('https://proxy.example/v1');
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-2
   * @requirement:REQ-2231-4
   */
  it('S3: returns undefined when no active provider can be resolved', () => {
    const manager = new TestRuntimeProviderManager();
    const chat = createChatSession({ manager, providerName: 'missing' });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBeUndefined();
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-4
   */
  it('S4: returns the native Anthropic default without a runtime base URL', () => {
    const manager = new TestRuntimeProviderManager();
    const provider = createProvider('anthropic');
    manager.registerProvider(provider);
    const chat = createChatSession({ manager, providerName: provider.name });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBe(ANTHROPIC_DEFAULT_BASE_URL);
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-4
   */
  it('S5: falls back to the runtime base URL when the LB has no selection yet', () => {
    const manager = new TestRuntimeProviderManager();
    const provider = {
      ...createProvider('router'),
      getLastSelectedBaseUrl: () => undefined,
    };
    manager.registerProvider(provider);
    const chat = createChatSession({
      manager,
      providerName: provider.name,
      baseUrl: 'https://runtime.example/v1',
    });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBe('https://runtime.example/v1');
  });

  /**
   * @plan:PLAN-20260824-ISSUE2231.P01
   * @requirement:REQ-2231-4
   */
  it('S6: returns undefined when the LB last-selection probe throws, instead of propagating', () => {
    const manager = new TestRuntimeProviderManager();
    const provider = {
      ...createProvider('router'),
      getLastSelectedBaseUrl: () => {
        throw new Error('probe exploded');
      },
    };
    manager.registerProvider(provider);
    const chat = createChatSession({
      manager,
      providerName: provider.name,
      baseUrl: 'https://runtime.example/v1',
    });

    const result = chat.getResolvedBaseUrl();

    expect(result).toBeUndefined();
  });
});
