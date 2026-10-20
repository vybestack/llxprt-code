import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  Config,
  ConfigParameters,
} from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import {
  ProviderFileLifecycle,
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../core/subagent-cleanup.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import {
  createAgentRuntimeFactoryBindings,
  AgentRuntimeFactoryBindings,
} from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { buildRuntimeProfileSnapshot } from '../profileSnapshot.js';
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';

import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { CoreEvent } from '@vybestack/llxprt-code-core/utils/events.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  MemoryTokenStore,
  makeToken,
} from './helpers/provider-auth-fixtures.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function originalCauses(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(originalCauses)
    : [error];
}

describe('profile-commit-publication', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });

  const builtCredentials = useOwnedCredentials();
  let builtCallerConfig: Config;
  let builtCallerSettings: SettingsService;
  let builtCallerSettingsOwner: SessionSettingsOwner;
  let builtCallerPolicy: RuntimePolicyOwner;
  let builtCallerMcp: McpRuntimeOwner;
  let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let builtCallerOwner: SessionClientOwner;
  let builtCallerClose: () => Promise<void>;
  let builtCallerFactories: AgentRuntimeFactoryBindings;
  let builtCallerRelease: AcquisitionRelease;
  let builtCallerFiles: ProviderFileLifecycle;
  let builtCallerRuntimeId: string;
  let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let builtCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let builtCallerContent: ReturnType<
    typeof createRuntimeContentGeneratorFactory
  >;

  async function openbuiltCaller(
    fixture: string,
    overrides: Readonly<Partial<AgentConfig>> = {},
    suppliedFactories: Readonly<Partial<AgentRuntimeFactoryBindings>> = {},
    skillSettings: Pick<
      ConfigParameters,
      'enableExtensionReloading' | 'storageRoot'
    > = {},
    extensionLoader?: ExtensionLoader,
    skillOperations?: WorkspaceSkillAssemblyOperations,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'builtCaller-adoption-')),
    );
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
      sessionId: randomUUID(),
      ...overrides,
      workingDir:
        overrides.workingDir === undefined
          ? directory
          : await realpath(overrides.workingDir),
    };
    const parameters = { ...toConfigParameters(selection), ...skillSettings };
    parameters.interactive = true;
    if (overrides.hooks !== undefined) parameters.enableHooks = true;
    if (
      overrides.filesystemOwner === undefined &&
      (overrides.harness?.includeProcessCwd ?? true)
    )
      parameters.includeDirectories = [
        ...(parameters.includeDirectories ?? []),
        process.cwd(),
      ];
    builtCallerConfig = new Config(parameters);
    builtCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    builtCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      builtCallerConfig.getInitialSettings(),
    ))
      builtCallerSettings.set(key, value);
    builtCallerPolicy = new RuntimePolicyOwner(builtCallerConfig);
    injectConfirmationForcingPolicy(builtCallerPolicy.session.confirmation);
    builtCallerMcp = await buildTestMcpRuntime(
      builtCallerConfig,
      builtCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      builtCallerPolicy,
      skillOperations,
    );
    acquirebuiltCallerProviders();
    const media = new SessionMediaOwner(
      builtCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    builtCallerOwner = await createCapturedSessionOwner(
      builtCallerConfig,
      assembleTaskSchemaPolicy(builtCallerSettings),
      builtCallerManager,
      builtCallerFactories.agentClientFactory,
      media.store,
      builtCallerMcp.readInstructions,
      builtCallerMcp.workspacePaths,
      builtCallerSettingsOwner,
      builtCallerContent,
      builtCallerTokenizer,
    );
    builtCallerOwner.bindMcpRuntime(builtCallerMcp);
    builtCallerOwner.bindProviderFiles(builtCallerFiles, (provider) =>
      builtCallerOAuth.composeRetryOperations(provider),
    );
    builtCallerOwner.bindHooks();
    builtCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => builtCallerOwner.dispose(),
        () => builtCallerRelease.close(),
        () => media.dispose(),
        () => builtCallerMcp.dispose(),
        () => builtCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerRuntimeId,
        builtCallerTokenizer,
        undefined,
      );
      await builtCallerMcp.initialize();
      await activatebuiltCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, builtCallerClose);
    }
  }
  function acquirebuiltCallerProviders(): void {
    builtCallerRuntimeId = 'builtCaller-' + randomUUID();
    builtCallerRelease = new AcquisitionRelease();
    builtCallerSettingsOwner = new SessionSettingsOwner(builtCallerSettings);
    builtCallerRelease.acquire('settings', () =>
      builtCallerSettingsOwner.dispose(),
    );
    builtCallerSettingsOwner.initializeProviderSelection(
      builtCallerConfig.getProvider(),
      builtCallerConfig.getModel(),
    );
    builtCallerSettingsOwner.bindTelemetry(builtCallerConfig);
    builtCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [
      builtCallerRuntimeId,
      builtCallerConfig.getSessionId(),
    ])
      builtCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(builtCallerFiles, scope),
      );
    builtCallerManager = acquirePreferredProviderManager(
      builtCallerConfig,
      builtCallerSettings,
      builtCallerSettingsOwner,
      builtCallerFiles,
      builtCallerRuntimeId,
      builtCredentials().authority,
      builtCallerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(builtCallerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    builtCallerTokenizer = factoriesTokenizer;
    builtCallerContent = factoriesContent;
    builtCallerOAuth = acquirePreferredOAuth(
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerConfig,
      builtCallerSettings,
      builtCallerManager,
      builtCallerRuntimeId,
      builtCallerMcp.profileDefinitions,
      builtCredentials().authority,
      builtCallerRelease,
      undefined,
    );
  }
  async function activatebuiltCallerClient(
    intent: ProviderActivationIntent = {
      provider: builtCallerConfig.getProvider(),
      model: builtCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      builtCallerConfig,
      intent,
      assembleProviderSwitch(
        builtCallerConfig,
        builtCallerSettings,
        builtCallerManager,
        builtCallerOAuth,
        () => 'agent',
        () => builtCallerOwner.refreshAuth(),
        builtCallerSettingsOwner,
      ),
      builtCallerSettings,
      builtCallerManager,
      (method) => builtCallerOwner.refreshAuth(method),
      assembleModelSelection(builtCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await builtCallerOwner.initializeTools();
    await capturedSessionClient(builtCallerOwner).startChat();
  }

  it.each([false, true])(
    'retains committed state and retires both old subscriptions (removal throws: %s)',
    async (removalThrows) => {
      await openbuiltCaller('multi-turn-text.jsonl');
      const ownerModels = builtCallerSettingsOwner[
        'modelNotifications'
      ].listeners(CoreEvent.ModelChanged);
      const ownerProfiles = builtCallerSettingsOwner[
        'modelNotifications'
      ].listeners(CoreEvent.ModelProfileChanged);
      const agent = await fromConfig(
        builtCallerConfig,
        builtCallerSettings,
        {},
        builtCallerSettingsOwner,
        builtCallerManager,
        builtCallerOAuth,
        builtCallerPolicy.session.messageBus,
        builtCallerMcp,
        undefined,
        undefined,
        builtCallerFiles,
      );
      const manager = builtCallerManager;

      const alternative = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        builtCallerConfig.getTargetDir(),
      );
      alternative.name = 'alternative';
      alternative.baseProviderConfig = {
        baseURL: 'https://alternative.invalid',
      };
      manager.registerProvider(alternative);
      const oldModels = builtCallerSettingsOwner['modelNotifications']
        .listeners(CoreEvent.ModelChanged)
        .filter((listener) => !ownerModels.includes(listener));
      const oldProfiles = builtCallerSettingsOwner['modelNotifications']
        .listeners(CoreEvent.ModelProfileChanged)
        .filter((listener) => !ownerProfiles.includes(listener));
      const resources = fixtureAgentResources(agent);
      await resources.publishedClient(agent).startChat();
      await resources.readObservedHistory(agent);
      const priorClient = resources.historyReaders
        .slice(-1)
        .values()
        .next().value;
      if (priorClient === undefined)
        throw new Error('Expected an actual native history receiver');
      const history = priorClient.getHistoryService();
      const modelError = new Error('model listener failed');
      const profileError = new Error('profile listener failed');
      const removalError = new Error('old model removal failed');
      const onModel = (): never => {
        throw modelError;
      };
      const onProfile = (): never => {
        throw profileError;
      };
      let removalFailed = false;
      const onRemove = (
        event: string | symbol,
        listener: (...args: unknown[]) => void,
      ): void => {
        if (
          removalThrows &&
          !removalFailed &&
          event === CoreEvent.ModelChanged &&
          oldModels.includes(listener)
        ) {
          removalFailed = true;
          throw removalError;
        }
      };
      builtCallerSettingsOwner['modelNotifications'].on(
        CoreEvent.ModelChanged,
        onModel,
      );
      builtCallerSettingsOwner['modelNotifications'].on(
        CoreEvent.ModelProfileChanged,
        onProfile,
      );
      builtCallerSettingsOwner['modelNotifications'].addListener(
        'removeListener',
        onRemove,
      );
      try {
        const outcome = await agent.profiles
          .applySnapshot({
            version: 1,
            provider: 'alternative',
            model: 'committed-after-listener-error',
            modelParams: {},
            ephemeralSettings: {},
          })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        expect(outcome).toHaveProperty('error.committed', true);
        expect(outcome).toHaveProperty(
          'error.result.modelName',
          'committed-after-listener-error',
        );
        if (!('error' in outcome))
          throw new Error('Expected committed failure');
        expect(originalCauses(outcome.error)).toContain(modelError);
        expect(originalCauses(outcome.error)).toContain(profileError);
        expect(originalCauses(outcome.error).includes(removalError)).toBe(
          removalThrows,
        );
        for (const listener of oldModels)
          expect(
            builtCallerSettingsOwner['modelNotifications'].listeners(
              CoreEvent.ModelChanged,
            ),
          ).not.toContain(listener);
        for (const listener of oldProfiles)
          expect(
            builtCallerSettingsOwner['modelNotifications'].listeners(
              CoreEvent.ModelProfileChanged,
            ),
          ).not.toContain(listener);
        expect(fixtureAgentResources(agent).publishedClient(agent)).not.toBe(
          priorClient,
        );
        expect(
          fixtureAgentResources(agent)
            .publishedClient(agent)
            .getHistoryService(),
        ).toBe(history);
        expect(agent.getModel()).toBe('committed-after-listener-error');
        expect(agent.profiles.isApplying()).toBe(false);
        builtCallerSettingsOwner['modelNotifications'].off(
          CoreEvent.ModelChanged,
          onModel,
        );
        builtCallerSettingsOwner['modelNotifications'].off(
          CoreEvent.ModelProfileChanged,
          onProfile,
        );
        builtCallerSettingsOwner['modelNotifications'].removeListener(
          'removeListener',
          onRemove,
        );
        await agent.profiles.applySnapshot({
          version: 1,
          provider: 'alternative',
          model: 'recovered',
          modelParams: {},
          ephemeralSettings: {},
        });
        const events = [];
        for await (const event of agent.stream(
          'continue after notification failure',
          { mcpDiscovery: 'skip' },
        ))
          events.push(event);
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter((event) => event.type === 'done')).toStrictEqual([
          { type: 'done', reason: 'stop' },
        ]);
      } finally {
        builtCallerSettingsOwner['modelNotifications'].off(
          CoreEvent.ModelChanged,
          onModel,
        );
        builtCallerSettingsOwner['modelNotifications'].off(
          CoreEvent.ModelProfileChanged,
          onProfile,
        );
        builtCallerSettingsOwner['modelNotifications'].removeListener(
          'removeListener',
          onRemove,
        );
        await agent.dispose();
        await builtCallerConfig.dispose();
        await builtCallerClose();
      }
    },
    30000,
  );

  it('rolls back supported active-provider loss after model selection', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerMcp,
      undefined,
      capturedSessionClient(builtCallerOwner),
    );
    const settings = builtCallerSettings;
    const manager = builtCallerManager;
    if (!(manager instanceof ProviderManager))
      throw new Error('Expected real provider manager');
    const priorProvider = manager.getActiveProviderName();
    if (priorProvider === undefined)
      throw new Error('Expected an active caller provider');
    const priorSettings = structuredClone(
      settings.getProviderSettings(priorProvider),
    );
    const priorModel = priorSettings.model;
    if (typeof priorModel !== 'string')
      throw new Error('Expected a configured caller model');
    const before = buildRuntimeProfileSnapshot({
      providerName: priorProvider,
      modelName: priorModel,
      providerSettings: priorSettings,
      ephemeralSettings: structuredClone(
        builtCallerSettingsOwner.captureUserParameters(),
      ),
    });
    const interrupt = (event: { key: string; newValue: unknown }): void => {
      if (event.key === 'temperature' && event.newValue === 0.25)
        manager.clearActiveProvider();
    };
    settings.on('provider-change', interrupt);
    try {
      await expect(
        agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'late-loss',
          modelParams: { temperature: 0.25 },
          ephemeralSettings: {},
        }),
      ).rejects.toThrow('Active provider "fake" is not registered');
      expect(agent.captureProfile()).toStrictEqual(before);
      expect(agent.getProvider()).toBe('fake');
      expect(agent.profiles.isApplying()).toBe(false);
    } finally {
      settings.off('provider-change', interrupt);
      await agent.dispose();
      await builtCallerClose();
    }
  }, 30000);

  it('keeps the previous real loop runnable after replacement construction fails', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const previous = builtCallerOwner.initializeExecution(
        undefined,
        undefined,
        undefined,
      );
      const rebuild = (): void => builtCallerOwner.rebuildExecution();
      const controller = new AbortController();
      const failure = new Error('replacement loop configuration failed');
      const interactive = vi
        .spyOn(builtCallerConfig, 'isInteractive')
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        expect(rebuild).toThrow(failure);
      } finally {
        interactive.mockRestore();
      }
      const events = [];
      for await (const event of previous.run(
        'prior loop remains usable',
        controller.signal,
      ))
        events.push(event);
      expect(events.some((event) => event.kind === 'stream')).toBe(true);
    } finally {
      await builtCallerClose();
    }
  }, 30000);

  it('retains renewal schedules and publishes no profile success when real loop preparation fails', async () => {
    await openbuiltCaller('multi-turn-text.jsonl');
    const store = new MemoryTokenStore();
    const oauth = new OAuthManager(store, undefined, {
      config: builtCallerConfig,
      messageBus: builtCallerPolicy.session.messageBus,
    });
    oauth.registerProvider({
      name: 'fake',
      initiateAuth: async () => {
        throw new Error('Unexpected interactive auth');
      },
      getToken: async () => null,
      refreshToken: async (token) => ({
        ...token,
        access_token: `${token.access_token}-renewed`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    await oauth.toggleOAuthEnabled('fake');
    const agent = await fromConfig(
      builtCallerConfig,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      builtCallerPolicy.session.messageBus,
      builtCallerMcp,
      undefined,
      capturedSessionClient(builtCallerOwner),
    );
    const models: string[] = [];
    const profiles: unknown[] = [];
    const onModel = (model: string): void => {
      models.push(model);
    };
    const onProfile = (profile: unknown): void => {
      profiles.push(profile);
    };
    builtCallerSettingsOwner['modelNotifications'].on(
      CoreEvent.ModelChanged,
      onModel,
    );
    builtCallerSettingsOwner['modelNotifications'].on(
      CoreEvent.ModelProfileChanged,
      onProfile,
    );
    const initialModel = builtCallerSettings.getProviderSettings('fake').model;
    if (typeof initialModel !== 'string')
      throw new Error('Expected the configured caller model');
    try {
      const initialEvents = [];
      for await (const event of agent.stream('remember the prior conversation'))
        initialEvents.push(event);
      expect(initialEvents.some((event) => event.type === 'error')).toBe(false);
      const priorNativeClient = capturedSessionClient(builtCallerOwner);
      const priorHistory = await priorNativeClient.getHistory();
      expect(priorHistory.length).toBeGreaterThan(0);
      vi.useFakeTimers();
      for (const bucket of ['old', 'replacement']) {
        await store.saveToken(
          'fake',
          makeToken(bucket, { expiresInSec: 600 }),
          bucket,
        );
      }
      await oauth.configureProactiveRenewalsForProfile({
        provider: 'fake',
        auth: { type: 'oauth', buckets: ['old'] },
      });
      oauth.setSessionBucket('fake', 'old');
      const failure = new Error('loop configuration unavailable');
      const interactive = vi
        .spyOn(builtCallerConfig, 'isInteractive')
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        await expect(
          agent.profiles.applySnapshot(
            {
              version: 1,
              provider: 'fake',
              model: 'replacement-model',
              modelParams: {},
              ephemeralSettings: {},
              auth: { type: 'oauth', buckets: ['replacement'] },
            },
            { profileName: 'replacement' },
          ),
        ).rejects.toBe(failure);
      } finally {
        interactive.mockRestore();
      }
      expect(agent.getModel()).toBe(initialModel);
      expect(oauth.getSessionBucket('fake')).toBe('old');
      expect(agent.profiles.isApplying()).toBe(false);
      await advanceTimersByTimeAsync(305000);
      expect((await store.getToken('fake', 'old'))?.access_token).toBe(
        'old-renewed',
      );
      expect((await store.getToken('fake', 'replacement'))?.access_token).toBe(
        'replacement',
      );
      expect(profiles).toStrictEqual([]);
      expect(models).toStrictEqual([]);
      vi.useRealTimers();
      expect(await agent.getHistory()).toStrictEqual(priorHistory);
      const recoveredEvents = [];
      for await (const event of agent.stream('continue on the prior profile'))
        recoveredEvents.push(event);
      expect(recoveredEvents.some((event) => event.type === 'error')).toBe(
        false,
      );
      expect(recoveredEvents.some((event) => event.type === 'done')).toBe(true);
      await agent.profiles.applySnapshot(
        {
          version: 1,
          provider: 'fake',
          model: 'committed-model',
          modelParams: {},
          ephemeralSettings: {},
        },
        { profileName: 'committed' },
      );
      expect(agent.getModel()).toBe('committed-model');
      expect(profiles).toHaveLength(1);
      expect(models).toStrictEqual(['committed-model']);
    } finally {
      builtCallerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelChanged,
        onModel,
      );
      builtCallerSettingsOwner['modelNotifications'].off(
        CoreEvent.ModelProfileChanged,
        onProfile,
      );
      vi.useRealTimers();
      await agent.dispose();
      await builtCallerClose();
    }
  }, 30000);
});

async function settleEngineRelease(
  steps: ReadonlyArray<() => void | Promise<void>>,
  previousReplay: string | undefined,
): Promise<void> {
  try {
    await runCleanupSteps(steps);
  } finally {
    if (previousReplay === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousReplay;
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
