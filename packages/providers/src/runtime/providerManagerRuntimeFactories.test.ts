/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  Config,
  RuntimeContentGeneratorFactory,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import type { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '../composition/index.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { ModelPromptEstimatorError } from '../tokenizers/ModelPromptEstimatorError.js';
import {
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
} from '../tokenizers/claude/claudeCalibrationAssets.js';
import type { TiktokenModuleLoader } from '../tokenizers/o200kBaseCounter.js';
import {
  activateIsolatedRuntimeContext,
  createIsolatedRuntimeContext,
} from './runtimeSettings.js';

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => new Error('expected the operation to reject'),
    (error: unknown) => error,
  );
}

interface ConfigWithRuntimeFactories extends Config {
  getContentGeneratorFactory():
    | RuntimeContentGeneratorFactory<ProviderContentGenerator>
    | undefined;
  getTokenizerFactory(): RuntimeTokenizerFactory | undefined;
}

type PrepareTokenizer = NonNullable<
  RuntimeTokenizerFactory['prepareTokenizer']
>;

function requirePrepareTokenizer(
  factory: RuntimeTokenizerFactory,
): PrepareTokenizer {
  const prepareTokenizer = factory.prepareTokenizer;
  if (prepareTokenizer === undefined) {
    throw new Error('runtime tokenizer factory has no readiness operation');
  }
  return prepareTokenizer;
}

function requireError(error: unknown): Error {
  if (!(error instanceof Error)) {
    throw new Error('expected preparation to reject with an Error');
  }
  return error;
}

function createEncodeFailingLoader(encodeFailure: Error): TiktokenModuleLoader {
  return async () => {
    const tiktoken = await import('@dqbd/tiktoken');
    return {
      ...tiktoken,
      get_encoding: (...args: Parameters<typeof tiktoken.get_encoding>) =>
        new Proxy(tiktoken.get_encoding(...args), {
          get(target, property, receiver) {
            if (property === 'encode') {
              return (): never => {
                throw encodeFailure;
              };
            }
            return Reflect.get(target, property, receiver);
          },
        }),
    };
  };
}

describe('configureProviderRuntimeFactories', () => {
  /**
   * @plan:PLAN-20260603-ISSUE1584.P16a
   * @requirement:REQ-DEP-001
   */
  it('injects providers-backed content generator and tokenizer factories into CLI config', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-runtime-factory-injection',
      workspaceDir: process.cwd(),
      model: 'gpt-4.1',
      metadata: { source: 'issue1584-p16a' },
      prepare: async () => {},
    });

    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'issue1584-p16a' },
    });

    const config = runtimeHandle.config as ConfigWithRuntimeFactories;
    const manager = runtimeHandle.providerManager;

    configureProviderRuntimeFactories(config, manager);

    const contentGeneratorFactory = config.getContentGeneratorFactory();
    const tokenizerFactory = config.getTokenizerFactory();

    expect(contentGeneratorFactory).toBeDefined();
    expect(tokenizerFactory).toBeDefined();
    expect(
      contentGeneratorFactory?.createContentGenerator(manager),
    ).toBeInstanceOf(ProviderContentGenerator);
    expect(tokenizerFactory?.getTokenizer('openai', 'gpt-4.1')).toBeDefined();
    expect(
      tokenizerFactory?.getTokenizer('anthropic', 'claude-3-5-sonnet'),
    ).toBeDefined();
  });

  function buildClaudeEstimateRequest(
    canonicalModel: string,
    activeProvider = 'claudecode',
  ): RuntimePromptEstimateRequest {
    return {
      activeProvider,
      canonicalModel,
      protocol: 'anthropic-messages',
      wireMethod: 'messages/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'anthropic-messages',
        promptText: JSON.stringify({
          system: 'You are helpful.',
          messages: [{ role: 'user', content: 'Explain tokenization.' }],
        }),
      },
      projectionRevision: 3,
      legacyEstimate: () => Promise.resolve(1234),
    };
  }

  /**
   * The Claude 5 registrations are only useful if the composition root
   * actually installs them, so this asserts through the composed factory
   * rather than through a locally built registry.
   */
  it('composes a separately calibrated estimator for each Claude 5 model', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-runtime-factory-claude5',
      workspaceDir: process.cwd(),
      model: 'claude-opus-5',
      metadata: { source: 'issue2835' },
      prepare: async () => {},
    });
    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
      metadata: { source: 'issue2835' },
    });
    const config = runtimeHandle.config as ConfigWithRuntimeFactories;
    configureProviderRuntimeFactories(config, runtimeHandle.providerManager);
    const tokenizerFactory = config.getTokenizerFactory();
    expect(tokenizerFactory).toBeDefined();

    expect(tokenizerFactory?.claimsModel?.('claude-opus-5')).toBe(true);
    expect(tokenizerFactory?.getEstimatorFamily?.('claude-opus-5')).toBe(
      'anthropic-claude-opus-5',
    );
    expect(tokenizerFactory?.claimsModel?.('claude-fable-5')).toBe(true);
    expect(tokenizerFactory?.getEstimatorFamily?.('claude-fable-5')).toBe(
      'anthropic-claude-fable-5',
    );

    const opus = await tokenizerFactory!.estimatePrompt(
      buildClaudeEstimateRequest('claude-opus-5', 'anthropic'),
    );
    expect(opus.family).toBe('anthropic-claude-opus-5');
    expect(opus.method).toBe('calibrated');
    expect(opus.count).toBeGreaterThan(0);

    const fable = await tokenizerFactory!.estimatePrompt(
      buildClaudeEstimateRequest('claude-fable-5', 'anthropic'),
    );
    expect(fable.family).toBe('anthropic-claude-fable-5');
    expect(fable.method).toBe('calibrated');
    expect(fable.estimatorVersion).not.toBe(opus.estimatorVersion);

    const proxied = await tokenizerFactory!.estimatePrompt(
      buildClaudeEstimateRequest('claude-opus-5', 'zai'),
    );
    expect(proxied.family).toBe('legacy-unregistered');
  });

  /**
   * Issue #3485: a point release such as claude-fable-5-1 must inherit its
   * family calibration instead of throwing an unresolved-identity error on
   * the request path. This exercises the runtime tokenizer factory directly.
   */
  it('estimates a Claude 5 point release with the family calibration', async () => {
    const factory = createRuntimeTokenizerFactory();
    const result = await factory.estimatePrompt(
      buildClaudeEstimateRequest('claude-fable-5-1'),
    );

    expect(result.family).toBe(CLAUDE_FABLE_5_ESTIMATOR_FAMILY);
    expect(result.family).not.toBe('legacy-unresolved-identity');
    expect(result.method).toBe('calibrated');
    expect(result.estimatorVersion).toBe(
      CLAUDE_FABLE_5_CALIBRATION.estimatorVersion,
    );
    expect(result.count).toBeGreaterThan(0);
  });

  it('preserves an explicitly injected tokenizer factory as the authoritative runtime factory', async () => {
    const runtimeHandle = createIsolatedRuntimeContext({
      runtimeId: 'provider-runtime-injected-tokenizer-factory',
      workspaceDir: process.cwd(),
      model: 'gpt-5.6-sol',
      prepare: async () => {},
    });
    await activateIsolatedRuntimeContext(runtimeHandle, {
      runtimeId: runtimeHandle.runtimeId,
    });
    const config = runtimeHandle.config as ConfigWithRuntimeFactories;
    const injectedFactory = createRuntimeTokenizerFactory();
    config.setTokenizerFactory(injectedFactory);

    try {
      configureProviderRuntimeFactories(config, runtimeHandle.providerManager);

      expect(config.getTokenizerFactory()).toBe(injectedFactory);
    } finally {
      await runtimeHandle.cleanup();
    }
  });

  it('prepares sanctioned GPT-5.6 readiness before exact runtime tokenization', async () => {
    const factory = createRuntimeTokenizerFactory();
    expect(factory.prepareTokenizer).toBeDefined();

    await factory.prepareTokenizer?.('codex-alias', 'gpt-5.6-sol');
    const tokenizer = factory.getTokenizer('codex-alias', 'gpt-5.6-sol');

    expect(
      await tokenizer?.countTokens(
        'The quick brown fox jumps over the lazy dog.',
      ),
    ).toBe(10);
  });

  it('does not load the GPT-5.6 encoder while preparing another model', async () => {
    const loaderFailure = new Error('GPT codec loader must remain unused');
    const factory = createRuntimeTokenizerFactory(() =>
      Promise.reject(loaderFailure),
    );
    expect(factory.prepareTokenizer).toBeDefined();

    await expect(
      factory.prepareTokenizer?.('openai', 'gpt-4.1'),
    ).resolves.toBeUndefined();
  });

  it('shares one cold injected initialization across concurrent readiness and later tokenization', async () => {
    let releaseLoader = (): void => {
      throw new Error('loader gate initialized without a resolver');
    };
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });
    let loadCount = 0;
    const loadModule: TiktokenModuleLoader = async () => {
      loadCount += 1;
      await loaderGate;
      return import('@dqbd/tiktoken');
    };
    const factory = createRuntimeTokenizerFactory(loadModule);
    const prepareTokenizer = requirePrepareTokenizer(factory);

    const readiness = Promise.all([
      prepareTokenizer('codex-a', 'gpt-5.6-sol'),
      prepareTokenizer('codex-b', 'gpt-5.6-terra-latest'),
    ]);
    await Promise.resolve();
    const coldLoadCount = loadCount;
    releaseLoader();
    await readiness;

    const first = factory.getTokenizer('codex-a', 'gpt-5.6-sol');
    const second = factory.getTokenizer('codex-b', 'gpt-5.6-terra-latest');
    expect(
      await Promise.all([
        first?.countTokens('The quick brown fox jumps over the lazy dog.'),
        second?.countTokens('The quick brown fox jumps over the lazy dog.'),
      ]),
    ).toStrictEqual([10, 10]);
    expect(coldLoadCount).toBe(1);
    expect(loadCount).toBe(1);
  });

  it('shares one cold injected encoder across concurrent readiness, runtime counting, and final estimation', async () => {
    // A count distinct from the real o200k_base BPE count of the probe
    // ("The quick brown fox jumps over the lazy dog." => 10) so the assertion
    // catches any estimator that bypasses the injected encoder.
    const injectedCount = 23;
    let releaseLoader = (): void => {
      throw new Error('loader gate initialized without a resolver');
    };
    const loaderGate = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });
    let loadCount = 0;
    const loadModule: TiktokenModuleLoader = async () => {
      loadCount += 1;
      await loaderGate;
      return {
        get_encoding: () => ({
          encode: () =>
            Array.from({ length: injectedCount }, (_unused, index) => index),
        }),
      } as unknown as Awaited<ReturnType<TiktokenModuleLoader>>;
    };
    const factory = createRuntimeTokenizerFactory(loadModule);
    const prepareTokenizer = requirePrepareTokenizer(factory);
    const estimateRequest = {
      activeProvider: 'codex-a',
      canonicalModel: 'gpt-5.6-sol',
      protocol: 'openai-responses' as const,
      wireMethod: 'responses/v1' as const,
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3' as const,
        protocol: 'openai-responses' as const,
        promptText: 'The quick brown fox jumps over the lazy dog.',
      },
      projectionRevision: 3,
      legacyEstimate: () => Promise.resolve(999),
    };

    const readiness = Promise.all([
      prepareTokenizer('codex-a', 'gpt-5.6-sol'),
      prepareTokenizer('codex-b', 'gpt-5.6-terra-latest'),
    ]);
    const runtimeCount = factory
      .getTokenizer('codex-a', 'gpt-5.6-sol')
      ?.countTokens('The quick brown fox jumps over the lazy dog.');
    const finalEstimate = factory.estimatePrompt(estimateRequest);
    await Promise.resolve();
    const coldLoadCount = loadCount;
    releaseLoader();
    await readiness;

    expect(coldLoadCount).toBe(1);
    expect(await runtimeCount).toBe(injectedCount);
    const result = await finalEstimate;
    expect(result).toMatchObject({
      count: injectedCount,
      method: 'exact',
      family: 'openai-gpt-5.6',
    });
    expect(result.estimatorVersion).toBe('gpt-5.6-o200k-v1');
    expect(loadCount).toBe(1);
  });

  it('reports preparation failure with estimator context and causal details', async () => {
    const loaderFailure = new Error('relocated codec initialization exploded');
    const factory = createRuntimeTokenizerFactory(() =>
      Promise.reject(loaderFailure),
    );
    expect(factory.prepareTokenizer).toBeDefined();

    const prepareTokenizer = requirePrepareTokenizer(factory);
    const error = await captureRejection(
      prepareTokenizer('codex-alias', 'gpt-5.6-sol'),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'asset-unavailable',
      context: {
        activeProvider: 'codex-alias',
        canonicalModel: 'gpt-5.6-sol',
        protocol: 'openai-responses',
        family: 'openai-gpt-5.6',
      },
      cause: loaderFailure,
    });
    const rejection = requireError(error);
    expect(rejection.message).toContain(
      'relocated codec initialization exploded',
    );
  });

  it('reports readiness probe encode failure with exact context and cause identity', async () => {
    const encodeFailure = new Error('readiness probe encode exploded');
    const loadModule = createEncodeFailingLoader(encodeFailure);
    const factory = createRuntimeTokenizerFactory(loadModule);

    const prepareTokenizer = requirePrepareTokenizer(factory);
    const error = await captureRejection(
      prepareTokenizer('codex-alias', 'gpt-5.6-sol'),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'tokenization-failed',
      context: {
        activeProvider: 'codex-alias',
        canonicalModel: 'gpt-5.6-sol',
        protocol: 'openai-responses',
        family: 'openai-gpt-5.6',
      },
      cause: encodeFailure,
    });
    const rejection = requireError(error);
    expect(rejection.message).toContain('readiness probe encode exploded');
  });
});
