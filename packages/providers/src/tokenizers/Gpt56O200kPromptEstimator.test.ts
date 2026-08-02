/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { deepStrictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { get_encoding } from '@dqbd/tiktoken';
import {
  createGpt56RuntimeTokenizer,
  estimateGpt56Prompt,
  GPT_56_ASSET_REVISION,
  GPT_56_ESTIMATOR_FAMILY,
} from './Gpt56O200kPromptEstimator.js';
import { ModelPromptEstimatorRegistry } from './ModelPromptEstimatorRegistry.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';

interface Fixture {
  readonly name: string;
  readonly text?: string;
  readonly repeat?: { readonly text: string; readonly count: number };
  readonly count: number;
  readonly tokens?: readonly number[];
}

const fixtureFile = JSON.parse(
  readFileSync(
    new URL('./fixtures/o200k-base-v1.json', import.meta.url),
    'utf8',
  ),
) as { readonly fixtures: readonly Fixture[] };

function fixtureText(fixture: Fixture): string {
  return fixture.text ?? fixture.repeat!.text.repeat(fixture.repeat!.count);
}

function request(model = 'gpt-5.6-sol') {
  return requestForProtocol(model, 'openai-responses', 'responses/v1');
}

function requestForProtocol(
  model: string,
  protocol: 'openai-responses' | 'openai-chat' | 'anthropic-messages',
  wireMethod: 'responses/v1' | 'chat/completions/v1' | 'messages/v1',
) {
  return {
    activeProvider: 'codex-alias',
    canonicalModel: model,
    protocol,
    wireMethod,
    finalizedProjection: {
      kind: 'llxprt-provider-prompt-v3',
      protocol,
      promptText: 'The quick brown fox jumps over the lazy dog.',
    },
    projectionRevision: 3,
    legacyEstimate: vi.fn(() => Promise.resolve(999)),
  };
}

describe('GPT-5.6 o200k fixtures', () => {
  it.each(fixtureFile.fixtures)(
    '$name',
    async (fixture) => {
      const text = fixtureText(fixture);
      const encoder = get_encoding('o200k_base');
      try {
        const tokens = [...encoder.encode(text, [], [])];
        expect(tokens).toHaveLength(fixture.count);
        if (fixture.tokens !== undefined) {
          deepStrictEqual(tokens, fixture.tokens);
        }
      } finally {
        encoder.free();
      }
    },
    40_000,
  );

  it('returns pinned exact provenance without invoking legacy estimation', async () => {
    const input = request();
    const result = await estimateGpt56Prompt(input);
    expect(result).toMatchObject({
      count: 10,
      method: 'exact',
      family: GPT_56_ESTIMATOR_FAMILY,
      assetRevision: GPT_56_ASSET_REVISION,
      projectionRevision: 3,
    });
    expect(input.legacyEstimate).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', new Error('Missing tiktoken_bg.wasm')],
    ['corrupt', new WebAssembly.CompileError('invalid wasm header')],
  ])(
    'maps isolated %s codec initialization failures to asset-unavailable',
    async (_name, failure) => {
      const loadModule = () => Promise.reject(failure);
      await expect(
        estimateGpt56Prompt(request(), loadModule),
      ).rejects.toMatchObject({
        code: 'asset-unavailable',
        cause: failure,
      });
    },
  );

  it('maps encoder failures to tokenization-failed without exposing prompt text', async () => {
    const secret = 'do not serialize this prompt';
    const input = request();
    input.finalizedProjection = {
      kind: 'llxprt-provider-prompt-v3',
      protocol: 'openai-responses',
      promptText: secret,
    };
    const loadModule = () =>
      Promise.resolve({
        get_encoding: () => ({
          encode: () => {
            throw new Error('encode failed');
          },
        }),
      } as unknown as Awaited<
        ReturnType<
          import('./Gpt56O200kPromptEstimator.js').TiktokenModuleLoader
        >
      >);

    const error = await estimateGpt56Prompt(input, loadModule).catch(
      (cause) => cause,
    );
    expect(error).toMatchObject({ code: 'tokenization-failed' });
    expect(JSON.stringify(error)).not.toContain(secret);
  });
});
describe('GPT-5.6 runtime tokenizer input normalization', () => {
  const tokenizer = createGpt56RuntimeTokenizer('codex-alias', 'gpt-5.6-sol');

  it('counts structured serializable input exactly', async () => {
    await expect(tokenizer.countTokens({ value: 'hello' })).resolves.toBe(5);
  });

  it.each([
    ['undefined', undefined],
    ['BigInt', { value: 1n }],
    [
      'cyclic input',
      (() => {
        const value: { self?: unknown } = {};
        value.self = value;
        return value;
      })(),
    ],
  ])('rejects %s with a typed failure', async (_name, value) => {
    await expect(tokenizer.countTokens(value)).rejects.toMatchObject({
      code: 'tokenization-failed',
    });
  });
});

describe('ModelPromptEstimatorRegistry', () => {
  const registry = new ModelPromptEstimatorRegistry();

  it.each([
    'gpt-5.6',
    'gpt-5.6-latest',
    'gpt-5.6-20260115',
    'gpt-5.6-2026-01-15',
    'gpt-5.6-sol',
    'gpt-5.6-terra-latest',
    'gpt-5.6-luna-2026-01-15',
  ])(
    'registers sanctioned identity %s independently of provider name',
    async (model) => {
      const result = await registry.estimatePrompt(request(model));
      expect(result.method).toBe('exact');
    },
  );

  it('uses the explicit legacy path for unregistered families', async () => {
    const input = request('gpt-4.1');
    const result = await registry.estimatePrompt(input);
    expect(result).toMatchObject({
      count: 999,
      method: 'calibrated',
      family: 'legacy-unregistered',
    });
    expect(input.legacyEstimate).toHaveBeenCalledOnce();
  });

  it.each([
    'gpt-5.6-mini',
    'gpt-5.6-solar',
    'gpt-5.6-2026-02-30',
    'gpt-05.06',
    'gpt-5.06',
  ])(
    'rejects claimed malformed identity %s without legacy fallback',
    async (model) => {
      const input = request(model);
      await expect(registry.estimatePrompt(input)).rejects.toMatchObject({
        code: 'unresolved-model-identity',
      });
      expect(input.legacyEstimate).not.toHaveBeenCalled();
    },
  );

  it('rejects a registered model on an unsupported protocol', async () => {
    const input = requestForProtocol(
      'gpt-5.6',
      'anthropic-messages',
      'messages/v1',
    );
    await expect(registry.estimatePrompt(input)).rejects.toMatchObject({
      code: 'unsupported-protocol',
    });
    expect(input.legacyEstimate).not.toHaveBeenCalled();
  });

  it('returns typed errors without serializing prompt text', async () => {
    const input = request();
    input.finalizedProjection = Object.freeze({ invalid: 'secret prompt' });
    const error = await registry.estimatePrompt(input).catch((cause) => cause);
    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(JSON.stringify(error)).not.toContain('secret prompt');
    expect(input.legacyEstimate).not.toHaveBeenCalled();
  });
});
