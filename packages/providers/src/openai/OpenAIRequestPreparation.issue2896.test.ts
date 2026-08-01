/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2896 - Request-body reasoning-dialect integration tests for
 * `prepareRequest`. These exercise the real OpenAIRequestPreparation pipeline
 * through `prepareRequest`, asserting that at most ONE reasoning
 * representation (`reasoning` / `thinking` / `reasoning_effort`) ever reaches
 * the outbound request body, and that foreign-dialect keys are absent.
 *
 * Acceptance rows covered: B3–B12.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import { REASONING_WIRE_KEYS } from './openaiReasoningDialect.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

vi.mock(
  '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js',
  () => ({
    shouldIncludeSubagentDelegation: vi.fn().mockResolvedValue(false),
  }),
);

vi.mock('../utils/userMemory.js', () => ({
  resolveUserMemory: vi.fn().mockResolvedValue(''),
}));

function createMockOptions(
  overrides: {
    baseURL?: string;
    modelBehavior?: Record<string, unknown>;
    modelParams?: Record<string, unknown>;
    ephemerals?: Record<string, unknown>;
  } = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  const invocation: Record<string, unknown> = {
    requestId: 'test-request',
    timestamp: Date.now(),
    modelBehavior: overrides.modelBehavior ?? {},
    ephemerals: overrides.ephemerals ?? {},
    modelParams: overrides.modelParams ?? {},
  };
  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    config: undefined,
    invocation,
    resolved: {
      model: 'gpt-4o',
      baseURL: overrides.baseURL,
      authToken: { token: 'test-token', type: 'api-key' },
    },
  } as unknown as NormalizedGenerateChatOptions;
}

function countReasoningKeys(body: Record<string, unknown>): number {
  return REASONING_WIRE_KEYS.filter((k) => k in body).length;
}

describe('OpenAIRequestPreparation.prepareRequest (issue #2896)', () => {
  let logger: DebugLogger;

  beforeEach(() => {
    logger = new DebugLogger('llxprt:provider:openai:test');
  });

  // B3: Friendli — no reasoning injected
  it('B3: friendli endpoint emits no reasoning/thinking/reasoning_effort', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.friendli.ai/serverless/v1',
      modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  // B4: Crusoe — no reasoning injected (trailing slash must still resolve)
  it('B4: crusoe endpoint emits no reasoning/thinking/reasoning_effort', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.inference.crusoecloud.com/v1/',
      modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  // B5: OpenRouter — exactly reasoning: { effort: 'high' }
  it('B5: openrouter endpoint emits reasoning.effort only', async () => {
    const options = createMockOptions({
      baseURL: 'https://openrouter.ai/api/v1',
      modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('reasoning', { effort: 'high' });
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B6: z.ai — thinking: { type: 'enabled' }
  it('B6: z.ai endpoint emits thinking.type=enabled only', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('thinking', { type: 'enabled' });
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B7: z.ai with reasoning.enabled=false — thinking: { type: 'disabled' }
  it('B7: z.ai endpoint emits thinking.type=disabled when enabled is false', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': false },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('thinking', { type: 'disabled' });
    expect(body).not.toHaveProperty('reasoning');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B8: bigmodel.cn — thinking: { type: 'enabled' }
  it('B8: bigmodel.cn endpoint emits thinking.type=enabled only', async () => {
    const options = createMockOptions({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('thinking', { type: 'enabled' });
    expect(body).not.toHaveProperty('reasoning');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B9: user sets modelParams.thinking explicitly — user value wins
  it('B9a: an explicit modelParams.thinking wins and is not overridden', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true },
      // 'disabled' is deliberately the opposite of what auto-selection would
      // emit for reasoning.enabled=true, so the assertion fails if the
      // explicit value is overwritten rather than respected.
      modelParams: { thinking: { type: 'disabled' } },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    // The user value arrives verbatim; no duplicate is injected.
    expect(body).toHaveProperty('thinking', { type: 'disabled' });
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B9: Friendli-native parse_reasoning also stands down auto-selection —
  // this is the third field from the issue's reported fan-out.
  it('B9c: an explicit modelParams.parse_reasoning suppresses the thinking dialect', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' },
      modelParams: { parse_reasoning: true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('parse_reasoning', true);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');
    expect(countReasoningKeys(body)).toBe(1);
  });

  it('B9d: an explicit modelParams.parse_reasoning suppresses the openrouter dialect', async () => {
    const options = createMockOptions({
      baseURL: 'https://openrouter.ai/api/v1',
      modelBehavior: { 'reasoning.enabled': true, 'reasoning.effort': 'high' },
      modelParams: { parse_reasoning: true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('parse_reasoning', true);
    expect(body).not.toHaveProperty('reasoning');
    expect(countReasoningKeys(body)).toBe(1);
  });

  it('B9b: an explicit modelParams.reasoning suppresses the thinking dialect', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true },
      modelParams: { reasoning: { effort: 'max' } },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('reasoning', { effort: 'max' });
    expect(body).not.toHaveProperty('thinking');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B10: user sets modelParams.reasoning_effort explicitly — user value wins
  it('B10: an explicit modelParams.reasoning_effort wins and no other dialect is injected', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.z.ai/api/paas/v4',
      modelBehavior: { 'reasoning.enabled': true },
      modelParams: { reasoning_effort: 'high' },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('reasoning_effort', 'high');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');
    expect(countReasoningKeys(body)).toBe(1);
  });

  // B11: no base-url (canonical OpenAI) — no thinking
  it('B11a: canonical OpenAI (no base-url) emits no thinking', async () => {
    const options = createMockOptions({
      modelBehavior: { 'reasoning.enabled': true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  // B11 variant: base-url from ephemeral 'base-url' (not resolved.baseURL)
  it('B11b: resolves base-url from ephemeral settings when resolved.baseURL is absent', async () => {
    const options = createMockOptions({
      ephemerals: { 'base-url': 'https://api.z.ai/api/paas/v4' },
      modelBehavior: { 'reasoning.enabled': true },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    // z.ai dialect via ephemeral base-url → thinking emitted
    expect(body).toHaveProperty('thinking', { type: 'enabled' });
  });

  // B12: invariant — at most one reasoning representation for every combination
  describe('B12: invariant — at most one of reasoning/thinking/reasoning_effort', () => {
    const cases: Array<{
      label: string;
      baseURL?: string;
      modelBehavior?: Record<string, unknown>;
      modelParams?: Record<string, unknown>;
    }> = [
      {
        label: 'friendli, reasoning enabled+effort',
        baseURL: 'https://api.friendli.ai/serverless/v1',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
      },
      {
        label: 'crusoe (trailing slash), reasoning enabled+effort',
        baseURL: 'https://api.inference.crusoecloud.com/v1/',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
      },
      {
        label: 'openrouter, reasoning enabled+effort',
        baseURL: 'https://openrouter.ai/api/v1',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
      },
      {
        label: 'openrouter, reasoning enabled, no effort',
        baseURL: 'https://openrouter.ai/api/v1',
        modelBehavior: { 'reasoning.enabled': true },
      },
      {
        label: 'z.ai, reasoning enabled',
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: { 'reasoning.enabled': true },
      },
      {
        label: 'z.ai, reasoning disabled',
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: { 'reasoning.enabled': false },
      },
      {
        label: 'bigmodel.cn, reasoning enabled',
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
        modelBehavior: { 'reasoning.enabled': true },
      },
      {
        label: 'canonical openai (no base-url)',
        modelBehavior: { 'reasoning.enabled': true },
      },
      {
        label: 'no reasoning settings at all',
        baseURL: 'https://openrouter.ai/api/v1',
      },
      {
        label: 'explicit modelParams.thinking on z.ai',
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: { 'reasoning.enabled': true },
        modelParams: { thinking: { type: 'enabled' } },
      },
      {
        label: 'explicit modelParams.reasoning_effort on z.ai',
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: { 'reasoning.enabled': true },
        modelParams: { reasoning_effort: 'high' },
      },
      {
        label: 'explicit modelParams.parse_reasoning on z.ai',
        baseURL: 'https://api.z.ai/api/paas/v4',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
        modelParams: { parse_reasoning: true },
      },
      {
        label: 'explicit modelParams.parse_reasoning on openrouter',
        baseURL: 'https://openrouter.ai/api/v1',
        modelBehavior: {
          'reasoning.enabled': true,
          'reasoning.effort': 'high',
        },
        modelParams: { parse_reasoning: true },
      },
      {
        label: 'openrouter, reasoning disabled with a leftover effort',
        baseURL: 'https://openrouter.ai/api/v1',
        modelBehavior: {
          'reasoning.enabled': false,
          'reasoning.effort': 'high',
        },
      },
      {
        label: 'z.ai, no reasoning settings at all',
        baseURL: 'https://api.z.ai/api/paas/v4',
      },
    ];

    for (const tc of cases) {
      it(`at most one reasoning key: ${tc.label}`, async () => {
        const options = createMockOptions({
          baseURL: tc.baseURL,
          modelBehavior: tc.modelBehavior,
          modelParams: tc.modelParams,
        });

        const result = await prepareRequest(
          options,
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );

        const body = result.requestBody as Record<string, unknown>;
        expect(countReasoningKeys(body)).toBeLessThanOrEqual(1);
      });
    }
  });

  // Regression: arbitrary modelParams passthrough still arrives intact
  it('preserves arbitrary modelParams passthrough (parse_reasoning, chat_template_kwargs)', async () => {
    const options = createMockOptions({
      baseURL: 'https://api.friendli.ai/serverless/v1',
      modelParams: {
        parse_reasoning: true,
        chat_template_kwargs: { foo: 'bar' },
      },
    });

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const body = result.requestBody as Record<string, unknown>;
    expect(body).toHaveProperty('parse_reasoning', true);
    expect(body).toHaveProperty('chat_template_kwargs', { foo: 'bar' });
  });
});
