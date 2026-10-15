import {
  createBarrier,
  createDeferred,
  delay,
} from './runtime-isolation-gates.js';
import {
  assembleProfileApplication,
  assembleProviderSwitch,
  SessionProviderReads,
  switchActiveProvider,
} from '@vybestack/llxprt-code-agents';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { useOwnedCredentials as installOwnedCredentials } from '../../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { assembleModelSelection } from '../../../../agents/src/api/model-selection.js';
import {
  acquirePreferredOAuth,
  acquirePreferredProviderManager,
} from '../../../../agents/src/api/preferred-provider-acquisition.js';
import { buildRuntimeProfileSnapshot } from '../../../../agents/src/api/profileSnapshot.js';
const credentials = installOwnedCredentials();
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

import { Config, MessageBus } from '@vybestack/llxprt-code-core';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { SettingsService, type Profile } from '@vybestack/llxprt-code-settings';
import { afterEach, describe, expect, it } from 'bun:test';
import { setActiveModelParam } from '../../../../agents/src/api/model-parameters.js';
import {
  setActiveModel,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
} from '../../../../agents/src/api/providerMutations.js';
import { createProviderSessionOwner } from '../../integration-tests/__tests__/session-client-owner-fixture.js';
import {
  cleanupTempDirectory,
  createTempDirectory,
} from '../../integration-tests/test-utils.js';

interface RuntimeData {
  id: string;
  profileName: string;
  primaryProvider: string;
  secondaryProvider: string;
  primaryModel: string;
  secondaryModel: string;
}
const releases: Array<() => Promise<void>> = [];
describe('CLI runtime isolation', () => {
  afterEach(async () => {
    for (const close of releases.splice(0).reverse()) await close();
  });
  it('isolates concurrent runtime activations across sessions @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 1-3', async () => {
    await openFirst({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary',
    });
    await openSecond({
      id: 'runtime-b',
      profileName: 'profile-b',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'beta-primary',
      secondaryModel: 'beta-secondary',
    });

    const barrier = createBarrier(2);

    await Promise.all([
      runWithFirst(barrier, async () => {
        await setActiveModel(
          'alpha-primary-updated',
          assembleModelSelection(firstOwner),
          firstSettings,
          firstManager.getActiveProvider(),
        );
      }),
      runWithSecond(
        barrier,
        async () => {
          await setActiveModel(
            'beta-primary-updated',
            assembleModelSelection(secondOwner),
            secondSettings,
            secondManager.getActiveProvider(),
          );
        },
        { delayBeforeActivationMs: 5 },
      ),
    ]);

    expect(
      firstSettings.getProviderSettings(firstData.primaryProvider).model,
    ).toBe('alpha-primary-updated');
    expect(
      firstSettings.getProviderSettings(firstData.primaryProvider).model,
    ).toBe('alpha-primary-updated');

    expect(
      secondSettings.getProviderSettings(secondData.primaryProvider).model,
    ).toBe('beta-primary-updated');
    expect(
      secondSettings.getProviderSettings(secondData.primaryProvider).model,
    ).toBe('beta-primary-updated');
  });

  it('scopes command mutations to active runtime contexts @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 4-10', async () => {
    await openFirst({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary-default',
    });
    await openSecond({
      id: 'runtime-b',
      profileName: 'profile-b',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'beta-primary',
      secondaryModel: 'beta-secondary-default',
    });

    const barrier = createBarrier(2);

    await Promise.all([
      runWithFirst(barrier, async () => {
        await switchActiveProvider(
          firstData.secondaryProvider,
          {},
          firstConfig,
          firstSettings,
          firstManager,
          firstOAuth,
          undefined,
          () => firstClient.refreshAuth(),
          firstOwner,
        );
        await setActiveModel(
          'alpha-secondary-tuned',
          assembleModelSelection(firstOwner),
          firstSettings,
          firstManager.getActiveProvider(),
        );
        setActiveModelParam(
          'temperature',
          0.2,
          firstSettings,
          firstManager.getActiveProviderName(),
        );
        const profile: Profile = {
          version: 1,
          provider: firstData.secondaryProvider,
          model: 'alpha-profile-model',
          modelParams: { temperature: 0.6 },
          ephemeralSettings: {
            'base-url': 'https://alpha.profile.example.com',
            'auth-key': 'alpha-profile-key',
          },
        };
        await assembleProfileApplication(
          firstSettings,
          firstManager,
          firstOAuth,
          assembleProviderSwitch(
            firstConfig,
            firstSettings,
            firstManager,
            firstOAuth,
            () => 'cli-interactive',
            () => firstClient.refreshAuth(),

            firstOwner,
          ),
          firstOwner,
          definitionFixture().profileDefinitions,
        ).applySnapshot(profile, { profileName: firstData.profileName });
        await updateActiveProviderBaseUrl(
          'https://alpha.isolated.example.com',
          {
            setEphemeralSetting: (key, value) =>
              firstOwner.writeUserParameter(key, value),
          },
          firstSettings,
          firstManager.getActiveProviderName() ?? '',
        );
        await updateActiveProviderApiKey(
          'alpha-updated-key',
          {
            setEphemeralSetting: (key, value) =>
              firstOwner.writeUserParameter(key, value),
          },
          firstSettings,
          firstManager.getActiveProvider(),
        );
        firstOwner.writeUserParameter(
          'auth-keyfile',
          `${firstTempDir}/alpha-keyfile`,
        );
        // Set custom-headers AFTER profile load to ensure it persists
        firstOwner.writeUserParameter('custom-headers', {
          'x-runtime': firstData.id,
        });
      }),
      runWithSecond(
        barrier,
        async () => {
          await switchActiveProvider(
            secondData.secondaryProvider,
            {},
            secondConfig,
            secondSettings,
            secondManager,
            secondOAuth,
            undefined,
            () => secondClient.refreshAuth(),
            secondOwner,
          );
          await setActiveModel(
            'beta-secondary-tuned',
            assembleModelSelection(secondOwner),
            secondSettings,
            secondManager.getActiveProvider(),
          );
          setActiveModelParam(
            'temperature',
            0.9,
            secondSettings,
            secondManager.getActiveProviderName(),
          );
          const profile: Profile = {
            version: 1,
            provider: secondData.secondaryProvider,
            model: 'beta-profile-model',
            modelParams: { temperature: 0.4 },
            ephemeralSettings: {
              'base-url': 'https://beta.profile.example.com',
              'auth-key': 'beta-profile-key',
            },
          };
          await assembleProfileApplication(
            secondSettings,
            secondManager,
            secondOAuth,
            assembleProviderSwitch(
              secondConfig,
              secondSettings,
              secondManager,
              secondOAuth,
              () => 'cli-interactive',
              () => secondClient.refreshAuth(),

              secondOwner,
            ),
            secondOwner,
            definitionFixture().profileDefinitions,
          ).applySnapshot(profile, { profileName: secondData.profileName });
          await updateActiveProviderBaseUrl(
            'https://beta.isolated.example.com',
            {
              setEphemeralSetting: (key, value) =>
                secondOwner.writeUserParameter(key, value),
            },
            secondSettings,
            secondManager.getActiveProviderName() ?? '',
          );
          await updateActiveProviderApiKey(
            'beta-updated-key',
            {
              setEphemeralSetting: (key, value) =>
                secondOwner.writeUserParameter(key, value),
            },
            secondSettings,
            secondManager.getActiveProvider(),
          );
          secondOwner.writeUserParameter(
            'auth-keyfile',
            `${secondTempDir}/beta-keyfile`,
          );
          // Set custom-headers AFTER profile load to ensure it persists
          secondOwner.writeUserParameter('custom-headers', {
            'x-runtime': secondData.id,
          });
        },
        { delayBeforeActivationMs: 5 },
      ),
    ]);

    const aSecondarySettings = firstSettings.getProviderSettings(
      firstData.secondaryProvider,
    );
    expect(firstOwner.readSelectedProvider()).toBe(firstData.secondaryProvider);
    expect(firstOwner.readSelectedModel()).toBe('alpha-profile-model');
    expect(firstOwner.readNamedParameter('base-url')).toBe(
      'https://alpha.isolated.example.com',
    );
    expect(firstOwner.readNamedParameter('auth-key')).toBe('alpha-updated-key');
    expect(firstOwner.readNamedParameter('auth-keyfile')).toBe(
      `${firstTempDir}/alpha-keyfile`,
    );
    expect(firstOwner.readNamedParameter('custom-headers')).toStrictEqual({
      'x-runtime': firstData.id,
    });
    expect(aSecondarySettings.temperature).toBe(0.6);
    expect(aSecondarySettings['auth-key']).toBe('alpha-updated-key');
    expect(aSecondarySettings['base-url']).toBe(
      'https://alpha.isolated.example.com',
    );

    const bSecondarySettings = secondSettings.getProviderSettings(
      secondData.secondaryProvider,
    );
    expect(secondOwner.readSelectedProvider()).toBe(
      secondData.secondaryProvider,
    );
    expect(secondOwner.readSelectedModel()).toBe('beta-profile-model');
    expect(secondOwner.readNamedParameter('base-url')).toBe(
      'https://beta.isolated.example.com',
    );
    expect(secondOwner.readNamedParameter('auth-key')).toBe('beta-updated-key');
    expect(secondOwner.readNamedParameter('auth-keyfile')).toBe(
      `${secondTempDir}/beta-keyfile`,
    );
    expect(secondOwner.readNamedParameter('custom-headers')).toStrictEqual({
      'x-runtime': secondData.id,
    });
    expect(bSecondarySettings.temperature).toBe(0.4);
    expect(bSecondarySettings['auth-key']).toBe('beta-updated-key');
    expect(bSecondarySettings['base-url']).toBe(
      'https://beta.isolated.example.com',
    );
  });

  it('does not resurrect cleared auth and base-url state in runtime snapshots @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003', async () => {
    await openFirst({
      id: 'runtime-clear-state',
      profileName: 'profile-clear-state',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'primary-model',
      secondaryModel: 'secondary-model',
    });

    await activateFirst({
      runtimeId: firstData.id,
      metadata: {
        profileName: firstData.profileName,
        source: `runtime-isolation-test:${firstData.id}`,
      },
    });

    await updateActiveProviderApiKey(
      'runtime-clear-secret',
      {
        setEphemeralSetting: (key, value) =>
          firstOwner.writeUserParameter(key, value),
      },
      firstSettings,
      firstManager.getActiveProvider(),
    );
    await updateActiveProviderBaseUrl(
      'https://runtime-clear.example.com/v1',
      {
        setEphemeralSetting: (key, value) =>
          firstOwner.writeUserParameter(key, value),
      },
      firstSettings,
      firstManager.getActiveProviderName() ?? '',
    );

    expect(firstOwner.readNamedParameter('auth-key')).toBe(
      'runtime-clear-secret',
    );
    expect(firstOwner.readNamedParameter('base-url')).toBe(
      'https://runtime-clear.example.com/v1',
    );

    await updateActiveProviderApiKey(
      null,
      {
        setEphemeralSetting: (key, value) =>
          firstOwner.writeUserParameter(key, value),
      },
      firstSettings,
      firstManager.getActiveProvider(),
    );
    await updateActiveProviderBaseUrl(
      'NONE',
      {
        setEphemeralSetting: (key, value) =>
          firstOwner.writeUserParameter(key, value),
      },
      firstSettings,
      firstManager.getActiveProviderName() ?? '',
    );

    expect(firstOwner.readNamedParameter('auth-key')).toBeUndefined();
    expect(firstOwner.readNamedParameter('auth-keyfile')).toBeUndefined();
    expect(firstOwner.readNamedParameter('auth-key-name')).toBeUndefined();
    expect(firstOwner.readNamedParameter('base-url')).toBeUndefined();

    const selectedModel = firstOwner.readSelectedModel();
    if (selectedModel === undefined)
      throw new Error('Runtime fixture has no selected model');
    const runtimeSnapshot = buildRuntimeProfileSnapshot({
      providerName: firstOwner.readSelectedProvider() ?? '',
      modelName: selectedModel,
      providerSettings: firstSettings.getProviderSettings(
        firstOwner.readSelectedProvider() ?? '',
      ),
      ephemeralSettings: firstOwner.captureNamedParameters(),
    });
    expect(runtimeSnapshot.ephemeralSettings['auth-key']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['auth-keyfile']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['auth-key-name']).toBeUndefined();
    expect(runtimeSnapshot.ephemeralSettings['base-url']).toBeUndefined();
  });

  it('keeps other runtimes stable when disposing one in flight @plan:PLAN-20251018-STATELESSPROVIDER2.P14 @requirement:REQ-SP2-003 @pseudocode cli-runtime-isolation.md lines 2-3', async () => {
    await openFirst({
      id: 'runtime-a',
      profileName: 'profile-a',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'alpha-primary',
      secondaryModel: 'alpha-secondary',
    });
    await openSecond({
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
      await runWithFirst(
        barrier,
        async () => {
          await cleanupSignal.promise;
          await setActiveModel(
            'alpha-primary-post-dispose',
            assembleModelSelection(firstOwner),
            firstSettings,
            firstManager.getActiveProvider(),
          );
        },
        { delayBeforeActivationMs: 0 },
      );
      return firstSettings.getProviderSettings(firstData.primaryProvider).model;
    })();

    const taskB = (async () => {
      await runWithSecond(
        barrier,
        async () => {
          await setActiveModel(
            'beta-primary-post-dispose',
            assembleModelSelection(secondOwner),
            secondSettings,
            secondManager.getActiveProvider(),
          );
          await secondRelease.close();
          cleanupSignal.resolve();
        },
        { delayBeforeActivationMs: 5 },
      );
      return secondSettings.getProviderSettings(secondData.primaryProvider)
        .model;
    })();

    await expect(taskB).resolves.toBe('beta-primary-post-dispose');
    await expect(taskA).resolves.toBe('alpha-primary-post-dispose');
  });

  it('enforces runtime guard for ownerless provider queries @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-005 @pseudocode provider-runtime-handling.md lines 10-16', () => {
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
  });

  it('enforces explicit SettingsService for ownerless settings queries @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', () => {
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
  });

  it('prepares a stateless invocation from the explicit runtime context', async () => {
    await openFirst({
      id: 'runtime-stateless-ready',
      profileName: 'profile-ready',
      primaryProvider: 'primary',
      secondaryProvider: 'secondary',
      primaryModel: 'ready-model',
      secondaryModel: 'ready-model-2',
    });

    await activateFirst({
      runtimeId: firstData.id,
      metadata: {
        source: 'test-ensure-ready',
        statelessHardening: 'strict',
      },
    });

    const prepare = firstManager.prepareStatelessProviderInvocation;
    expect(() => prepare.call(firstManager)).not.toThrow();
  });

  it('rejects ownerless provider queries without consulting process preference', () => {
    expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
  });
});

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

let firstData: RuntimeData;
let firstTempDir: string;
let firstConfig: Config;
let firstSettings: SettingsService;
let firstOwner: SessionSettingsOwner;
let firstManager: ProviderManager;
let firstOAuth: OAuthManager;
let firstClient: Awaited<
  ReturnType<typeof createProviderSessionOwner>
>['sessionClient'];
let firstRelease: AcquisitionRelease;
async function openFirst(data: RuntimeData): Promise<void> {
  firstData = data;
  firstTempDir = await createTempDirectory();
  firstConfig = new Config({
    sessionId: data.id,
    targetDir: firstTempDir,
    cwd: firstTempDir,
    model: data.primaryModel,
    debugMode: false,
    initialSettings: {},
  });
  firstSettings = new SettingsService();
  firstOwner = new SessionSettingsOwner(firstSettings);
  firstOwner.bindTelemetry(firstConfig);
  firstRelease = new AcquisitionRelease();
  releases.push(async () => {
    await firstRelease.close();
    await firstConfig.dispose();
    await cleanupTempDirectory(firstTempDir);
  });
  firstRelease.acquire('settings', () => firstOwner.dispose());
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  firstManager = acquirePreferredProviderManager(
    firstConfig,
    firstSettings,
    firstOwner,
    files,
    data.id,
    credentials().authority,
    firstRelease,
  );
  firstManager.registerProvider(
    createStubProvider(data.primaryProvider, data.primaryModel),
  );
  firstManager.registerProvider(
    createStubProvider(data.secondaryProvider, data.secondaryModel),
  );
  const bus = new MessageBus();
  firstRelease.acquire('bus', () => bus.cancelPendingConfirmations());
  firstOAuth = acquirePreferredOAuth(
    undefined,
    bus,
    firstConfig,
    firstSettings,
    firstManager,
    data.id,
    undefined,
    credentials().authority,
    firstRelease,
    undefined,
  );
  await activateFirst();
  firstClient = (
    await createProviderSessionOwner(
      firstConfig,
      firstManager,
      firstSettings,
      firstOwner,
    )
  ).sessionClient;
}
async function activateFirst(
  input: { runtimeId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  firstManager.setRuntimeContext(
    {
      runtimeId: input.runtimeId ?? firstData.id,
      runtimeKind: 'cli-interactive',
      metadata: { profileName: firstData.profileName, ...input.metadata },
    },
    firstOwner,
    firstSettings,
    firstConfig,
  );
  prepareSelection(
    firstData,
    firstTempDir,
    firstSettings,
    firstOwner,
    firstManager,
  );
}
async function runWithFirst<T>(
  barrier: () => Promise<void>,
  action: () => Promise<T>,
  options: { delayBeforeActivationMs?: number } = {},
): Promise<T> {
  if (
    options.delayBeforeActivationMs !== undefined &&
    options.delayBeforeActivationMs !== 0
  )
    await delay(options.delayBeforeActivationMs);
  await activateFirst({
    metadata: {
      profileName: firstData.profileName,
      source: `runtime-isolation-test:${firstData.id}`,
    },
  });
  await barrier();
  return action();
}

let secondData: RuntimeData;
let secondTempDir: string;
let secondConfig: Config;
let secondSettings: SettingsService;
let secondOwner: SessionSettingsOwner;
let secondManager: ProviderManager;
let secondOAuth: OAuthManager;
let secondClient: Awaited<
  ReturnType<typeof createProviderSessionOwner>
>['sessionClient'];
let secondRelease: AcquisitionRelease;
async function openSecond(data: RuntimeData): Promise<void> {
  secondData = data;
  secondTempDir = await createTempDirectory();
  secondConfig = new Config({
    sessionId: data.id,
    targetDir: secondTempDir,
    cwd: secondTempDir,
    model: data.primaryModel,
    debugMode: false,
    initialSettings: {},
  });
  secondSettings = new SettingsService();
  secondOwner = new SessionSettingsOwner(secondSettings);
  secondOwner.bindTelemetry(secondConfig);
  secondRelease = new AcquisitionRelease();
  releases.push(async () => {
    await secondRelease.close();
    await secondConfig.dispose();
    await cleanupTempDirectory(secondTempDir);
  });
  secondRelease.acquire('settings', () => secondOwner.dispose());
  const files = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
  secondManager = acquirePreferredProviderManager(
    secondConfig,
    secondSettings,
    secondOwner,
    files,
    data.id,
    credentials().authority,
    secondRelease,
  );
  secondManager.registerProvider(
    createStubProvider(data.primaryProvider, data.primaryModel),
  );
  secondManager.registerProvider(
    createStubProvider(data.secondaryProvider, data.secondaryModel),
  );
  const bus = new MessageBus();
  secondRelease.acquire('bus', () => bus.cancelPendingConfirmations());
  secondOAuth = acquirePreferredOAuth(
    undefined,
    bus,
    secondConfig,
    secondSettings,
    secondManager,
    data.id,
    undefined,
    credentials().authority,
    secondRelease,
    undefined,
  );
  await activateSecond();
  secondClient = (
    await createProviderSessionOwner(
      secondConfig,
      secondManager,
      secondSettings,
      secondOwner,
    )
  ).sessionClient;
}
async function activateSecond(
  input: { runtimeId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  secondManager.setRuntimeContext(
    {
      runtimeId: input.runtimeId ?? secondData.id,
      runtimeKind: 'cli-interactive',
      metadata: { profileName: secondData.profileName, ...input.metadata },
    },
    secondOwner,
    secondSettings,
    secondConfig,
  );
  prepareSelection(
    secondData,
    secondTempDir,
    secondSettings,
    secondOwner,
    secondManager,
  );
}
async function runWithSecond<T>(
  barrier: () => Promise<void>,
  action: () => Promise<T>,
  options: { delayBeforeActivationMs?: number } = {},
): Promise<T> {
  if (
    options.delayBeforeActivationMs !== undefined &&
    options.delayBeforeActivationMs !== 0
  )
    await delay(options.delayBeforeActivationMs);
  await activateSecond({
    metadata: {
      profileName: secondData.profileName,
      source: `runtime-isolation-test:${secondData.id}`,
    },
  });
  await barrier();
  return action();
}

function prepareSelection(
  data: RuntimeData,
  directory: string,
  settings: SettingsService,
  owner: SessionSettingsOwner,
  manager: ProviderManager,
): void {
  manager.setActiveProvider(data.primaryProvider);
  settings.set('activeProvider', data.primaryProvider);
  settings.setCurrentProfileName(data.profileName);
  settings.setProviderSetting(data.primaryProvider, 'model', data.primaryModel);
  settings.setProviderSetting(
    data.primaryProvider,
    'base-url',
    `https://${data.id}.primary.example.com`,
  );
  settings.setProviderSetting(
    data.primaryProvider,
    'auth-key',
    `${data.id}-initial-key`,
  );
  owner.writeUserParameter(
    'base-url',
    `https://${data.id}.primary.example.com`,
  );
  owner.writeUserParameter('auth-key', `${data.id}-initial-key`);
  owner.writeUserParameter(
    'auth-keyfile',
    `${directory}/${data.id}-initial.key`,
  );
}
