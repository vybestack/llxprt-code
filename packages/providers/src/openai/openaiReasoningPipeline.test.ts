/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @issue #2896 - End-to-end coverage across the seam that the per-layer tests
 * cannot see: real `SettingsService` writes -> `buildEphemeralsSnapshot` ->
 * `separateSettings` (inside `createRuntimeInvocationContext`) -> the outbound
 * Chat Completions body built by `prepareRequest`.
 *
 * The reported bug lived exactly here: `reasoning.effort` set as an ephemeral
 * was re-materialized as an OpenRouter-dialect `reasoning` model param while
 * the request builder separately injected the z.ai-dialect `thinking` field,
 * so a single user intent produced two foreign dialects on the wire.
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import { REASONING_WIRE_KEYS } from './openaiReasoningDialect.js';
import { buildEphemeralsSnapshot } from '../runtimeNormalizer.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

void vi.mock(
  '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js',
  () => ({
    shouldIncludeSubagentDelegation: vi.fn().mockResolvedValue(false),
  }),
);

void vi.mock('../utils/userMemory.js', () => ({
  resolveUserMemory: vi.fn().mockResolvedValue(''),
}));

const PROVIDER = 'openai';

/**
 * Drive the real settings pipeline: write settings exactly the way `/set` and
 * profile application do, then build the invocation context the provider sees.
 */
function optionsFrom(
  settings: SettingsService,
  baseURL: string | undefined,
): NormalizedGenerateChatOptions {
  const invocation = createRuntimeInvocationContext({
    runtime: { settingsService: settings, runtimeId: 'test-runtime' },
    settings,
    providerName: PROVIDER,
    ephemeralsSnapshot: buildEphemeralsSnapshot(settings, PROVIDER),
  });
  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    config: undefined,
    invocation,
    resolved: {
      model: 'zai-org/GLM-5.2',
      baseURL,
      authToken: 'test-token',
    },
  } satisfies NormalizedGenerateChatOptions;
}

async function bodyFor(
  settings: SettingsService,
  baseURL: string | undefined,
): Promise<Record<string, unknown>> {
  const result = await prepareRequest(
    optionsFrom(settings, baseURL),
    'gpt-4o',
    undefined,
    new DebugLogger('llxprt:provider:openai:test'),
    PROVIDER,
  );
  // Spread rather than cast: the body is a plain object, and this keeps the
  // file free of type escapes so `satisfies` above does real checking.
  return { ...result.requestBody };
}

function reasoningKeysIn(body: Record<string, unknown>): string[] {
  return REASONING_WIRE_KEYS.filter((k) => k in body);
}

describe('issue #2896 settings-to-request pipeline', () => {
  let settings: SettingsService;

  beforeEach(() => {
    settings = new SettingsService();
  });

  describe('neutral reasoning ephemerals (the reported profile)', () => {
    beforeEach(() => {
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.effort', 'high');
    });

    it('sends nothing to Friendli', async () => {
      const body = await bodyFor(
        settings,
        'https://api.friendli.ai/serverless/v1',
      );
      expect(reasoningKeysIn(body)).toStrictEqual([]);
    });

    it('sends nothing to Crusoe', async () => {
      const body = await bodyFor(
        settings,
        'https://api.inference.crusoecloud.com/v1/',
      );
      expect(reasoningKeysIn(body)).toStrictEqual([]);
    });

    it('sends only the OpenRouter dialect to OpenRouter', async () => {
      const body = await bodyFor(settings, 'https://openrouter.ai/api/v1');
      expect(reasoningKeysIn(body)).toStrictEqual(['reasoning']);
      expect(body['reasoning']).toStrictEqual({ effort: 'high' });
    });

    it('sends the coordinated thinking and effort fields to z.ai', async () => {
      const body = await bodyFor(settings, 'https://api.z.ai/api/paas/v4');
      expect(reasoningKeysIn(body)).toStrictEqual([
        'thinking',
        'reasoning_effort',
      ]);
      expect({
        thinking: body['thinking'],
        reasoningEffort: body['reasoning_effort'],
      }).toStrictEqual({
        thinking: { type: 'enabled' },
        reasoningEffort: 'high',
      });
    });
  });

  describe('explicit model params survive the pipeline and win', () => {
    it('keeps an explicit parse_reasoning as the only representation on z.ai', async () => {
      settings.set('reasoning.enabled', true);
      settings.set('reasoning.effort', 'high');
      settings.setProviderSetting(PROVIDER, 'parse_reasoning', true);

      const body = await bodyFor(settings, 'https://api.z.ai/api/paas/v4');
      expect(reasoningKeysIn(body)).toStrictEqual(['parse_reasoning']);
      expect(body['parse_reasoning']).toBe(true);
    });

    it('keeps an explicit reasoning object intact, including its effort', async () => {
      settings.setProviderSetting(PROVIDER, 'reasoning', {
        effort: 'max',
        exclude: true,
      });

      const body = await bodyFor(settings, 'https://openrouter.ai/api/v1');
      expect(reasoningKeysIn(body)).toStrictEqual(['reasoning']);
      expect(body['reasoning']).toStrictEqual({
        effort: 'max',
        exclude: true,
      });
      // The nested members must not also surface as literal dotted body keys.
      expect(
        Object.keys(body).filter((k) => k.startsWith('reasoning.')),
      ).toStrictEqual([]);
    });

    it('lets an explicit thinking value override the host dialect', async () => {
      settings.set('reasoning.enabled', true);
      settings.setProviderSetting(PROVIDER, 'thinking', { type: 'disabled' });

      const body = await bodyFor(settings, 'https://api.z.ai/api/paas/v4');
      expect(reasoningKeysIn(body)).toStrictEqual(['thinking']);
      expect(body['thinking']).toStrictEqual({ type: 'disabled' });
    });
  });

  it('turning reasoning off never requests reasoning on OpenRouter', async () => {
    settings.set('reasoning.effort', 'high');
    settings.set('reasoning.enabled', false);

    const body = await bodyFor(settings, 'https://openrouter.ai/api/v1');
    expect(reasoningKeysIn(body)).toStrictEqual(['reasoning']);
    expect(body['reasoning']).toStrictEqual({ enabled: false });
  });

  it('repairs a legacy string-typed numeric model param at egress', async () => {
    settings.setProviderSetting(PROVIDER, 'top_p', '.95');

    const body = await bodyFor(
      settings,
      'https://api.friendli.ai/serverless/v1',
    );
    expect(body['top_p']).toBe(0.95);
    expect(typeof body['top_p']).toBe('number');
  });

  it('leaves a non-numeric model param untouched rather than dropping it', async () => {
    settings.setProviderSetting(PROVIDER, 'top_p', 'abc');

    const body = await bodyFor(
      settings,
      'https://api.friendli.ai/serverless/v1',
    );
    expect(body['top_p']).toBe('abc');
  });
});
