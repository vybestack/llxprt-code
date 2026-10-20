import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './session-client-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { McpRuntimeOwner } from '../../mcpRuntimeAssembly.js';
import { toConfigParameters } from '../../agentConfig.adapter.js';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
import { OwnedCredentialFixture } from './owned-credential-fixture.js';
import {
  acquirePreferredProviderManager,
  acquirePreferredOAuth,
  preparePreferredProviderCompletion,
} from '../../preferred-provider-acquisition.js';
import { releaseAdoptedFileScope } from '../../adoption-release.js';
import { randomUUID } from 'node:crypto';
import {
  runCleanupSteps,
  cleanupAfterFailure,
} from '../../../core/subagent-cleanup.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { spyOn, beforeAll, afterAll } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './mcp-owner-fixture.js';
import type { AgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { createAgentRuntimeFactoryBindings } from '../../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../../confirmationForcing.js';
import { executeProviderActivation } from '../../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../../providerSwitchAssembly.js';
import { assembleModelSelection } from '../../model-selection.js';
import type {
  AgentConfig,
  ProviderActivationIntent,
} from '../../config-types.js';
import type { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import type { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import {
  OAuthManager,
  AnthropicOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { FakeProvider } from '../../../../../providers/src/fake/FakeProvider.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from '../../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { captureAgentAdoption as fromConfig } from './agent-resource-capture.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export interface RecordingRefreshBarrier {
  readonly entered: (signal: AbortSignal) => void;
  readonly body: Promise<void>;
}

type RecordingScenario = (
  agent: Agent,
  config: Config,
  settingsOwner: SessionSettingsOwner,
  settingsService: SettingsService,
  oauthManager: OAuthManager,
  borrow: () => Promise<Agent>,
  chatsDir: string,
  history: HistoryService,
  resources: {
    readonly client: AgentClientContract;
    readonly media: LocalMediaStore;
  },
) => Promise<void>;

class RecordingLifetime {
  private readonly acquiredPrefix: Array<() => void | Promise<void>> = [];
  private readonly lateResources: Array<() => void | Promise<void>> = [];
  #agents: Agent[] = [];
  #selectedOAuth!: OAuthManager;
  #restoreTransport: () => void = () => {};
  #borrowedClient!: AgentClientContract;
  #media!: LocalMediaStore;
  constructor(private readonly credentials: OwnedCredentialFixture) {}

  #config!: Config;
  #settings!: SettingsService;
  #settingsOwner!: SessionSettingsOwner;
  #policy!: RuntimePolicyOwner;
  #mcp!: McpRuntimeOwner;
  #manager!: ReturnType<typeof acquirePreferredProviderManager>;
  #owner!: SessionClientOwner;
  #close!: () => Promise<void>;
  #factories!: AgentRuntimeFactoryBindings;
  #release!: AcquisitionRelease;
  #files!: ProviderFileLifecycle;
  #runtimeId!: string;
  #oAuth!: ReturnType<typeof acquirePreferredOAuth>;
  #tokenizer!: ReturnType<typeof configureProviderTokenizer>;
  #content!: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  private async open(
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
      new URL('../fixtures/' + fixture, import.meta.url),
    );
    const acquiredDirectory = await mkdtemp(join(tmpdir(), 'caller-adoption-'));
    this.acquiredPrefix.push(() =>
      rm(acquiredDirectory, { recursive: true, force: true }),
    );
    const directory = await realpath(acquiredDirectory);
    const selection: AgentConfig = {
      provider: 'fake',
      model: 'fake-model',
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
    this.#config = new Config(parameters);
    this.acquiredPrefix.push(() => this.#config.dispose());
    this.#factories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    this.#settings = new SettingsService();
    for (const [key, value] of Object.entries(
      this.#config.getInitialSettings(),
    ))
      this.#settings.set(key, value);
    this.#policy = new RuntimePolicyOwner(this.#config);
    this.acquiredPrefix.push(() => this.#policy.dispose());
    injectConfirmationForcingPolicy(this.#policy.session.confirmation);
    this.#mcp = await buildTestMcpRuntime(
      this.#config,
      this.#policy.session.messageBus,
      overrides,
      extensionLoader,
      this.#policy,
      skillOperations,
    );
    this.acquiredPrefix.push(() => this.#mcp.dispose());
    this.acquireProviders();
    await this.complete(directory, previousReplay, selection.activation);
  }
  private async complete(
    directory: string,
    previousReplay: string | undefined,
    activation: ProviderActivationIntent | undefined,
  ): Promise<void> {
    const media = new SessionMediaOwner(
      this.#config.projectTempDir,
      1024 * 1024 * 1024,
    );
    this.#media = media.store;
    this.acquiredPrefix.push(() => media.dispose());
    this.#owner = await createCapturedSessionOwner(
      this.#config,
      assembleTaskSchemaPolicy(this.#settings),
      this.#manager,
      this.#factories.agentClientFactory,
      media.store,
      this.#mcp.readInstructions,
      this.#mcp.workspacePaths,
      this.#settingsOwner,
      this.#content,
      this.#tokenizer,
    );
    this.acquiredPrefix.push(() => this.#owner.dispose());
    this.#owner.bindMcpRuntime(this.#mcp);
    this.#owner.bindProviderFiles(this.#files, (provider) =>
      this.#oAuth.composeRetryOperations(provider),
    );
    this.#owner.bindHooks();
    const close = settleEngineRelease.bind(
      undefined,
      [
        () => this.#owner.dispose(),
        () => this.#release.close(),
        () => media.dispose(),
        () => this.#mcp.dispose(),
        () => this.#policy.dispose(),
        () => this.#config.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    let closing: Promise<void> | undefined;
    this.#close = () => (closing ??= close());

    await preparePreferredProviderCompletion(
      this.#config,
      this.#settings,
      this.#settingsOwner,
      this.#manager,
      this.#oAuth,
      this.#runtimeId,
      this.#tokenizer,
      undefined,
    );

    await this.#mcp.initialize();

    await this.activateClient(activation);
  }
  private acquireProviders(): void {
    this.#runtimeId = 'caller-' + randomUUID();
    this.#release = new AcquisitionRelease();
    this.acquiredPrefix.push(() => this.#release.rollback());
    this.#settingsOwner = new SessionSettingsOwner(this.#settings);
    this.#release.acquire('settings', () => this.#settingsOwner.dispose());
    this.#settingsOwner.initializeProviderSelection(
      this.#config.getProvider(),
      this.#config.getModel(),
    );
    this.#settingsOwner.bindTelemetry(this.#config);
    this.#files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [this.#runtimeId, this.#config.getSessionId()])
      this.#release.acquire('files', () =>
        releaseAdoptedFileScope(this.#files, scope),
      );
    this.#manager = acquirePreferredProviderManager(
      this.#config,
      this.#settings,
      this.#settingsOwner,
      this.#files,
      this.#runtimeId,
      this.credentials.authority,
      this.#release,
    );
    const factoriesTokenizer = configureProviderTokenizer(this.#manager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    this.#tokenizer = factoriesTokenizer;
    this.#content = factoriesContent;
    this.#oAuth = acquirePreferredOAuth(
      undefined,
      this.#policy.session.messageBus,
      this.#config,
      this.#settings,
      this.#manager,
      this.#runtimeId,
      this.#mcp.profileDefinitions,
      this.credentials.authority,
      this.#release,
      undefined,
    );
  }
  private async activateClient(
    intent: ProviderActivationIntent = {
      provider: this.#config.getProvider(),
      model: this.#config.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      this.#config,
      intent,
      assembleProviderSwitch(
        this.#config,
        this.#settings,
        this.#manager,
        this.#oAuth,
        () => 'agent',
        () => this.#owner.refreshAuth(),
        this.#settingsOwner,
      ),
      this.#settings,
      this.#manager,
      (method) => this.#owner.refreshAuth(method),
      assembleModelSelection(this.#settingsOwner),
    );
    requireCallerActivation(activation);
    await this.#owner.initializeTools();
    await capturedSessionClient(this.#owner).startChat();
  }

  private async pauseRefresh(barrier: RecordingRefreshBarrier): Promise<void> {
    const manager = this.#manager;

    const provider = new FakeProvider(
      fileURLToPath(
        new URL('../fixtures/multi-turn-text.jsonl', import.meta.url),
      ),
      this.#config.getTargetDir(),
    );
    provider.name = 'claudecode';
    provider.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
    manager.registerProvider(provider);
    const store = new MemoryTokenStore();
    await store.saveToken(
      'claudecode',
      makeExpiredToken('recording-refresh'),
      'primary',
    );
    const oauth = new OAuthManager(store, undefined, {
      config: this.#config,
      messageBus: this.#policy.session.messageBus,
    });
    this.lateResources.push(() => oauth.dispose());
    const transport = spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init): Promise<Response> => {
        if (
          String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
          !(init?.body instanceof URLSearchParams) ||
          init.body.get('grant_type') !== 'refresh_token' ||
          !init.signal
        )
          throw new Error(`Unexpected provider request: ${String(input)}`);
        const signal = init.signal;
        return new Response(
          new ReadableStream<Uint8Array>({
            async start(controller): Promise<void> {
              barrier.entered(signal);
              await barrier.body;
              controller.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    access_token: 'recording-rotated',
                    refresh_token: 'recording-rotated-refresh',
                    expires_in: 120,
                  }),
                ),
              );
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    );
    this.#restoreTransport = () => transport.mockRestore();
    oauth.registerProvider(new AnthropicOAuthProvider(globalThis.fetch, store));
    await oauth.toggleOAuthEnabled('claudecode');
    this.#owner.bindProviderFiles(this.#files, (provider) =>
      oauth.composeRetryOperations(provider),
    );
    this.#selectedOAuth = oauth;
    this.#restoreTransport = () => transport.mockRestore();
  }
  private borrow = async (): Promise<Agent> => {
    const agent = await fromConfig(
      this.#config,
      this.#settings,
      { sessionId: randomUUID() + '-recording-lifetime' },
      undefined,
      this.#manager,
      this.#selectedOAuth,
      this.#policy.session.messageBus,
      this.#mcp,
      undefined,
      this.#borrowedClient,
      this.#files,
    );
    this.#agents.push(agent);
    return agent;
  };
  async run(
    scenario: RecordingScenario,
    refreshBarrier: RecordingRefreshBarrier | undefined,
    overrides: Readonly<Partial<AgentConfig>>,
    fixture: string,
  ): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    try {
      await this.open(fixture, overrides);
    } catch (primary) {
      await cleanupAfterFailure(primary, () =>
        settleEngineRelease([...this.acquiredPrefix].reverse(), previousReplay),
      );
    }
    const failures: unknown[] = [];
    try {
      this.#selectedOAuth = this.#oAuth;
      this.#borrowedClient = capturedSessionClient(this.#owner);
      if (refreshBarrier) await this.pauseRefresh(refreshBarrier);
      const history = this.#borrowedClient.getChat().getHistoryService();
      if (history === null)
        throw new Error('Recording fixture requires initialized history');
      await scenario(
        await this.borrow(),
        this.#config,
        this.#settingsOwner,
        this.#settings,
        this.#selectedOAuth,
        this.borrow,
        this.#config.projectChatsDir,
        history,
        { client: this.#borrowedClient, media: this.#media },
      );
    } catch (error) {
      failures.push(error);
    } finally {
      for (const step of [
        ...[...this.#agents]
          .reverse()
          .map((agent) => () => disposeRecordingAgent(agent)),
        ...this.lateResources,
        this.#close,
        () => rm(this.#config.projectTempDir, { recursive: true, force: true }),
        async () => this.#restoreTransport(),
      ]) {
        try {
          await step();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Recording lifetime fixture failed');
  }
}

async function settleFixtureSteps(
  steps: ReadonlyArray<() => Promise<void> | void>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Recording lifetime fixture cleanup failed',
    );
}

async function disposeRecordingAgent(agent: Agent): Promise<void> {
  await settleFixtureSteps([
    async () => {
      if (agent.session.getRecording().enabled)
        await agent.session.setRecording({ enabled: false });
    },
    () => agent.dispose(),
  ]);
}

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

export function useRecordingPrompts(): void {
  let directory: string;
  let previous: string | undefined;
  beforeAll(async () => {
    previous = process.env.LLXPRT_PROMPTS_DIR;
    directory = await mkdtemp(join(tmpdir(), 'recording-caller-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = directory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
}

export async function withRecordingLifetimeFixture(
  scenario: RecordingScenario,
  refreshBarrier?: RecordingRefreshBarrier,
  overrides: Readonly<Partial<AgentConfig>> = {},
  fixture = 'multi-turn-text.jsonl',
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'recording-caller-home-'));
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  process.env.LLXPRT_CONFIG_HOME = home;
  try {
    await writeFile(
      join(home, 'settings.json'),
      JSON.stringify({ oauthEnabledProviders: { codex: true } }),
    );
    const credentials = await OwnedCredentialFixture.create();
    try {
      await new RecordingLifetime(credentials).run(
        scenario,
        refreshBarrier,
        overrides,
        fixture,
      );
    } catch (primary) {
      await cleanupAfterFailure(primary, () => credentials.dispose());
    }
    await credentials.dispose();
  } finally {
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
}

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
