/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression: when the normalized resolved model is empty,
 * the system-prompt builder must fall back to the provider's default
 * model (deps.getDefaultModel) — the same source createRequest uses —
 * never the provider base URL.
 *
 * Exercises the real executor function with a real NormalizedGenerateChatOptions
 * and a real ResponsesExecutorDeps. Only the fetch boundary and the prompt-
 * service boundary are intercepted (both are legitimate I/O edges).
 *
 * @issue #2483
 */

import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  executeOpenAIResponsesRequest,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';

const getCoreSystemPromptAsyncSpy = vi.hoisted(() =>
  vi.fn().mockResolvedValue('system prompt'),
);

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: getCoreSystemPromptAsyncSpy,
}));

function buildNormalizedOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'test-runtime',
  });
  const config = createRuntimeConfigStub(settings, {});
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai-responses',
    ephemeralsSnapshot: {},
    fallbackRuntimeId: 'test-runtime',
  });

  const base = {
    contents: [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Hello' }],
      },
    ],
    settings,
    config,
    runtime,
    invocation,
    userMemory: undefined,
    tools: undefined,
    metadata: {},
    resolved: {
      model: '',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-token',
    },
    // The double assertion is required because `config` here is a
    // lightweight `createRuntimeConfigStub`, which intentionally does NOT
    // implement the full core `Config` surface that
    // `NormalizedGenerateChatOptions.config` demands. The executor only
    // touches the narrow subset exercised below, so constructing a real
    // `Config` would add large, irrelevant setup. This matches the
    // established stub convention used across the providers test suite.
  } as unknown as NormalizedGenerateChatOptions;

  return { ...base, ...overrides };
}

function buildDeps(
  overrides: Partial<ResponsesExecutorDeps> = {},
): ResponsesExecutorDeps {
  return {
    providerName: 'openai-responses',
    logger: { debug: vi.fn() } as unknown as ResponsesExecutorDeps['logger'],
    getProviderBaseURL: () => 'https://api.openai.com/v1',
    getCustomHeaders: () => undefined,
    isCodexBaseURL: () => false,
    getCodexAccountId: async () => 'codex-account',
    resolveAuthTokenForPrompt: async () => '',
    generateSyntheticCallId: () => 'call_synthetic_test',
    shouldRetryOnError: () => false,
    getDefaultModel: () => 'o3-mini',
    getGlobalConfig: () => undefined,
    ...overrides,
  };
}

describe('executeOpenAIResponsesRequest empty-resolved-model fallback @issue:2483', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCoreSystemPromptAsyncSpy.mockResolvedValue('system prompt');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: undefined,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes deps.getDefaultModel() to getCoreSystemPromptAsync when resolved model is empty', async () => {
    const deps = buildDeps({ getDefaultModel: () => 'o3-mini' });
    const options = buildNormalizedOptions({
      resolved: {
        model: '',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    expect(getCoreSystemPromptAsyncSpy).toHaveBeenCalledTimes(1);
    const promptArg = getCoreSystemPromptAsyncSpy.mock.calls[0][0] as {
      model: string;
    };
    expect(promptArg.model).toBe('o3-mini');
  });

  it('does NOT pass the provider base URL as the model when resolved model is empty', async () => {
    const baseURL = 'https://api.openai.com/v1';
    const deps = buildDeps({
      getDefaultModel: () => 'o3-mini',
      getProviderBaseURL: () => baseURL,
    });
    const options = buildNormalizedOptions({
      resolved: {
        model: '',
        baseURL,
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    expect(getCoreSystemPromptAsyncSpy).toHaveBeenCalledTimes(1);
    const promptArg = getCoreSystemPromptAsyncSpy.mock.calls[0][0] as {
      model: string;
    };
    // Positive assertion: the fallback must be the provider default, not
    // merely "anything other than the base URL" (which undefined/null would
    // also satisfy). This makes the regression test fail if the fallback
    // logic breaks in any way.
    expect(promptArg.model).toBe('o3-mini');
    expect(promptArg.model).not.toBe(baseURL);
  });

  it('passes the resolved model when it is non-empty', async () => {
    const deps = buildDeps({ getDefaultModel: () => 'o3-mini' });
    const options = buildNormalizedOptions({
      resolved: {
        model: 'gpt-5.6-sol',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'test-token',
      } as NormalizedGenerateChatOptions['resolved'],
    });

    const iterator = executeOpenAIResponsesRequest(options, deps);
    await iterator.next();

    expect(getCoreSystemPromptAsyncSpy).toHaveBeenCalledTimes(1);
    const promptArg = getCoreSystemPromptAsyncSpy.mock.calls[0][0] as {
      model: string;
    };
    expect(promptArg.model).toBe('gpt-5.6-sol');
  });
});
