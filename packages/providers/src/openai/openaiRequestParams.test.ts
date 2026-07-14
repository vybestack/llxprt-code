import { describe, it, expect } from 'vitest';
import { filterOpenAIRequestParams } from './openaiRequestParams.js';
import { MAX_PROMPT_CACHE_KEY_LENGTH } from '../openai-responses/sanitizePromptCacheKey.js';

describe('filterOpenAIRequestParams', () => {
  it('keeps supported OpenAI parameters and normalizes aliases', () => {
    const filtered = filterOpenAIRequestParams({
      temperature: 0.5,
      'max-tokens': 2048,
      responseFormat: { type: 'json_schema' },
      stop: ['END'],
    });

    expect(filtered).toStrictEqual({
      temperature: 0.5,
      max_tokens: 2048,
      response_format: { type: 'json_schema' },
      stop: ['END'],
    });
  });

  it('drops CLI-only or unrelated ephemeral settings', () => {
    const filtered = filterOpenAIRequestParams({
      'context-limit': 190000,
      'shell-replacement': true,
      'custom-headers': { 'X-Test': '1' },
      user: 'tester',
    });

    expect(filtered).toStrictEqual({
      user: 'tester',
    });
  });

  it('drops internal reasoning settings nested under reasoning', () => {
    const filtered = filterOpenAIRequestParams({
      temperature: 0.7,
      reasoning: {
        effort: 'xhigh',
        enabled: true,
        includeInContext: true,
        includeInResponse: false,
        format: 'field',
        stripFromContext: 'none',
      },
    });

    expect(filtered).toStrictEqual({
      temperature: 0.7,
      reasoning: {
        effort: 'xhigh',
      },
    });
  });

  it('passes short prompt_cache_key values through unchanged', () => {
    const filtered = filterOpenAIRequestParams({
      prompt_cache_key: 'session-abc123',
    });

    expect(filtered).toStrictEqual({
      prompt_cache_key: 'session-abc123',
    });
  });

  it('clamps prompt_cache_key values longer than 64 chars (issue #2135)', () => {
    // Mirrors a real subagent runtimeId: <uuid>#<subagent-name>#<8-char id>
    const overlongKey =
      '0d4429a9-79b0-4b64-a63e-d5d7a45f1878#fallbacktypescriptcoder#a1b2c3d4';
    expect(overlongKey.length).toBeGreaterThan(MAX_PROMPT_CACHE_KEY_LENGTH);

    const filtered = filterOpenAIRequestParams({
      prompt_cache_key: overlongKey,
    });

    const clamped = filtered?.prompt_cache_key as string;
    expect(clamped.length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY_LENGTH);
    expect(clamped.startsWith('rk:')).toBe(true);

    // Deterministic: the same overlong key maps to the same clamped key
    const filteredAgain = filterOpenAIRequestParams({
      prompt_cache_key: overlongKey,
    });
    expect(filteredAgain?.prompt_cache_key).toBe(clamped);
  });

  it('still drops empty prompt_cache_key values', () => {
    const filtered = filterOpenAIRequestParams({
      prompt_cache_key: '   ',
    });

    expect(filtered).toBeUndefined();
  });

  it('drops non-string prompt_cache_key values instead of forwarding them', () => {
    const filtered = filterOpenAIRequestParams({
      prompt_cache_key: 12345,
      temperature: 0.5,
    });

    expect(filtered).toStrictEqual({ temperature: 0.5 });
  });
});
