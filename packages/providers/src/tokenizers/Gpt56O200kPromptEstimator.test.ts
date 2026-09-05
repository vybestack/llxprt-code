/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'bun:test';
import { get_encoding } from '@dqbd/tiktoken';
import {
  createGpt56RuntimeTokenizer,
  estimateGpt56Prompt,
  GPT_56_ASSET_REVISION,
  GPT_56_ESTIMATOR_FAMILY,
} from './Gpt56O200kPromptEstimator.js';
import {
  ModelPromptEstimatorRegistry,
  createDefaultEstimatorRegistrations,
  GPT_56_PROMPT_ESTIMATOR_REGISTRATION,
  type ModelPromptEstimatorRegistration,
} from './ModelPromptEstimatorRegistry.js';
import { ModelPromptEstimatorError } from './ModelPromptEstimatorError.js';
import type { O200kBaseEncoder } from './o200kBaseCounter.js';
import type { PromptEnvelopeProtocol } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

/**
 * Runs `operation` expecting rejection and returns the rejection reason.
 * Fails closed by throwing if the operation fulfills, so tests cannot pass
 * silently when the promise resolves with an Error-shaped value.
 */
const NOT_REJECTED = Symbol('not-rejected');

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  const outcome: unknown = await operation.then(
    () => NOT_REJECTED,
    (error: unknown) => error,
  );
  if (outcome === NOT_REJECTED) {
    throw new Error('expected the operation to reject');
  }
  return outcome;
}

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

interface FixtureTokenEstimationObservation {
  readonly count: number;
  readonly pinnedTokens: readonly number[] | undefined;
}

function observeFixtureTokenEstimation(
  fixture: Fixture,
): FixtureTokenEstimationObservation {
  const encoder = get_encoding('o200k_base');
  try {
    const tokens = [...encoder.encode(fixtureText(fixture), [], [])];
    return {
      count: tokens.length,
      pinnedTokens: fixture.tokens === undefined ? undefined : tokens,
    };
  } finally {
    encoder.free();
  }
}

describe('GPT-5.6 o200k fixtures', () => {
  it.each(fixtureFile.fixtures)(
    '$name',
    async (fixture) => {
      const observation = observeFixtureTokenEstimation(fixture);
      expect(observation.count).toBe(fixture.count);
      expect(observation.pinnedTokens).toStrictEqual(fixture.tokens);
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
    'maps isolated %s codec initialization failures to asset-unavailable with causal detail in the remediation message',
    async (_name, failure) => {
      const loadModule = () => Promise.reject(failure);
      const error = await captureRejection(
        estimateGpt56Prompt(request(), loadModule),
      );
      expect(error).toMatchObject({
        code: 'asset-unavailable',
        cause: failure,
      });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(failure.message);
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
    expect(await tokenizer.countTokens({ value: 'hello' })).toBe(5);
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
    expect(await captureRejection(tokenizer.countTokens(value))).toMatchObject({
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
    expect(input.legacyEstimate).toHaveBeenCalledTimes(1);
  });

  it.each([
    'gpt-5.6-mini',
    'gpt-5.6-solar',
    'gpt-5.6-2026-02-30',
    'gpt-05.06',
    'gpt-5.06',
  ])(
    'falls back to the legacy estimate for claimed malformed identity %s',
    async (model) => {
      const input = request(model);
      const result = await registry.estimatePrompt(input);
      expect(result).toMatchObject({
        count: 999,
        method: 'calibrated',
        family: 'legacy-unresolved-identity',
        estimatorVersion: 'core-estimate-tokens-v1',
        assetRevision: 'none',
        projectionRevision: 3,
      });
      expect(input.legacyEstimate).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a registered model on an unsupported protocol', async () => {
    const input = requestForProtocol(
      'gpt-5.6',
      'anthropic-messages',
      'messages/v1',
    );
    expect(
      await captureRejection(registry.estimatePrompt(input)),
    ).toMatchObject({
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

describe('createDefaultEstimatorRegistrations', () => {
  const injectedCount = 42;

  function resolveInjectedEncoder(): Promise<O200kBaseEncoder> {
    return Promise.resolve({
      encode: () =>
        Array.from({ length: injectedCount }, (_unused, index) => index),
    } as unknown as O200kBaseEncoder);
  }

  it('replaces the GPT-5.6 default registration with a resolver-bound estimator that counts through the injected encoder', async () => {
    const registrations = createDefaultEstimatorRegistrations(
      resolveInjectedEncoder,
    );
    const gpt56 = registrations.filter(
      (registration) => registration.family === GPT_56_ESTIMATOR_FAMILY,
    );
    expect(gpt56).toHaveLength(1);
    const result = await gpt56[0].estimate(request());
    expect(result.count).toBe(injectedCount);
  });

  it('retains an additional non-GPT-5.6 default registration from the input list without duplicating GPT-5.6', () => {
    const extraFamily = 'test-extra-default-family';
    const extra: ModelPromptEstimatorRegistration = {
      family: extraFamily,
      claim: /^test-extra-default/,
      matches: (model: string) => model.startsWith('test-extra-default'),
      protocols: new Set<PromptEnvelopeProtocol>(['openai-responses']),
      estimate: async (estimateRequest) => ({
        count: await estimateRequest.legacyEstimate(),
        method: 'calibrated',
        family: extraFamily,
        estimatorVersion: 'test-extra-v1',
        assetRevision: 'none',
        projectionRevision: estimateRequest.projectionRevision,
      }),
    };
    const registrations = createDefaultEstimatorRegistrations(
      resolveInjectedEncoder,
      [GPT_56_PROMPT_ESTIMATOR_REGISTRATION, extra],
    );
    expect(registrations).toHaveLength(2);
    // The extra non-GPT-5.6 registration is retained by identity.
    expect(registrations).toContain(extra);
    // Exactly one GPT-5.6 entry — never duplicated.
    const gpt56Count = registrations.filter(
      (registration) => registration.family === GPT_56_ESTIMATOR_FAMILY,
    ).length;
    expect(gpt56Count).toBe(1);
  });
});
