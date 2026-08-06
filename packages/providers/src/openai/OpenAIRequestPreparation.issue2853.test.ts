/**
 * @issue #2853 - prompt cache key bug again
 *
 * Behavioral regression tests proving that the OpenAI **Chat Completions**
 * transport (prepareRequest) never forwards an overlong `prompt_cache_key`
 * to the API. Subagents compose long runtime IDs (e.g.
 * `<uuid>#<subagent-name>#<8-char id>` = 69 chars) that exceed the
 * OpenAI-enforced 64-char limit, producing 400 errors.
 *
 * The Responses transport already sanitizes (issue #2135); this suite
 * closes the gap on the Chat Completions transport by exercising the
 * shared request-preparation path (`prepareRequest` →
 * `applyRequestBodyOverrides`).
 */

import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { sanitizePromptCacheKey } from '../openai-responses/sanitizePromptCacheKey.js';

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

vi.mock('../../prompt-config/subagent-delegation.js', () => ({
  shouldIncludeSubagentDelegation: vi.fn().mockResolvedValue(false),
}));

vi.mock('../utils/userMemory.js', () => ({
  resolveUserMemory: vi.fn().mockResolvedValue(''),
}));

function createMockOptions(
  overrides: Partial<NormalizedGenerateChatOptions> = {},
  modelParams: Record<string, unknown> = {},
): NormalizedGenerateChatOptions {
  const settings = new SettingsService();
  return {
    contents: [],
    tools: undefined,
    metadata: {},
    settings,
    config: undefined,
    invocation: {
      requestId: 'test-request',
      timestamp: Date.now(),
      modelBehavior: {},
      modelParams,
    },
    resolved: {
      model: 'gpt-4o',
      authToken: { token: 'test-token', type: 'api-key' },
    },
    ...overrides,
  } as unknown as NormalizedGenerateChatOptions;
}

describe('OpenAIRequestPreparation.prepareRequest prompt_cache_key sanitization (issue #2853)', () => {
  let logger: DebugLogger;

  beforeEach(() => {
    logger = new DebugLogger('llxprt:provider:openai:test');
  });

  it('clamps an overlong subagent-style prompt_cache_key to <=64 chars via modelParams', async () => {
    // Mirrors a real subagent runtimeId: <uuid>#<subagent-name>#<8-char id> (69 chars)
    const overlongKey =
      '0d4429a9-79b0-4b64-a63e-d5d7a45f1878#fallbacktypescriptcoder#a1b2c3d4';
    expect(overlongKey.length).toBe(69);

    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: overlongKey },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    const cacheKey = result.requestBody.prompt_cache_key;
    expect(cacheKey).toBeDefined();
    expect(cacheKey!.length).toBeLessThanOrEqual(64);
    // The overlong original must NOT be forwarded verbatim
    expect(cacheKey).not.toBe(overlongKey);
    // Deterministic clamp matches the shared sanitizer
    expect(cacheKey).toBe(sanitizePromptCacheKey(overlongKey));
  });

  it('passes short, valid prompt_cache_key values through unchanged', async () => {
    const shortKey = 'session-abc123';
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: shortKey },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBe(shortKey);
  });

  it('drops empty/whitespace prompt_cache_key instead of forwarding it', async () => {
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: '   ' },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBeUndefined();
  });

  it('drops non-string prompt_cache_key instead of forwarding it', async () => {
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: 12345, temperature: 0.5 },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBeUndefined();
    // Other valid params must still flow through
    expect(result.requestBody.temperature).toBe(0.5);
  });

  it('passes a 64-character prompt_cache_key through unchanged (exact boundary)', async () => {
    // The shared sanitizer has a hard cutoff at 64 chars and returns keys
    // of exactly that length unchanged. An off-by-one regression would not
    // be caught without this boundary test.
    const exactKey = 'a'.repeat(64);
    expect(exactKey.length).toBe(64);

    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: exactKey },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBe(exactKey);
  });

  it('omits prompt_cache_key from the request body when modelParams has no cache key', async () => {
    // Exercises the early-return branch when prompt_cache_key is undefined.
    // This is the most common real-world case (no modelParams supplied).
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { temperature: 0.5 },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBeUndefined();
    // Other params still flow through
    expect(result.requestBody.temperature).toBe(0.5);
  });

  it('drops null prompt_cache_key instead of forwarding it', async () => {
    // null is treated as invalid (typeof null === 'object') and dropped.
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      { prompt_cache_key: null, temperature: 0.7 },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    expect(result.requestBody.prompt_cache_key).toBeUndefined();
    expect(result.requestBody.temperature).toBe(0.7);
  });

  it('preserves other model params including provider-specific extensions (issue #2853 scope)', async () => {
    // The fix must ONLY sanitize prompt_cache_key; all other model params,
    //including canonical Chat Completions fields and provider-specific
    // extensions used by OpenAI-compatible aliases, must pass through.
    const overlongKey =
      '0d4429a9-79b0-4b64-a63e-d5d7a45f1878#fallbacktypescriptcoder#a1b2c3d4';
    const options = createMockOptions(
      {
        resolved: {
          model: 'gpt-4o',
          authToken: { token: 'test-token', type: 'api-key' },
        },
      },
      {
        prompt_cache_key: overlongKey,
        reasoning_effort: 'high',
        service_tier: 'priority',
        store: true,
        repetition_penalty: 1.1,
      },
    );

    const result = await prepareRequest(
      options,
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );

    // prompt_cache_key is sanitized
    const cacheKey = result.requestBody.prompt_cache_key;
    expect(cacheKey).toBeDefined();
    expect(cacheKey!.length).toBeLessThanOrEqual(64);

    // All other params pass through unchanged
    expect(result.requestBody).toHaveProperty('reasoning_effort', 'high');
    expect(result.requestBody).toHaveProperty('service_tier', 'priority');
    expect(result.requestBody).toHaveProperty('store', true);
    expect(result.requestBody).toHaveProperty('repetition_penalty', 1.1);
  });
});
