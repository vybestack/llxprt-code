/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-provider behavioral contracts for prompt-envelope projections
 * (issue #2817): token-count consistency, fail-fast model validation, and
 * immutability across the Anthropic and OpenAI projection functions.
 *
 * Provider-specific projection suites live in
 * promptEnvelopeProjections.anthropic.test.ts and
 * promptEnvelopeProjections.openai.test.ts.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A3, A4, A5, A9, finding #6)
 */

import { describe, it, expect } from 'bun:test';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import {
  projectAnthropicPromptEnvelope,
  projectOpenAIChatPromptEnvelope,
  projectOpenAIResponsesPromptEnvelope,
} from './promptEnvelopeProjections.js';

describe('projection token count consistency (issue #2817 A10)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'estimates separate equal %s request bodies consistently',
    async (_name, project, promptKey) => {
      const buildRequestBody = () => ({
        model: 'test-model',
        [promptKey]: [{ role: 'user', content: 'Consistent test message' }],
      });

      const first = buildRequestBody();
      const second = buildRequestBody();
      const firstTokens = await project(first).legacyEstimate();
      const secondTokens = await project(second).legacyEstimate();

      expect(firstTokens).toBe(secondTokens);
      expect(first).toStrictEqual(buildRequestBody());
      expect(second).toStrictEqual(buildRequestBody());
    },
  );

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'produces a positive %s token count for a non-empty prompt',
    async (_name, project, promptKey) => {
      const requestBody = {
        model: 'test-model',
        [promptKey]: [{ role: 'user', content: 'x' }],
      };
      const tokens = await project(requestBody).legacyEstimate();
      expect(tokens).toBeGreaterThan(0);
    },
  );

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope, 'messages'],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope, 'messages'],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope, 'input'],
  ] as const)(
    'preserves the full structural %s estimate for legacy models',
    async (_name, project, promptKey) => {
      const projection = project({
        model: 'legacy-model',
        [promptKey]: [{ role: 'user', content: 'legacy prompt' }],
      });
      const finalized = projection.finalizedProjection as {
        promptText: string;
      };

      expect(await projection.legacyEstimate()).toBe(
        estimateTokens(finalized.promptText),
      );
    },
  );
});

describe('projection fail-fast: model must be non-empty string (finding #4)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is absent', (_name, project) => {
    expect(() =>
      project({ messages: [{ role: 'user', content: 'Hello' }] }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is an empty string', (_name, project) => {
    expect(() =>
      project({
        model: '',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is whitespace-only', (_name, project) => {
    expect(() =>
      project({
        model: '   ',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s throws when model is a non-string type', (_name, project) => {
    expect(() =>
      project({
        model: 42,
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/model/i);
  });

  it('includes the protocol and method in the error message for diagnosis', () => {
    expect(() =>
      projectOpenAIResponsesPromptEnvelope({
        model: '',
        input: [{ role: 'user', content: 'Hello' }],
      }),
    ).toThrow(/openai-responses.*responses\/v1/i);
  });
});

describe('projection immutability (issue #2817)', () => {
  it.each([
    ['Anthropic', projectAnthropicPromptEnvelope],
    ['OpenAI Chat', projectOpenAIChatPromptEnvelope],
    ['OpenAI Responses', projectOpenAIResponsesPromptEnvelope],
  ] as const)('%s returns a frozen projection', (_name, project) => {
    const projection = project({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    // The contract declares every member readonly; a projection cached or
    // replayed across retries must not be mutable out from under a later
    // estimate.
    expect(Object.isFrozen(projection)).toBe(true);
    expect(() => {
      (projection as { model: string }).model = 'tampered';
    }).toThrow(TypeError);
    expect(projection.model).toBe('gpt-4o');
  });
});
