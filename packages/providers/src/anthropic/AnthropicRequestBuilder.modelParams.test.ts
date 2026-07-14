/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression test for Issue #2410 (Mode 1).
 *
 * A GLM model served over the Anthropic-compatible provider (e.g. z.ai) carries
 * profile modelParams that include vendor-specific / non-Anthropic keys such as
 * `clear_thinking`. The Anthropic Messages API rejects unknown top-level body
 * keys — z.ai specifically returns 400 code 1213 "The prompt parameter was not
 * received normally". buildAnthropicRequestBody must therefore only pass
 * Anthropic-API-permitted sampling params through to the request body.
 */

import { describe, expect, it } from 'vitest';
import { buildAnthropicRequestBody } from './AnthropicRequestBuilder.js';

describe('buildAnthropicRequestBody model-param sanitization (Issue #2410)', () => {
  const baseOptions = {
    model: 'glm-5.2',
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxTokens: 1000,
    streamingEnabled: true,
  };

  it('drops non-Anthropic model params (clear_thinking) from the request body', () => {
    const body = buildAnthropicRequestBody({
      ...baseOptions,
      modelParams: {
        temperature: 1,
        clear_thinking: false,
        top_p: 0.95,
      },
    });

    // The offending vendor-specific key must NOT appear as a top-level field.
    expect('clear_thinking' in body).toBe(false);
    // Anthropic-valid sampling params are preserved.
    expect(body.temperature).toBe(1);
    expect(body.top_p).toBe(0.95);
  });

  it('preserves the full Anthropic-permitted passthrough set', () => {
    const body = buildAnthropicRequestBody({
      ...baseOptions,
      modelParams: {
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        stop_sequences: ['STOP'],
        metadata: { user_id: 'abc' },
        service_tier: 'auto',
      },
    });

    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.top_k).toBe(40);
    expect(body.stop_sequences).toStrictEqual(['STOP']);
    expect(body.metadata).toStrictEqual({ user_id: 'abc' });
    expect(body.service_tier).toBe('auto');
  });

  it('drops arbitrary unknown params and nullish values', () => {
    const body = buildAnthropicRequestBody({
      ...baseOptions,
      modelParams: {
        temperature: undefined,
        top_p: null,
        some_vendor_flag: true,
        reasoning_effort: 'high',
      },
    });

    expect('some_vendor_flag' in body).toBe(false);
    expect('reasoning_effort' in body).toBe(false);
    // Nullish passthrough params must not be spread as explicit top-level keys.
    expect('temperature' in body).toBe(false);
    expect('top_p' in body).toBe(false);
  });

  it('does not let modelParams override builder-owned fields', () => {
    const body = buildAnthropicRequestBody({
      ...baseOptions,
      modelParams: {
        model: 'attacker-model',
        max_tokens: 999999,
        stream: false,
        messages: [],
      } as unknown as Record<string, unknown>,
    });

    // Builder-owned fields are never in the passthrough set, so they keep the
    // builder's values.
    expect(body.model).toBe('glm-5.2');
    expect(body.max_tokens).toBe(1000);
    expect(body.stream).toBe(true);
    expect(body.messages).toBe(baseOptions.messages);
  });
});
