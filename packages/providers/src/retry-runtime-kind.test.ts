import { createProviderConfigFixture } from './runtime/__tests__/provider-config-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createProviderRuntimeContext,
  type RuntimeKind,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { RetryOrchestrator } from './RetryOrchestrator.js';
import { AllBucketsExhaustedError } from './errors.js';
import type { GenerateChatOptions, IProvider } from './IProvider.js';
import { assembleCliProviderRuntime } from './runtime/assembleCliProviderRuntime.js';
describe('retry runtime kind', () => {
  const configs: Config[] = [];
  afterEach(async () => {
    await Promise.all(configs.splice(0).map((config) => config.dispose()));
  });

  function request(runtimeKind: RuntimeKind | undefined): {
    options: GenerateChatOptions;
    owner: ProviderRuntimeContext;
    root: ReturnType<typeof createProviderConfigFixture>;
  } {
    const settings = new SettingsService();
    const root = createProviderConfigFixture({
      sessionId: 'same-label',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test-model',
      settingsService: settings,
    });
    const { config } = root;
    configs.push(config);
    const owner = createProviderRuntimeContext({
      settingsService: settings,
      config,
      sessionSettings: root.settingsOwner,
      runtimeId: 'same-label',
      runtimeKind,
    });
    return {
      owner,
      root,
      options: {
        contents: [],
        runtimeKind,
        tryBucketFailover: async () => false,
        readFailoverBuckets: () => ['work'],
        readCurrentBucket: () => 'work',
        readFailoverReasons: () => ({ work: 'reauth-failed' }),
      },
    };
  }

  const provider: IProvider = {
    name: 'anthropic',
    async getModels() {
      return [];
    },
    getDefaultModel() {
      return 'test-model';
    },
    async *generateChatCompletion() {
      yield* [];
      throw Object.assign(new Error('Rate limit exceeded'), { status: 429 });
    },
  };

  async function exhaust(
    options: GenerateChatOptions,
  ): Promise<AllBucketsExhaustedError> {
    const retry = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 0,
    });
    try {
      for await (const content of retry.generateChatCompletion(options)) {
        throw new Error(`Unexpected content: ${JSON.stringify(content)}`);
      }
    } catch (error) {
      if (error instanceof AllBucketsExhaustedError) return error;
      throw error;
    }
    throw new Error('Expected bucket exhaustion');
  }
  it('preserves bootstrap recovery wording through CLI context and assembly', async () => {
    const { options, owner: runtime, root } = request(undefined);
    const config = runtime.config;
    if (!config) throw new Error('Missing fixture config');
    const assembled = assembleCliProviderRuntime({
      settingsService: root.settingsService,
      settingsOwner: root.settingsOwner,
      config,
      runtimeId: 'bootstrap',
      metadata: { source: 'cli-bootstrap' },
    });
    expect(
      (
        await exhaust({
          ...options,
          runtimeKind: assembled.runtime.runtimeKind,
        })
      ).message,
    ).toContain('interactive host session');
    assembled.registration.dispose();
  });
  it('reads activation overrides through the owning provider manager at invocation time', async () => {
    const { options, owner: runtime, root } = request('agent');
    const config = runtime.config;
    if (!config) throw new Error('Missing fixture runtime');
    root.settingsOwner.writeUserParameter('retrywait', 0);
    root.settingsOwner.writeUserParameter('auth-key', 'test-key');
    const owner = assembleCliProviderRuntime({
      runtimeId: 'retry-owner',
      settingsService: root.settingsService,
      settingsOwner: root.settingsOwner,
      config,
    });
    owner.providerManager.setRetryOperationsFactory?.(() => ({
      tryBucketFailover: options.tryBucketFailover,
      readFailoverBuckets: options.readFailoverBuckets,
      readFailoverReasons: options.readFailoverReasons,
    }));
    owner.providerManager.setRuntimeContext(runtime);
    owner.providerManager.registerProvider(provider);
    await owner.providerManager.setActiveProvider(provider.name);
    const fail = async (): Promise<string> => {
      const activeProvider = owner.providerManager.getActiveProvider();
      if (!activeProvider) throw new Error('Missing fixture provider');
      try {
        for await (const content of activeProvider.generateChatCompletion({
          contents: [],
        })) {
          throw new Error(`Unexpected content: ${JSON.stringify(content)}`);
        }
      } catch (error) {
        if (error instanceof AllBucketsExhaustedError) return error.message;
        throw error;
      }
      throw new Error('Expected bucket exhaustion');
    };
    try {
      expect(await fail()).toContain('interactive host session');
      owner.providerManager.setRuntimeContext({
        ...runtime,
        runtimeId: 'activated-owner',
        runtimeKind: 'cli-interactive',
      });
      expect(await fail()).toContain(
        'auth dialog will open on your next message',
      );
      owner.providerManager.setRuntimeContext({
        ...runtime,
        runtimeId: 'activated-owner',
        runtimeKind: 'subagent',
      });
      expect(await fail()).toContain('interactive host session');
    } finally {
      owner.registration.dispose();
    }
  });

  describe('retry owner runtime kind outside identity ALS', () => {
    it('keeps same-label concurrent request owners separate', async () => {
      const background = request('subagent').options;
      const foreground = request('cli-interactive').options;
      const [backgroundError, foregroundError] = await Promise.all([
        exhaust(background),
        exhaust(foreground),
      ]);
      expect(backgroundError.message).toContain('interactive host session');
      expect(backgroundError.message).not.toContain(
        'auth dialog will open on your next message',
      );
      expect(foregroundError.message).toContain(
        'auth dialog will open on your next message',
      );
      expect((await exhaust(background)).message).toBe(backgroundError.message);
    });

    it.each(['agent', 'subagent', 'cli-bootstrap'] as const)(
      'directs %s recovery to the host',
      async (kind) => {
        expect((await exhaust(request(kind).options)).message).toContain(
          'anthropic via /auth there',
        );
      },
    );

    it('preserves undefined-kind recovery wording', async () => {
      expect((await exhaust(request(undefined).options)).message).toContain(
        'Please re-authenticate to continue. The auth dialog will open on your next message.',
      );
    });
  });
});
