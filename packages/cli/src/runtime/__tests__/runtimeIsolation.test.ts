import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from '@vybestack/llxprt-code-providers/runtime/providerMutations.js';
import {
  assembleProfileApplication,
  assembleProviderSwitch,
} from '@vybestack/llxprt-code-agents';
import {
  providerSwitchInputs,
  baseUrlInputs,
  overrideInputs,
  modelParamInputs,
} from '../../../../providers/src/runtime/__tests__/provider-switch-inputs.js';
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P14
 * @requirement REQ-SP2-003
 */
import { installDefinitionRuntimeFixture } from '../../__tests__/definition-runtime-fixture.js';
const definitionFixture = installDefinitionRuntimeFixture();

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService, type Profile } from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import {
  activateIsolatedRuntimeContext,
  buildRuntimeProfileSnapshot,
  createIsolatedRuntimeContext,
  setActiveModel,
  setActiveModelParam,
  switchActiveProvider,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  listProviders,
  getEphemeralSettings,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  Config,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import type { IsolatedRuntimeContextHandle } from '@vybestack/llxprt-code-providers/runtime/runtimeContextFactory.js';
import { createProviderSessionOwner } from '../../integration-tests/__tests__/session-client-owner-fixture.js';
import {
  cleanupTempDirectory,
  createTempDirectory,
} from '../../integration-tests/test-utils.js';
import { MissingProviderRuntimeError } from '../../../../providers/src/runtime/messages.js';

interface RuntimeFixture {
  id: string;
  profileName: string;
  primaryProvider: string;
  secondaryProvider: string;
  primaryModel: string;
  secondaryModel: string;
  tempDir: string;
  handle: IsolatedRuntimeContextHandle;
  sessionClient: ReturnType<typeof createProviderSessionOwner>['sessionClient'];
}

const runtimeFixtures: RuntimeFixture[] = [];

describe('CLI runtime isolation', () => {
  afterEach(async () => {
    while (runtimeFixtures.length > 0) {
      const fixture = runtimeFixtures.pop();
      if (!fixture) {
        continue;
      }
      try {
        await fixture.handle.cleanup();
        await fixture.handle.config.dispose();
      } finally {
        await cleanupTempDirectory(fixture.tempDir);
      }
    }
  });
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
        await setActiveModel(
          'alpha-primary-updated',
          assembleModelSelection(runtimeA.handle.settingsOwner),
          runtimeA.handle.settingsService,
          runtimeA.handle.providerManager.getActiveProvider(),
        );
      }),
      runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await setActiveModel(
            'beta-primary-updated',
            assembleModelSelection(runtimeB.handle.settingsOwner),
            runtimeB.handle.settingsService,
            runtimeB.handle.providerManager.getActiveProvider(),
          );
        },
        { delayBeforeActivationMs: 5 },
      ),
    ]);

    expect(
      runtimeA.handle.settingsService.getProviderSettings(
        runtimeA.primaryProvider,
      ).model,
    ).toBe('alpha-primary-updated');
    expect(
      runtimeA.handle.settingsService.getProviderSettings(
        runtimeA.primaryProvider,
      ).model,
    ).toBe('alpha-primary-updated');

    expect(
      runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.primaryProvider,
      ).model,
    ).toBe('beta-primary-updated');
    expect(
      runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.primaryProvider,
      ).model,
    ).toBe('beta-primary-updated');
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
        await switchActiveProvider(
          runtimeA.secondaryProvider,
          {},
          ...(await providerSwitchInputs(
            runtimeA.handle,
            runtimeA.handle.providerManager,
            () => runtimeA.sessionClient.refreshAuth(),
          )),
        );
        await setActiveModel(
          'alpha-secondary-tuned',
          assembleModelSelection(runtimeA.handle.settingsOwner),
          runtimeA.handle.settingsService,
          runtimeA.handle.providerManager.getActiveProvider(),
        );
        setActiveModelParam(
          'temperature',
          0.2,
          ...modelParamInputs(runtimeA.handle, runtimeA.handle.providerManager),
        );
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
        await assembleProfileApplication(
          runtimeA.handle.config,
          runtimeA.handle.settingsService,
          runtimeA.handle.providerManager,
          runtimeA.handle.oauthManager,
          assembleProviderSwitch(
            runtimeA.handle.config,
            runtimeA.handle.settingsService,
            runtimeA.handle.providerManager,
            runtimeA.handle.oauthManager,
            () => runtimeA.handle.readRuntimeKind(),
            () => runtimeA.sessionClient.refreshAuth(),

            runtimeA.handle.settingsOwner,
          ),
          runtimeA.handle.settingsOwner,
          definitionFixture().profileDefinitions,
        ).applySnapshot(profile, { profileName: runtimeA.profileName });
        await updateActiveProviderBaseUrl(
          'https://alpha.isolated.example.com',
          ...(await baseUrlInputs(
            runtimeA.handle,
            runtimeA.handle.providerManager,
          )),
        );
        await updateActiveProviderApiKey(
          'alpha-updated-key',
          ...(await overrideInputs(runtimeA.handle)),
          runtimeA.handle.providerManager.getActiveProvider(),
        );
        runtimeA.handle.settingsOwner.writeUserParameter(
          'auth-keyfile',
          `${runtimeA.tempDir}/alpha-keyfile`,
        );
        // Set custom-headers AFTER profile load to ensure it persists
        runtimeA.handle.settingsOwner.writeUserParameter('custom-headers', {
          'x-runtime': runtimeA.id,
        });
      }),
      runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await switchActiveProvider(
            runtimeB.secondaryProvider,
            {},
            ...(await providerSwitchInputs(
              runtimeB.handle,
              runtimeB.handle.providerManager,
              () => runtimeB.sessionClient.refreshAuth(),
            )),
          );
          await setActiveModel(
            'beta-secondary-tuned',
            assembleModelSelection(runtimeB.handle.settingsOwner),
            runtimeB.handle.settingsService,
            runtimeB.handle.providerManager.getActiveProvider(),
          );
          setActiveModelParam(
            'temperature',
            0.9,
            ...modelParamInputs(
              runtimeB.handle,
              runtimeB.handle.providerManager,
            ),
          );
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
          await assembleProfileApplication(
            runtimeB.handle.config,
            runtimeB.handle.settingsService,
            runtimeB.handle.providerManager,
            runtimeB.handle.oauthManager,
            assembleProviderSwitch(
              runtimeB.handle.config,
              runtimeB.handle.settingsService,
              runtimeB.handle.providerManager,
              runtimeB.handle.oauthManager,
              () => runtimeB.handle.readRuntimeKind(),
              () => runtimeB.sessionClient.refreshAuth(),

              runtimeB.handle.settingsOwner,
            ),
            runtimeB.handle.settingsOwner,
            definitionFixture().profileDefinitions,
          ).applySnapshot(profile, { profileName: runtimeB.profileName });
          await updateActiveProviderBaseUrl(
            'https://beta.isolated.example.com',
            ...(await baseUrlInputs(
              runtimeB.handle,
              runtimeB.handle.providerManager,
            )),
          );
          await updateActiveProviderApiKey(
            'beta-updated-key',
            ...(await overrideInputs(runtimeB.handle)),
            runtimeB.handle.providerManager.getActiveProvider(),
          );
          runtimeB.handle.settingsOwner.writeUserParameter(
            'auth-keyfile',
            `${runtimeB.tempDir}/beta-keyfile`,
          );
          // Set custom-headers AFTER profile load to ensure it persists
          runtimeB.handle.settingsOwner.writeUserParameter('custom-headers', {
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
    expect(runtimeA.handle.settingsOwner.readSelectedProvider()).toBe(
      runtimeA.secondaryProvider,
    );
    expect(runtimeA.handle.settingsOwner.readSelectedModel()).toBe(
      'alpha-profile-model',
    );
    expect(runtimeA.handle.settingsOwner.readNamedParameter('base-url')).toBe(
      'https://alpha.isolated.example.com',
    );
    expect(runtimeA.handle.settingsOwner.readNamedParameter('auth-key')).toBe(
      'alpha-updated-key',
    );
    expect(
      runtimeA.handle.settingsOwner.readNamedParameter('auth-keyfile'),
    ).toBe(`${runtimeA.tempDir}/alpha-keyfile`);
    expect(
      runtimeA.handle.settingsOwner.readNamedParameter('custom-headers'),
    ).toStrictEqual({ 'x-runtime': runtimeA.id });
    expect(aSecondarySettings.temperature).toBe(0.6);
    expect(aSecondarySettings['auth-key']).toBe('alpha-updated-key');
    expect(aSecondarySettings['base-url']).toBe(
      'https://alpha.isolated.example.com',
    );

    const bSecondarySettings =
      runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.secondaryProvider,
      );
    expect(runtimeB.handle.settingsOwner.readSelectedProvider()).toBe(
      runtimeB.secondaryProvider,
    );
    expect(runtimeB.handle.settingsOwner.readSelectedModel()).toBe(
      'beta-profile-model',
    );
    expect(runtimeB.handle.settingsOwner.readNamedParameter('base-url')).toBe(
      'https://beta.isolated.example.com',
    );
    expect(runtimeB.handle.settingsOwner.readNamedParameter('auth-key')).toBe(
      'beta-updated-key',
    );
    expect(
      runtimeB.handle.settingsOwner.readNamedParameter('auth-keyfile'),
    ).toBe(`${runtimeB.tempDir}/beta-keyfile`);
    expect(
      runtimeB.handle.settingsOwner.readNamedParameter('custom-headers'),
    ).toStrictEqual({ 'x-runtime': runtimeB.id });
    expect(bSecondarySettings.temperature).toBe(0.4);
    expect(bSecondarySettings['auth-key']).toBe('beta-updated-key');
    expect(bSecondarySettings['base-url']).toBe(
      'https://beta.isolated.example.com',
    );
  });

  it('does not resurrect cleared auth and base-url state in runtime snapshots @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003', async () => {
    const runtime = await bootstrapRuntimeFixture({
      id: 'runtime-clear-state',
      profileName: 'profile-clear-state',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'primary-model',
      secondaryModel: 'secondary-model',
    });

    await activateIsolatedRuntimeContext(runtime.handle, {
      runtimeId: runtime.handle.runtimeId,
      metadata: {
        profileName: runtime.profileName,
        source: `runtime-isolation-test:${runtime.id}`,
      },
    });

    await updateActiveProviderApiKey(
      'runtime-clear-secret',
      ...(await overrideInputs(runtime.handle)),
      runtime.handle.providerManager.getActiveProvider(),
    );
    await updateActiveProviderBaseUrl(
      'https://runtime-clear.example.com/v1',
      ...(await baseUrlInputs(runtime.handle, runtime.handle.providerManager)),
    );

    expect(runtime.handle.settingsOwner.readNamedParameter('auth-key')).toBe(
      'runtime-clear-secret',
    );
    expect(runtime.handle.settingsOwner.readNamedParameter('base-url')).toBe(
      'https://runtime-clear.example.com/v1',
    );

    await updateActiveProviderApiKey(
      null,
      ...(await overrideInputs(runtime.handle)),
      runtime.handle.providerManager.getActiveProvider(),
    );
    await updateActiveProviderBaseUrl(
      'NONE',
      ...(await baseUrlInputs(runtime.handle, runtime.handle.providerManager)),
    );

    expect(
      runtime.handle.settingsOwner.readNamedParameter('auth-key'),
    ).toBeUndefined();
    expect(
      runtime.handle.settingsOwner.readNamedParameter('auth-keyfile'),
    ).toBeUndefined();
    expect(
      runtime.handle.settingsOwner.readNamedParameter('auth-key-name'),
    ).toBeUndefined();
    expect(
      runtime.handle.settingsOwner.readNamedParameter('base-url'),
    ).toBeUndefined();

    const selectedModel = runtime.handle.settingsOwner.readSelectedModel();
    if (selectedModel === undefined)
      throw new Error('Runtime fixture has no selected model');
    const runtimeSnapshot = buildRuntimeProfileSnapshot({
      providerName: runtime.handle.settingsOwner.readSelectedProvider() ?? '',
      modelName: selectedModel,
      providerSettings: runtime.handle.settingsService.getProviderSettings(
        runtime.handle.settingsOwner.readSelectedProvider() ?? '',
      ),
      ephemeralSettings: runtime.handle.settingsOwner.captureNamedParameters(),
    });
    expect(runtimeSnapshot.ephemeralSettings['auth-key']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['auth-keyfile']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['auth-key-name']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['base-url']).toBeUndefined();
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
          await setActiveModel(
            'alpha-primary-post-dispose',
            assembleModelSelection(runtimeA.handle.settingsOwner),
            runtimeA.handle.settingsService,
            runtimeA.handle.providerManager.getActiveProvider(),
          );
        },
        { delayBeforeActivationMs: 0 },
      );
      return runtimeA.handle.settingsService.getProviderSettings(
        runtimeA.primaryProvider,
      ).model;
    })();

    const taskB = (async () => {
      await runWithRuntime(
        runtimeB,
        barrier,
        async () => {
          await setActiveModel(
            'beta-primary-post-dispose',
            assembleModelSelection(runtimeB.handle.settingsOwner),
            runtimeB.handle.settingsService,
            runtimeB.handle.providerManager.getActiveProvider(),
          );
          await runtimeB.handle.cleanup();
          cleanupSignal.resolve();
        },
        { delayBeforeActivationMs: 5 },
      );
      return runtimeB.handle.settingsService.getProviderSettings(
        runtimeB.primaryProvider,
      ).model;
    })();

    await expect(taskB).resolves.toBe('beta-primary-post-dispose');
    await expect(taskA).resolves.toBe('alpha-primary-post-dispose');
  });

  it('enforces runtime guard for ownerless provider queries @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-005 @pseudocode provider-runtime-handling.md lines 10-16', () => {
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
  });

  it('enforces explicit SettingsService for ownerless settings queries @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', () => {
    expect(() => getEphemeralSettings()).toThrow(MissingProviderRuntimeError);
  });

  it('prepares a stateless invocation from the explicit runtime context', async () => {
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
        statelessHardening: 'strict',
      },
    });

    const context = createProviderRuntimeContext({
      settingsService: runtimeA.handle.settingsService,
      config: runtimeA.handle.config,
      providerFileLifecycle: runtimeA.handle.providerFileLifecycle,
      runtimeId: runtimeA.id,
      runtimeKind: 'cli-interactive',
      metadata: { statelessHardening: 'strict' },
    });
    const prepare =
      runtimeA.handle.providerManager.prepareStatelessProviderInvocation;
    if (!prepare) throw new Error('Stateless preparation is unavailable');
    expect(() =>
      prepare.call(runtimeA.handle.providerManager, context),
    ).not.toThrow();
  });

  it('rejects ownerless provider queries without consulting process preference', () => {
    expect(() => Reflect.apply(listProviders, undefined, [])).toThrow(
      'Provider listing requires an explicit owner',
    );
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
  const handle = (() => {
    const capturedConfig3 = new Config({
      sessionId: options.id,
      targetDir: tempDir,
      cwd: tempDir,
      model: options.primaryModel,
      debugMode: false,
      initialSettings: {},
    });
    const settingsService = new SettingsService();
    const settingsOwner = new SessionSettingsOwner(settingsService);
    return createIsolatedRuntimeContext(
      {
        settingsOwner,
        runtimeId: options.id,
        config: capturedConfig3,
        metadata: {
          profileName: options.profileName,
        },
        prepare: async ({ providerManager, settingsService }) => {
          providerManager.registerProvider(
            createStubProvider(options.primaryProvider, options.primaryModel),
          );
          providerManager.registerProvider(
            createStubProvider(
              options.secondaryProvider,
              options.secondaryModel,
            ),
          );
          void providerManager.setActiveProvider(options.primaryProvider);
          settingsService.set('activeProvider', options.primaryProvider);
          settingsService.setCurrentProfileName(options.profileName);
          settingsService.setProviderSetting(
            options.primaryProvider,
            'model',
            options.primaryModel,
          );
          settingsService.setProviderSetting(
            options.primaryProvider,
            'base-url',
            `https://${options.id}.primary.example.com`,
          );
          settingsService.setProviderSetting(
            options.primaryProvider,
            'auth-key',
            `${options.id}-initial-key`,
          );

          settingsOwner.writeUserParameter(
            'base-url',
            `https://${options.id}.primary.example.com`,
          );
          settingsOwner.writeUserParameter(
            'auth-key',
            `${options.id}-initial-key`,
          );
          settingsOwner.writeUserParameter(
            'auth-keyfile',
            `${tempDir}/${options.id}-initial.key`,
          );
        },
      },
      settingsService,
    );
  })();

  const fixture: RuntimeFixture = {
    ...options,
    tempDir,
    handle,
    sessionClient: createProviderSessionOwner(
      handle.config,
      handle.providerManager,
      handle.settingsService,
      handle.settingsOwner,
    ).sessionClient,
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
  if (
    options.delayBeforeActivationMs !== undefined &&
    options.delayBeforeActivationMs !== 0
  ) {
    await delay(options.delayBeforeActivationMs);
  }
  const metadata = {
    profileName: fixture.profileName,
    source: `runtime-isolation-test:${fixture.id}`,
  };
  await activateIsolatedRuntimeContext(fixture.handle, {
    runtimeId: fixture.handle.runtimeId,
    metadata,
  });
  await barrier();
  return action();
}
