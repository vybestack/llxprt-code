import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { ProviderManager, ProviderFileLifecycle } from './index.js';
import { configureProviderTokenizer } from './composition/index.js';
import { useOwnedCredentials } from './__tests__/helpers/owned-credential-fixture.js';
import { acquireOwnedProviderManager } from './__tests__/helpers/acquire-provider-owners.js';
import { releaseAdoptedFileScope } from './__tests__/helpers/adopted-file-scope.js';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from './__tests__/helpers/cleanup.js';

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

describe('retry runtime kind', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let config: Config;
  let settings: SettingsService;
  let settingsOwner: SessionSettingsOwner;
  let manager: ProviderManager;
  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });
  async function openManager(
    runtimeId: string,
    runtimeKind: RuntimeKind,
  ): Promise<void> {
    try {
      const directory = await mkdtemp(join(tmpdir(), 'retry-kind-owner-'));
      retiring.push(() => rm(directory, { recursive: true, force: true }));
      const selected = new Config({
        sessionId: 'same-label',
        targetDir: directory,
        cwd: directory,
        model: 'test-model',
        debugMode: false,
      });
      config = selected;
      retiring.push(() => selected.dispose());
      settings = new SettingsService();
      const selectedSettings = new SessionSettingsOwner(settings);
      settingsOwner = selectedSettings;
      retiring.push(() => selectedSettings.dispose());
      settingsOwner.bindTelemetry(config);
      const files = new ProviderFileLifecycle({
        maxFiles: 100,
        maxBytes: 512 * 1024 * 1024,
      });
      const release = new AcquisitionRelease();
      let complete = false;
      retiring.push(() => (complete ? release.close() : release.rollback()));
      for (const scope of new Set([runtimeId, 'same-label']))
        release.acquire('files', () => releaseAdoptedFileScope(files, scope));
      manager = acquireOwnedProviderManager(
        config,
        settings,
        settingsOwner,
        files,
        runtimeId,
        credentials().authority,
        release,
      );
      configureProviderTokenizer(manager);
      manager.setRuntimeContext(
        createProviderRuntimeContext({
          runtimeId,
          runtimeKind,
          metadata: { source: 'cli-bootstrap' },
        }),
        settingsOwner,
        settings,
        config,
      );
      complete = true;
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        runCleanupSteps(retiring.splice(0).reverse()),
      );
    }
  }

  function request(runtimeKind: RuntimeKind | undefined): {
    options: GenerateChatOptions;
    owner: ProviderRuntimeContext;
  } {
    const owner = createProviderRuntimeContext({
      runtimeId: 'same-label',
      runtimeKind,
    });
    return {
      owner,
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
    const { options } = request(undefined);
    await openManager('bootstrap', 'cli-bootstrap');
    expect(
      (
        await exhaust({
          ...options,
          runtimeKind: manager.getAuthIdentity().runtimeKind,
        })
      ).message,
    ).toContain('interactive host session');
  });
  it('reads activation overrides through the owning provider manager at invocation time', async () => {
    const { options, owner: runtime } = request('agent');
    await openManager('retry-owner', 'cli-bootstrap');
    settingsOwner.writeUserParameter('retrywait', 0);
    settingsOwner.writeUserParameter('auth-key', 'test-key');
    manager.setRetryOperationsFactory(() => ({
      tryBucketFailover: options.tryBucketFailover,
      readFailoverBuckets: options.readFailoverBuckets,
      readFailoverReasons: options.readFailoverReasons,
    }));
    manager.setRuntimeContext(runtime, settingsOwner, settings, config);
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);
    const fail = async (): Promise<string> => {
      const activeProvider = manager.getActiveProvider();
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
      manager.setRuntimeContext(
        {
          ...runtime,
          runtimeId: 'activated-owner',
          runtimeKind: 'cli-interactive',
        },
        settingsOwner,
        settings,
        config,
      );
      expect(await fail()).toContain(
        'auth dialog will open on your next message',
      );
      manager.setRuntimeContext(
        {
          ...runtime,
          runtimeId: 'activated-owner',
          runtimeKind: 'subagent',
        },
        settingsOwner,
        settings,
        config,
      );
      expect(await fail()).toContain('interactive host session');
    } finally {
      await runCleanupSteps(retiring.splice(0).reverse());
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
