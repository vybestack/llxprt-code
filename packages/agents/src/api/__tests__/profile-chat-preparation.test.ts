/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  createCapturedSessionOwner,
  ownerClients,
} from './helpers/session-client-capture.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService, Profile } from '@vybestack/llxprt-code-settings';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../agentConfig.adapter.js';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AcquisitionRelease } from '@vybestack/llxprt-code-core/lifecycle/acquisition-release.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { preparePreferredProviderCompletion } from '../preferred-provider-acquisition.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
} from './helpers/provider-acquisition.js';
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
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { buildAgentClientFactory } from '../agentBootstrap.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { AgentConfig } from '../config-types.js';
import {
  setup,
  deferred,
  installIdeCleanup,
} from './helpers/ide-lifecycle-companion.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { openRouteBPreflight } from './helpers/route-b-preflight.js';
import type { Agent } from '../agent.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';

const INITIAL_PROVIDER = 'recording-initial';
const REPLACEMENT_PROVIDER = 'replacement';

/** Both registries' provider factories and aliases, as one registry a host passes. */
function combineContributions(
  first: ProviderContributionRegistry,
  second: ProviderContributionRegistry,
): ProviderContributionRegistry {
  return {
    getProviderFactory: (id) =>
      first.getProviderFactory(id) ?? second.getProviderFactory(id),
    getProviderOrigin: (id) =>
      first.getProviderOrigin(id) ?? second.getProviderOrigin(id),
    listProviderIds: () => [
      ...new Set([...first.listProviderIds(), ...second.listProviderIds()]),
    ],
    getContributedAliases: () => [
      ...first.getContributedAliases(),
      ...second.getContributedAliases(),
    ],
    getMcpAuthFactories: () => [
      ...first.getMcpAuthFactories(),
      ...second.getMcpAuthFactories(),
    ],
  };
}

/**
 * An agent built through the foreground preflight route with two contributed
 * providers: the one it starts on and the one a profile replaces it with.
 */
async function openAgentWithReplacementProvider(): Promise<{
  readonly agent: Agent;
  readonly config: Config;
  readonly close: () => Promise<void>;
}> {
  const route = await openRouteBPreflight({
    contributions: combineContributions(
      createRecordingProvider({ alias: INITIAL_PROVIDER }).contributions,
      createRecordingProvider({ alias: REPLACEMENT_PROVIDER }).contributions,
    ),
    config: { provider: INITIAL_PROVIDER, model: 'recording-default' },
  });
  let agent: Agent | undefined;
  const close = (): Promise<void> =>
    runCleanupSteps([() => agent?.dispose(), () => route.close()]);
  try {
    await route.prepare();
    agent = await route.createAgent({
      provider: INITIAL_PROVIDER,
      model: 'recording-default',
    });
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
  return { agent, config: route.config, close };
}

async function streamWithoutError(agent: Agent, text: string): Promise<void> {
  for await (const event of agent.stream(text)) {
    if (event.type === 'error') throw new Error(event.error.message);
  }
}

describe('profile-chat-preparation', () => {
  installIdeCleanup();
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

  it.each([false, true])(
    'preserves chat, history and IDE view after failed replacement (initialized: %s)',
    async (initialized) => {
      const host = await setup();
      const closers: Array<() => Promise<void>> = [];
      try {
        const built = await openAgentWithReplacementProvider();
        closers.push(built.close);
        const other = await openAgentWithReplacementProvider();
        closers.push(other.close);
        const agent = built.agent;
        const ownerB = other.agent;
        agent.ide.setIdeMode(true);
        await agent.ide.setIdeClientConnected();
        const contextArrived = deferred();
        const unsubscribe = agent.ide.subscribeContext((context) => {
          if (
            context?.workspaceState?.openFiles?.[0]?.path ===
            '/workspace/kept-editor.ts'
          )
            contextArrived.resolve();
        });
        await host.updateContext(0, {
          workspaceState: {
            openFiles: [
              {
                path: '/workspace/kept-editor.ts',
                timestamp: 1,
                isActive: true,
              },
            ],
          },
        });
        await contextArrived.promise;
        unsubscribe();
        if (initialized) {
          await streamWithoutError(agent, 'carried context');
        } else {
          await agent.setHistory([
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'carried context' }],
            },
          ]);
        }
        const history = await agent.getHistory();
        const beforeB = ownerB.captureProfile();
        const profile: Profile = {
          version: 1,
          provider: REPLACEMENT_PROVIDER,
          model: 'candidate',
          modelParams: {},
          ephemeralSettings: {},
        };
        let reads = 0;
        const failure = new Error('loop boundary after chat preparation');
        const boundary = vi
          .spyOn(built.config, 'isInteractive')
          .mockImplementation(() => {
            if (++reads === 3) throw failure;
            return true;
          });
        try {
          await expect(agent.profiles.applySnapshot(profile)).rejects.toBe(
            failure,
          );
          boundary.mockRestore();
          expect(reads).toBe(3);
          expect(await agent.getHistory()).toStrictEqual(history);
          expect(ownerB.captureProfile()).toStrictEqual(beforeB);
          const eventsB = [];
          for await (const event of ownerB.stream('owner B still works'))
            eventsB.push(event);
          expect(eventsB.some((event) => event.type === 'error')).toBe(false);
          const events = [];
          for await (const event of agent.stream('continue carried context'))
            events.push(event);
          expect(events.some((event) => event.type === 'error')).toBe(false);
          const recoveredHistory = JSON.stringify(await agent.getHistory());
          expect(recoveredHistory).toContain('carried context');
          expect(
            recoveredHistory.split('/workspace/kept-editor.ts').length - 1,
          ).toBe(1);
          await agent.profiles.applySnapshot(profile);
          expect(agent.getProvider()).toBe(REPLACEMENT_PROVIDER);
          expect(agent.getModel()).toBe('candidate');
        } finally {
          boundary.mockRestore();
        }
      } finally {
        await runCleanupSteps(closers.reverse());
      }
    },
    30000,
  );

  it('disposal after candidate chat creation discards the owned candidate', async () => {
    const built = await openAgentWithReplacementProvider();
    const agent = built.agent;
    let disposal: Promise<void> | undefined;
    try {
      await agent.setHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'still owned by caller' }],
        },
      ]);
      let reads = 0;
      const boundary = vi
        .spyOn(built.config, 'isInteractive')
        .mockImplementation(() => {
          if (++reads === 3) disposal = agent.dispose();
          return true;
        });
      try {
        await expect(
          agent.profiles.applySnapshot({
            version: 1,
            provider: REPLACEMENT_PROVIDER,
            model: 'discarded',
            modelParams: {},
            ephemeralSettings: {},
          }),
        ).rejects.toThrow('cancelled');
        boundary.mockRestore();
        expect(disposal).toBeDefined();
        await disposal;
      } finally {
        boundary.mockRestore();
      }
    } finally {
      await disposal;
      await built.close();
    }
  }, 30000);

  describe('session client owner', () => {
    useFakeResponsesReplay('multi-turn-text.jsonl');
    const builtCredentials = useOwnedCredentials();
    let builtCallerConfig: Config;
    let builtCallerSettings: SettingsService;
    let builtCallerSettingsOwner: SessionSettingsOwner;
    let builtCallerPolicy: RuntimePolicyOwner;
    let builtCallerMcp: McpRuntimeOwner;
    let builtCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
    let builtCallerOwner: SessionClientOwner;
    let builtCallerClose: () => Promise<void>;
    let builtCallerRelease: AcquisitionRelease;
    let builtCallerFiles: ProviderFileLifecycle;
    let builtCallerRuntimeId: string;
    let builtCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
    let builtCallerTokenizer: ReturnType<typeof configureProviderTokenizer>;
    let builtCallerContent: ReturnType<
      typeof createRuntimeContentGeneratorFactory
    >;

    async function openbuiltCaller(): Promise<void> {
      const directory = await realpath(
        await mkdtemp(join(tmpdir(), 'builtCaller-owner-')),
      );
      const selection: AgentConfig = {
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      };
      const parameters = {
        ...toConfigParameters(selection),
        interactive: true,
      };
      builtCallerConfig = new Config({
        ...parameters,
        includeDirectories: [
          ...(parameters.includeDirectories ?? []),
          process.cwd(),
        ],
      });
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
        selection,
        undefined,
        builtCallerPolicy,
        undefined,
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
        buildAgentClientFactory(),
        media.store,
        builtCallerMcp.readInstructions,
        builtCallerMcp.workspacePaths,
        builtCallerSettingsOwner,
        builtCallerContent,
        builtCallerTokenizer,
      );
      builtCallerOwner.bindMcpRuntime(builtCallerMcp);
      builtCallerOwner.clients.bindProviderFiles(builtCallerFiles, (provider) =>
        builtCallerOAuth.composeRetryOperations(provider),
      );
      builtCallerOwner.bindHooks();
      builtCallerClose = (): Promise<void> =>
        runCleanupSteps([
          () => builtCallerOwner.dispose(),
          () => builtCallerRelease.close(),
          () => media.dispose(),
          () => builtCallerMcp.dispose(),
          () => builtCallerConfig.dispose(),
          () => rm(directory, { recursive: true, force: true }),
        ]);
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
          process.env.LLXPRT_FAKE_RESPONSES,
        );
        await builtCallerMcp.initialize();
        await activatebuiltCallerClient();
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
      builtCallerTokenizer = configureProviderTokenizer(builtCallerManager);
      builtCallerContent = createRuntimeContentGeneratorFactory();
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
    async function activatebuiltCallerClient(): Promise<void> {
      const activation = await executeProviderActivation(
        builtCallerConfig,
        {
          provider: builtCallerConfig.getProvider(),
          model: builtCallerConfig.getModel(),
        },
        assembleProviderSwitch(
          builtCallerConfig,
          builtCallerSettings,
          builtCallerManager,
          builtCallerOAuth,
          () => 'agent',
          () => builtCallerOwner.clients.refreshAuth(),
          builtCallerSettingsOwner,
        ),
        builtCallerSettings,
        builtCallerManager,
        (method) => builtCallerOwner.clients.refreshAuth(method),
        assembleModelSelection(builtCallerSettingsOwner),
      );
      if (activation.authFailed) throw activation.authError;
      await builtCallerOwner.initializeTools();
      const clients = ownerClients(builtCallerOwner);
      await clients[clients.length - 1].startChat();
    }

    /**
     * Counts the model-change subscriptions handed out and still live,
     * through the owner's public `subscribeModelChanges`.
     */
    function trackModelSubscriptions(owner: SessionSettingsOwner): {
      readonly opened: () => number;
      readonly live: () => number;
    } {
      const subscribe = owner.subscribeModelChanges.bind(owner);
      let opened = 0;
      let live = 0;
      owner.subscribeModelChanges = (listener) => {
        const release = subscribe(listener);
        opened++;
        live++;
        let released = false;
        return () => {
          release();
          if (!released) {
            released = true;
            live--;
          }
        };
      };
      return { opened: () => opened, live: () => live };
    }

    it.each(['fails', 'is cancelled'] as const)(
      'discards the candidate client model subscription when profile execution preparation %s',
      async (mode) => {
        await openbuiltCaller();
        try {
          builtCallerOwner.clients.initializeExecution(
            undefined,
            undefined,
            undefined,
          );
          const subscriptions = trackModelSubscriptions(
            builtCallerSettingsOwner,
          );
          const controller = new AbortController();
          const failure = new Error('loop boundary after chat preparation');
          let reads = 0;
          const boundary = vi
            .spyOn(builtCallerConfig, 'isInteractive')
            .mockImplementation(() => {
              if (++reads === 2) {
                if (mode === 'fails') throw failure;
                controller.abort(failure);
              }
              return true;
            });
          try {
            await expect(
              builtCallerOwner.clients.prepareProfileExecution(
                true,
                controller.signal,
                async () => undefined,
              ),
            ).rejects.toBe(failure);
          } finally {
            boundary.mockRestore();
          }
          expect(subscriptions.opened()).toBe(1);
          expect(subscriptions.live()).toBe(0);
        } finally {
          await builtCallerClose();
        }
      },
      30000,
    );
  });
});
