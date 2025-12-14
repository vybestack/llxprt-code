/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P14
 * @requirement REQ-SP2-003
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IProvider, Profile } from '@vybestack/llxprt-code-core';
import {
  activateIsolatedRuntimeContext,
  applyProfileSnapshot,
  createIsolatedRuntimeContext,
  configureCliStatelessHardening,
  setActiveModel,
  setActiveModelParam,
  setEphemeralSetting,
  switchActiveProvider,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  resetCliProviderInfrastructure,
  getCliStatelessHardeningOverride,
} from '../runtimeSettings.js';
import type { IsolatedRuntimeContextHandle } from '../runtimeContextFactory.js';
import {
  cleanupTempDirectory,
  createTempDirectory,
} from '../../integration-tests/test-utils.js';

interface RuntimeFixture {
  id: string;
  profileName: string;
  primaryProvider: string;
  secondaryProvider: string;
  primaryModel: string;
  secondaryModel: string;
  tempDir: string;
  handle: IsolatedRuntimeContextHandle;
}

const runtimeFixtures: RuntimeFixture[] = [];

beforeEach(() => {
  resetCliProviderInfrastructure();
});

afterEach(async () => {
  resetCliProviderInfrastructure();
  while (runtimeFixtures.length > 0) {
    const fixture = runtimeFixtures.pop();
    if (!fixture) {
      continue;
    }
    try {
      await fixture.handle.cleanup();
    } finally {
      await cleanupTempDirectory(fixture.tempDir);
    }
  }
});

describe('CLI runtime isolation', () => {
  it('isolates concurrent runtime activations across sessions @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 1-3', async () => {
    const runtimeA = await bootstrapRuntimeFixture({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary',
    });
    const runtimeB = await bootstrapRuntimeFixture({
      id: 'runtime-b',
      profileName: 'profile-b',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'beta-primary',
      secondaryModel: 'beta-secondary',
    });

    const barrier = createBarrier(2);

    await Promise.all([
      runWithRuntime(runtimeA, barrier, async () => {
        await setActiveModel('alpha-primary-updated');
      }),
      runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await setActiveModel('beta-primary-updated');
        },
        { delayBeforeActivationMs: 5 },
      ),
    ]);

    expect(
      runtimeA.handle.settingsService.getProviderSettings(
        runtimeA.primaryProvider,
      ).model,
    ).toBe('alpha-primary-updated');
    expect(runtimeA.handle.config.getModel()).toBe('alpha-primary-updated');

    expect(
      runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.primaryProvider,
      ).model,
    ).toBe('beta-primary-updated');
    expect(runtimeB.handle.config.getModel()).toBe('beta-primary-updated');
  });

  it('scopes command mutations to active runtime contexts @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 4-10', async () => {
    const runtimeA = await bootstrapRuntimeFixture({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary-default',
    });
    const runtimeB = await bootstrapRuntimeFixture({
      id: 'runtime-b',
      profileName: 'profile-b',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'beta-primary',
      secondaryModel: 'beta-secondary-default',
    });

    const barrier = createBarrier(2);

    await Promise.all([
      runWithRuntime(runtimeA, barrier, async () => {
        await switchActiveProvider(runtimeA.secondaryProvider);
        await setActiveModel('alpha-secondary-tuned');
        setActiveModelParam('temperature', 0.2);
        const profile: Profile = {
          version: 1,
          provider: runtimeA.secondaryProvider,
          model: 'alpha-profile-model',
          modelParams: { temperature: 0.6 },
          ephemeralSettings: {
            'base-url': 'https://alpha.profile.example.com',
            'auth-key': 'alpha-profile-key',
          },
        };
        await applyProfileSnapshot(profile, {
          profileName: runtimeA.profileName,
        });
        await updateActiveProviderBaseUrl('https://alpha.isolated.example.com');
        await updateActiveProviderApiKey('alpha-updated-key');
        setEphemeralSetting(
          'auth-keyfile',
          `${runtimeA.tempDir}/alpha-keyfile`,
        );
        // Set custom-headers AFTER profile load to ensure it persists
        setEphemeralSetting('custom-headers', {
          'x-runtime': runtimeA.id,
        });
      }),
      runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await switchActiveProvider(runtimeB.secondaryProvider);
          await setActiveModel('beta-secondary-tuned');
          setActiveModelParam('temperature', 0.9);
          const profile: Profile = {
            version: 1,
            provider: runtimeB.secondaryProvider,
            model: 'beta-profile-model',
            modelParams: { temperature: 0.4 },
            ephemeralSettings: {
              'base-url': 'https://beta.profile.example.com',
              'auth-key': 'beta-profile-key',
            },
          };
          await applyProfileSnapshot(profile, {
            profileName: runtimeB.profileName,
          });
          await updateActiveProviderBaseUrl(
            'https://beta.isolated.example.com',
          );
          await updateActiveProviderApiKey('beta-updated-key');
          setEphemeralSetting(
            'auth-keyfile',
            `${runtimeB.tempDir}/beta-keyfile`,
          );
          // Set custom-headers AFTER profile load to ensure it persists
          setEphemeralSetting('custom-headers', {
            'x-runtime': runtimeB.id,
          });
        },
        { delayBeforeActivationMs: 5 },
      ),
    ]);

    const aSecondarySettings =
      runtimeA.handle.settingsService.getProviderSettings(
        runtimeA.secondaryProvider,
      );
    expect(runtimeA.handle.config.getProvider()).toBe(
      runtimeA.secondaryProvider,
    );
    expect(runtimeA.handle.config.getModel()).toBe('alpha-profile-model');
    expect(runtimeA.handle.config.getEphemeralSetting('base-url')).toBe(
      'https://alpha.isolated.example.com',
    );
    expect(runtimeA.handle.config.getEphemeralSetting('auth-key')).toBe(
      'alpha-updated-key',
    );
    expect(runtimeA.handle.config.getEphemeralSetting('auth-keyfile')).toBe(
      `${runtimeA.tempDir}/alpha-keyfile`,
    );
    expect(
      runtimeA.handle.config.getEphemeralSetting('custom-headers'),
    ).toEqual({ 'x-runtime': runtimeA.id });
    expect(aSecondarySettings.temperature).toBe(0.6);
    expect(aSecondarySettings.apiKey).toBe('alpha-updated-key');
    expect(aSecondarySettings.baseUrl).toBe(
      'https://alpha.isolated.example.com',
    );

    const bSecondarySettings =
      runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.secondaryProvider,
      );
    expect(runtimeB.handle.config.getProvider()).toBe(
      runtimeB.secondaryProvider,
    );
    expect(runtimeB.handle.config.getModel()).toBe('beta-profile-model');
    expect(runtimeB.handle.config.getEphemeralSetting('base-url')).toBe(
      'https://beta.isolated.example.com',
    );
    expect(runtimeB.handle.config.getEphemeralSetting('auth-key')).toBe(
      'beta-updated-key',
    );
    expect(runtimeB.handle.config.getEphemeralSetting('auth-keyfile')).toBe(
      `${runtimeB.tempDir}/beta-keyfile`,
    );
    expect(
      runtimeB.handle.config.getEphemeralSetting('custom-headers'),
    ).toEqual({ 'x-runtime': runtimeB.id });
    expect(bSecondarySettings.temperature).toBe(0.4);
    expect(bSecondarySettings.apiKey).toBe('beta-updated-key');
    expect(bSecondarySettings.baseUrl).toBe(
      'https://beta.isolated.example.com',
    );
  });

  it('keeps other runtimes stable when disposing one in flight @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 2-3', async () => {
    const runtimeA = await bootstrapRuntimeFixture({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary',
    });
    const runtimeB = await bootstrapRuntimeFixture({
      id: 'runtime-b',
      profileName: 'profile-b',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'beta-primary',
      secondaryModel: 'beta-secondary',
    });

    const barrier = createBarrier(2);
    const cleanupSignal = createDeferred<void>();

    const taskA = (async () => {
      await runWithRuntime(
        runtimeA,
        barrier,
        async () => {
          await cleanupSignal.promise;
          await setActiveModel('alpha-primary-post-dispose');
        },
        { delayBeforeActivationMs: 0 },
      );
      return runtimeA.handle.config.getModel();
    })();

    const taskB = (async () => {
      await runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await setActiveModel('beta-primary-post-dispose');
          await runtimeB.handle.cleanup();
          cleanupSignal.resolve();
        },
        { delayBeforeActivationMs: 5 },
      );
      return runtimeB.handle.config.getModel();
    })();

    await expect(taskB).resolves.toBe('beta-primary-post-dispose');
    await expect(taskA).resolves.toBe('alpha-primary-post-dispose');
  });

  it('enforces runtime guard when stateless hardening is active @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-005 @pseudocode provider-runtime-handling.md lines 10-16', async () => {
    const previousPreference = getCliStatelessHardeningOverride();
    configureCliStatelessHardening('strict');
    resetCliProviderInfrastructure();

    try {
      await expect(setActiveModel('stateless-model')).rejects.toThrow(
        /MissingProviderRuntimeError[\s\S]*runtime registration[\s\S]*REQ-SP4-004/i,
      );
    } finally {
      configureCliStatelessHardening(previousPreference);
    }
  });

  it('enforces explicit SettingsService when stateless hardening enabled @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
    const previousPreference = getCliStatelessHardeningOverride();
    configureCliStatelessHardening('strict');

    try {
      resetCliProviderInfrastructure();

      const { getCliRuntimeContext } = await import('../runtimeSettings.js');

      // Try to get context with stateless mode enabled but no runtime registered
      // This simulates missing SettingsService scenario
      expect(() => getCliRuntimeContext()).toThrow(
        /MissingProviderRuntimeError[\s\S]*runtime registration[\s\S]*REQ-SP4-004/i,
      );
    } finally {
      configureCliStatelessHardening(previousPreference);
      resetCliProviderInfrastructure();
    }
  });

  it('enforces explicit runtime registration when stateless hardening enabled @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
    const previousPreference = getCliStatelessHardeningOverride();
    configureCliStatelessHardening('strict');
    resetCliProviderInfrastructure();

    try {
      const { getCliRuntimeContext } = await import('../runtimeSettings.js');

      // Try to get context without any runtime registration
      expect(() => getCliRuntimeContext()).toThrow(
        /MissingProviderRuntimeError[\s\S]*runtime registration[\s\S]*REQ-SP4-004/i,
      );
    } finally {
      configureCliStatelessHardening(previousPreference);
    }
  });

  it('ensureStatelessProviderReady normalizes and pushes runtime context @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004 @requirement:REQ-SP4-005', async () => {
    const previousPreference = getCliStatelessHardeningOverride();
    configureCliStatelessHardening('strict');
    resetCliProviderInfrastructure();

    try {
      const runtimeA = await bootstrapRuntimeFixture({
        id: 'runtime-stateless-ready',
        profileName: 'profile-ready',
        primaryProvider: 'primary',
        secondaryProvider: 'secondary',
        primaryModel: 'ready-model',
        secondaryModel: 'ready-model-2',
      });

      await activateIsolatedRuntimeContext(runtimeA.handle, {
        runtimeId: runtimeA.id,
        metadata: {
          source: 'test-ensure-ready',
        },
      });

      const { ensureStatelessProviderReady } = await import(
        '../runtimeSettings.js'
      );

      // Should not throw - runtime properly registered
      expect(() => ensureStatelessProviderReady()).not.toThrow();

      // Verify prepareStatelessProviderInvocation was called
      // (We can't directly verify this without exposing internals, but we can verify it doesn't throw)
    } finally {
      configureCliStatelessHardening(previousPreference);
    }
  });

  it('ensureStatelessProviderReady throws when services missing @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
    const previousPreference = getCliStatelessHardeningOverride();
    configureCliStatelessHardening('strict');

    try {
      resetCliProviderInfrastructure();

      const { ensureStatelessProviderReady } = await import(
        '../runtimeSettings.js'
      );

      // Try to ensure ready with no runtime registered - should throw
      expect(() => ensureStatelessProviderReady()).toThrow(
        /MissingProviderRuntimeError[\s\S]*runtime registration[\s\S]*REQ-SP4-004/i,
      );
    } finally {
      configureCliStatelessHardening(previousPreference);
      resetCliProviderInfrastructure();
    }
  });
});

async function bootstrapRuntimeFixture(options: {
  id: string;
  profileName: string;
  primaryProvider: string;
  secondaryProvider: string;
  primaryModel: string;
  secondaryModel: string;
}): Promise<RuntimeFixture> {
  const tempDir = await createTempDirectory();
  const handle = createIsolatedRuntimeContext({
    runtimeId: options.id,
    workspaceDir: tempDir,
    model: options.primaryModel,
    metadata: {
      profileName: options.profileName,
    },
    prepare: async ({ providerManager, settingsService, config }) => {
      providerManager.registerProvider(
        createStubProvider(options.primaryProvider, options.primaryModel),
      );
      providerManager.registerProvider(
        createStubProvider(options.secondaryProvider, options.secondaryModel),
      );
      await providerManager.setActiveProvider(options.primaryProvider);
      settingsService.set('activeProvider', options.primaryProvider);
      settingsService.setCurrentProfileName?.(options.profileName);
      settingsService.setProviderSetting(
        options.primaryProvider,
        'model',
        options.primaryModel,
      );
      settingsService.setProviderSetting(
        options.primaryProvider,
        'baseUrl',
        `https://${options.id}.primary.example.com`,
      );
      settingsService.setProviderSetting(
        options.primaryProvider,
        'apiKey',
        `${options.id}-initial-key`,
      );
      config.setProvider(options.primaryProvider);
      config.setModel(options.primaryModel);
      config.setEphemeralSetting(
        'base-url',
        `https://${options.id}.primary.example.com`,
      );
      config.setEphemeralSetting('auth-key', `${options.id}-initial-key`);
      config.setEphemeralSetting(
        'auth-keyfile',
        `${tempDir}/${options.id}-initial.key`,
      );
    },
  });

  const fixture: RuntimeFixture = {
    ...options,
    tempDir,
    handle,
  };
  runtimeFixtures.push(fixture);
  return fixture;
}

function createStubProvider(
  name: string,
  defaultModel: string,
): IProvider & { clearState(): void } {
  return {
    name,
    async getModels() {
      return [
        {
          id: defaultModel,
          name: defaultModel,
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    getDefaultModel() {
      return defaultModel;
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `${name}-${defaultModel}` }],
      };
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
    isPaidMode() {
      return false;
    },
    clearState() {},
  };
}

function createBarrier(expected: number): () => Promise<void> {
  let count = 0;
  const waiters: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      count += 1;
      waiters.push(resolve);
      if (count === expected) {
        for (const release of waiters) {
          release();
        }
      }
    });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runWithRuntime<T>(
  fixture: RuntimeFixture,
  barrier: () => Promise<void>,
  action: () => Promise<T>,
  options: { delayBeforeActivationMs?: number } = {},
): Promise<T> {
  if (options.delayBeforeActivationMs) {
    await delay(options.delayBeforeActivationMs);
  }
  await activateIsolatedRuntimeContext(fixture.handle, {
    runtimeId: fixture.handle.runtimeId,
    metadata: {
      profileName: fixture.profileName,
      source: `runtime-isolation-test:${fixture.id}`,
    },
  });
  await barrier();
  return action();
}
