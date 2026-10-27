import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from './helpers/provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { RuntimePromptEstimateRequest } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { ProviderContentGenerator } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { ModelPromptEstimatorError } from '@vybestack/llxprt-code-providers/tokenizers/ModelPromptEstimatorError.js';
import { PROJECTION_REVISION } from '@vybestack/llxprt-code-providers/runtime/promptEnvelopeProjections.js';
import { GPT_56_ESTIMATOR_VERSION } from '@vybestack/llxprt-code-providers/tokenizers/Gpt56O200kPromptEstimator.js';
import {
  CLAUDE_FABLE_5_CALIBRATION,
  CLAUDE_FABLE_5_ESTIMATOR_FAMILY,
} from '@vybestack/llxprt-code-providers/tokenizers/claude/claudeCalibrationAssets.js';
import { TiktokenModuleLoader } from '@vybestack/llxprt-code-providers/tokenizers/o200kBaseCounter.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

async function captureRejection(operation: Promise<unknown>): Promise<unknown> {
  return operation.then(
    () => new Error('expected the operation to reject'),
    (error: unknown) => error,
  );
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

describe('individually owned provider factories', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let callerConfig: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let callerManager: ProviderManager;
  let callerTokenizer: RuntimeTokenizerFactory;

  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openCaller(
    runtimeId: string,
    model: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      const rawDirectory = await mkdtemp(join(tmpdir(), 'provider-bus-owner-'));
      retiring.push(() => rm(rawDirectory, { recursive: true, force: true }));
      const directory = await realpath(rawDirectory);
      const selectedConfig = new Config({
        sessionId: runtimeId,
        targetDir: directory,
        cwd: directory,
        model,
        debugMode: false,
      });
      callerConfig = selectedConfig;
      retiring.push(() => selectedConfig.dispose());
      const release = new AcquisitionRelease();
      let acquisitionComplete = false;
      retiring.push(() =>
        acquisitionComplete ? release.close() : release.rollback(),
      );
      settings = new SettingsService();
      const selectedSettingsOwner = new SessionSettingsOwner(settings);
      settingsOwner = selectedSettingsOwner;
      release.acquire('settings', () => selectedSettingsOwner.dispose());
      settingsOwner.bindTelemetry(callerConfig);
      const policy = new RuntimePolicyOwner(callerConfig);
      release.acquire('policy', () => policy.dispose());
      const bus = policy.session.messageBus;
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      for (const scope of new Set([runtimeId]))
        release.acquire('files', () => releaseAdoptedFileScope(files, scope));
      callerManager = acquirePreferredProviderManager(
        callerConfig,
        settings,
        settingsOwner,
        files,
        runtimeId,
        credentials().authority,
        release,
      );
      acquirePreferredOAuth(
        undefined,
        bus,
        callerConfig,
        settings,
        callerManager,
        runtimeId,
        undefined,
        credentials().authority,
        release,
        undefined,
      );
      callerTokenizer = configureProviderTokenizer(callerManager);
      await settingsOwner.startTelemetry(callerConfig);
      callerManager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId,
          runtimeKind: 'agent',
          metadata,
        }),
        settingsOwner,
        settings,
        callerConfig,
      );
      acquisitionComplete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }

  async function closeCaller(): Promise<void> {
    await runCleanupSteps(retiring.splice(0).reverse());
  }

  /**
   * @plan:PLAN-20260603-ISSUE1584.P16a
   * @requirement:REQ-DEP-001
   */
  it('binds only the selected tokenizer and acquires independent content generators', async () => {
    await openCaller('independent-factory-owners', 'gpt-5.6-sol', {});
    const installed = callerTokenizer;
    expect(configureProviderTokenizer(callerManager)).toBe(installed);
    const selected = createRuntimeTokenizerFactory();
    expect(configureProviderTokenizer(callerManager, selected)).toBe(selected);
    expect(callerManager.getTokenizerFactory()).toBe(selected);
    expect(configureProviderTokenizer(callerManager)).toBe(selected);
    const prepare = requirePrepareTokenizer(selected);
    await prepare('openai', 'gpt-5.6-sol');
    const tokenizer = selected.getTokenizer('openai', 'gpt-5.6-sol');
    expect(
      await tokenizer?.countTokens(
        'The quick brown fox jumps over the lazy dog.',
      ),
    ).toBe(10);
    const firstFactory = createRuntimeContentGeneratorFactory();
    const secondFactory = createRuntimeContentGeneratorFactory();
    expect(firstFactory).not.toBe(secondFactory);
    const first = firstFactory.createContentGenerator();
    const second = secondFactory.createContentGenerator();
    expect(first).toBeInstanceOf(ProviderContentGenerator);
    expect(second).toBeInstanceOf(ProviderContentGenerator);
    expect(first).not.toBe(second);
  });

  it('injects providers-backed content generator and tokenizer factories into CLI config', async () => {
    await openCaller('provider-runtime-factory-injection', 'gpt-4.1', {
      source: 'issue1584-p16a',
    });

    const manager = callerManager;

    configureProviderTokenizer(manager);

    const contentGeneratorFactory = createRuntimeContentGeneratorFactory();
    const tokenizerFactory = configureProviderTokenizer(manager);

    expect(contentGeneratorFactory).toBeDefined();
    expect(tokenizerFactory).toBeDefined();
    expect(contentGeneratorFactory.createContentGenerator()).toBeInstanceOf(
      ProviderContentGenerator,
    );
    expect(tokenizerFactory.getTokenizer('openai', 'gpt-4.1')).toBeDefined();
    expect(
      tokenizerFactory.getTokenizer('anthropic', 'claude-3-5-sonnet'),
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
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.resolve(1234),
    };
  }

  /**
   * The Claude 5 registrations are only useful if the composition root
   * actually installs them, so this asserts through the composed factory
   * rather than through a locally built registry.
   */
  it('composes a separately calibrated estimator for each Claude 5 model', async () => {
    await openCaller('provider-runtime-factory-claude5', 'claude-opus-5', {
      source: 'issue2835',
    });

    configureProviderTokenizer(callerManager);
    const tokenizerFactory = callerTokenizer;
    expect(tokenizerFactory).toBeDefined();

    expect(tokenizerFactory.claimsModel?.('claude-opus-5')).toBe(true);
    expect(tokenizerFactory.getEstimatorFamily?.('claude-opus-5')).toBe(
      'anthropic-claude-opus-5',
    );
    expect(tokenizerFactory.claimsModel?.('claude-fable-5')).toBe(true);
    expect(tokenizerFactory.getEstimatorFamily?.('claude-fable-5')).toBe(
      'anthropic-claude-fable-5',
    );

    const opus = await tokenizerFactory.estimatePrompt(
      buildClaudeEstimateRequest('claude-opus-5', 'anthropic'),
    );
    expect(opus.family).toBe('anthropic-claude-opus-5');
    expect(opus.method).toBe('calibrated');
    expect(opus.count).toBeGreaterThan(0);

    const fable = await tokenizerFactory.estimatePrompt(
      buildClaudeEstimateRequest('claude-fable-5', 'anthropic'),
    );
    expect(fable.family).toBe('anthropic-claude-fable-5');
    expect(fable.method).toBe('calibrated');
    expect(fable.estimatorVersion).not.toBe(opus.estimatorVersion);

    const proxied = await tokenizerFactory.estimatePrompt(
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
    await openCaller(
      'provider-runtime-injected-tokenizer-factory',
      'gpt-5.6-sol',
      {},
    );

    const injectedFactory = createRuntimeTokenizerFactory();
    callerManager.setTokenizerFactory(injectedFactory);

    try {
      configureProviderTokenizer(callerManager);

      expect(callerManager.getTokenizerFactory()).toBe(injectedFactory);
    } finally {
      await closeCaller();
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

  it('prepares GPT-6 Astra for exact o200k runtime counting and prompt estimation', async () => {
    const factory = createRuntimeTokenizerFactory();
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    await prepareTokenizer('codex', 'gpt-6-astra');
    const tokenizer = factory.getTokenizer('codex', 'gpt-6-astra');
    const estimate = await factory.estimatePrompt({
      activeProvider: 'codex',
      canonicalModel: 'gpt-6-astra',
      protocol: 'openai-responses',
      wireMethod: 'responses/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-responses',
        promptText: 'The quick brown fox jumps over the lazy dog.',
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.resolve(999),
    });

    expect(tokenizer?.fallbackPolicy).toBe('deny');
    expect(
      await tokenizer?.countTokens(
        'The quick brown fox jumps over the lazy dog.',
      ),
    ).toBe(10);
    expect(estimate).toMatchObject({
      count: 10,
      method: 'exact',
      family: 'openai-gpt-5.6',
    });
  });

  it('shares the injected o200k resolver across Astra readiness, runtime counting, and final estimation', async () => {
    const injectedCount = 29;
    let loadCount = 0;
    const loadModule: TiktokenModuleLoader = async () => {
      loadCount += 1;
      const tiktoken = await import('@dqbd/tiktoken');
      return {
        ...tiktoken,
        get_encoding: (...args: Parameters<typeof tiktoken.get_encoding>) =>
          new Proxy(tiktoken.get_encoding(...args), {
            get(target, property, receiver) {
              if (property === 'encode') {
                return (): Uint32Array =>
                  Uint32Array.from(
                    { length: injectedCount },
                    (_unused, index) => index,
                  );
              }
              return Reflect.get(target, property, receiver);
            },
          }),
      };
    };
    const factory = createRuntimeTokenizerFactory(loadModule);
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    await prepareTokenizer('codex', 'gpt-6-astra');
    const runtimeCount = await factory
      .getTokenizer('codex', 'gpt-6-astra')
      ?.countTokens('The quick brown fox jumps over the lazy dog.');
    const estimate = await factory.estimatePrompt({
      activeProvider: 'codex',
      canonicalModel: 'gpt-6-astra',
      protocol: 'openai-responses',
      wireMethod: 'responses/v1',
      finalizedProjection: {
        kind: 'llxprt-provider-prompt-v3',
        protocol: 'openai-responses',
        promptText: 'The quick brown fox jumps over the lazy dog.',
      },
      projectionRevision: PROJECTION_REVISION,
      legacyEstimate: () => Promise.resolve(999),
    });

    expect(runtimeCount).toBe(injectedCount);
    expect(estimate).toMatchObject({
      count: injectedCount,
      method: 'exact',
      family: 'openai-gpt-5.6',
    });
    expect(loadCount).toBe(1);
  });

  it('fails Astra preparation when the shared o200k codec cannot initialize', async () => {
    const loaderFailure = new Error('Astra codec initialization exploded');
    const factory = createRuntimeTokenizerFactory(() =>
      Promise.reject(loaderFailure),
    );
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    const error = await captureRejection(
      prepareTokenizer('codex', 'gpt-6-astra'),
    );

    expect(error).toBeInstanceOf(ModelPromptEstimatorError);
    expect(error).toMatchObject({
      code: 'asset-unavailable',
      context: {
        activeProvider: 'codex',
        canonicalModel: 'gpt-6-astra',
        protocol: 'openai-responses',
        family: 'openai-gpt-5.6',
      },
      cause: loaderFailure,
    });
  });

  it('prepares sanctioned Astra identities without preparing or claiming lookalikes', async () => {
    let loadCount = 0;
    const loadModule: TiktokenModuleLoader = async () => {
      loadCount += 1;
      return import('@dqbd/tiktoken');
    };
    const factory = createRuntimeTokenizerFactory(loadModule);
    const prepareTokenizer = factory.prepareTokenizer;
    if (prepareTokenizer === undefined) {
      throw new Error('runtime tokenizer factory has no readiness operation');
    }

    await prepareTokenizer('codex', 'gpt-6-astral');
    await prepareTokenizer('codex', 'gpt-6-astra-mini');

    expect(loadCount).toBe(0);
    expect(factory.claimsModel?.('gpt-6-astral')).toBe(false);
    expect(factory.claimsModel?.('gpt-6-astra-mini')).toBe(false);

    await prepareTokenizer('codex', 'gpt-6-astra-latest');

    expect(loadCount).toBe(1);
    expect(factory.claimsModel?.('gpt-6-astra-latest')).toBe(true);
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
      projectionRevision: PROJECTION_REVISION,
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
    expect(result.estimatorVersion).toBe(GPT_56_ESTIMATOR_VERSION);
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
