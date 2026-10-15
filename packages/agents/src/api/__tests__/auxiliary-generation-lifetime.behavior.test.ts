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
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
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
import { AgentConfig, ProviderActivationIntent } from '../config-types.js';
import { ExtensionLoader } from '@vybestack/llxprt-code-core/utils/extensionLoader.js';
import { WorkspaceSkillAssemblyOperations } from '@vybestack/llxprt-code-core/config/skill-tool-sync.js';
import { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import { fromConfig } from '../fromConfig.js';
import { gate } from './helpers/recording-finalizer-join-fixture.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function contents(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'Generate a value' }] },
  ];
}

describe('auxiliary generation lifetime', () => {
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
  let builtCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let builtCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

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
    builtCallerOwner = await SessionClientOwner.create(
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
    const factories = configureProviderRuntimeFactories(
      builtCallerConfig,
      builtCallerManager,
    );
    builtCallerTokenizer = factories.tokenizerFactory;
    builtCallerContent = factories.contentGeneratorFactory;
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
    await builtCallerOwner.getAgentClient().startChat();
  }

  const peerCredentials = useOwnedCredentials();
  let peerCallerConfig: Config;
  let peerCallerSettings: SettingsService;
  let peerCallerSettingsOwner: SessionSettingsOwner;
  let peerCallerPolicy: RuntimePolicyOwner;
  let peerCallerMcp: McpRuntimeOwner;
  let peerCallerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let peerCallerOwner: SessionClientOwner;
  let peerCallerClose: () => Promise<void>;
  let peerCallerFactories: AgentRuntimeFactoryBindings;
  let peerCallerRelease: AcquisitionRelease;
  let peerCallerFiles: ProviderFileLifecycle;
  let peerCallerRuntimeId: string;
  let peerCallerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let peerCallerTokenizer: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  let peerCallerContent: ReturnType<
    typeof configureProviderRuntimeFactories
  >['contentGeneratorFactory'];

  async function openpeerCaller(
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
      await mkdtemp(join(tmpdir(), 'peerCaller-adoption-')),
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
    peerCallerConfig = new Config(parameters);
    peerCallerFactories = {
      ...createAgentRuntimeFactoryBindings(),
      ...suppliedFactories,
    };
    peerCallerSettings = new SettingsService();
    for (const [key, value] of Object.entries(
      peerCallerConfig.getInitialSettings(),
    ))
      peerCallerSettings.set(key, value);
    peerCallerPolicy = new RuntimePolicyOwner(peerCallerConfig);
    injectConfirmationForcingPolicy(peerCallerPolicy.session.confirmation);
    peerCallerMcp = await buildTestMcpRuntime(
      peerCallerConfig,
      peerCallerPolicy.session.messageBus,
      overrides,
      extensionLoader,
      peerCallerPolicy,
      skillOperations,
    );
    acquirepeerCallerProviders();
    const media = new SessionMediaOwner(
      peerCallerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    peerCallerOwner = await SessionClientOwner.create(
      peerCallerConfig,
      assembleTaskSchemaPolicy(peerCallerSettings),
      peerCallerManager,
      peerCallerFactories.agentClientFactory,
      media.store,
      peerCallerMcp.readInstructions,
      peerCallerMcp.workspacePaths,
      peerCallerSettingsOwner,
      peerCallerContent,
      peerCallerTokenizer,
    );
    peerCallerOwner.bindMcpRuntime(peerCallerMcp);
    peerCallerOwner.bindProviderFiles(peerCallerFiles, (provider) =>
      peerCallerOAuth.composeRetryOperations(provider),
    );
    peerCallerOwner.bindHooks();
    peerCallerClose = settleEngineRelease.bind(
      undefined,
      [
        () => peerCallerOwner.dispose(),
        () => peerCallerRelease.close(),
        () => media.dispose(),
        () => peerCallerMcp.dispose(),
        () => peerCallerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        peerCallerConfig,
        peerCallerSettings,
        peerCallerSettingsOwner,
        peerCallerManager,
        peerCallerOAuth,
        peerCallerRuntimeId,
        peerCallerTokenizer,
      );
      await peerCallerMcp.initialize();
      await activatepeerCallerClient(selection.activation);
    } catch (primary) {
      await cleanupAfterFailure(primary, peerCallerClose);
    }
  }
  function acquirepeerCallerProviders(): void {
    peerCallerRuntimeId = 'peerCaller-' + randomUUID();
    peerCallerRelease = new AcquisitionRelease();
    peerCallerSettingsOwner = new SessionSettingsOwner(peerCallerSettings);
    peerCallerRelease.acquire('settings', () =>
      peerCallerSettingsOwner.dispose(),
    );
    peerCallerSettingsOwner.initializeProviderSelection(
      peerCallerConfig.getProvider(),
      peerCallerConfig.getModel(),
    );
    peerCallerSettingsOwner.bindTelemetry(peerCallerConfig);
    peerCallerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [peerCallerRuntimeId, peerCallerConfig.getSessionId()])
      peerCallerRelease.acquire('files', () =>
        releaseAdoptedFileScope(peerCallerFiles, scope),
      );
    peerCallerManager = acquirePreferredProviderManager(
      peerCallerConfig,
      peerCallerSettings,
      peerCallerSettingsOwner,
      peerCallerFiles,
      peerCallerRuntimeId,
      peerCredentials().authority,
      peerCallerRelease,
    );
    const factories = configureProviderRuntimeFactories(
      peerCallerConfig,
      peerCallerManager,
    );
    peerCallerTokenizer = factories.tokenizerFactory;
    peerCallerContent = factories.contentGeneratorFactory;
    peerCallerOAuth = acquirePreferredOAuth(
      undefined,
      peerCallerPolicy.session.messageBus,
      peerCallerConfig,
      peerCallerSettings,
      peerCallerManager,
      peerCallerRuntimeId,
      peerCallerMcp.profileDefinitions,
      peerCredentials().authority,
      peerCallerRelease,
    );
  }
  async function activatepeerCallerClient(
    intent: ProviderActivationIntent = {
      provider: peerCallerConfig.getProvider(),
      model: peerCallerConfig.getModel(),
    },
  ): Promise<void> {
    const activation = await executeProviderActivation(
      peerCallerConfig,
      intent,
      assembleProviderSwitch(
        peerCallerConfig,
        peerCallerSettings,
        peerCallerManager,
        peerCallerOAuth,
        () => 'agent',
        () => peerCallerOwner.refreshAuth(),
        peerCallerSettingsOwner,
      ),
      peerCallerSettings,
      peerCallerManager,
      (method) => peerCallerOwner.refreshAuth(method),
      assembleModelSelection(peerCallerSettingsOwner),
    );
    requireCallerActivation(activation);
    await peerCallerOwner.initializeTools();
    await peerCallerOwner.getAgentClient().startChat();
  }

  for (const kind of ['json', 'embedding'] as const) {
    it(`joins accepted ${kind} work and retains a borrowed client after facade closure`, async () => {
      await openbuiltCaller('plain-text.jsonl');
      await builtCallerOwner.getAgentClient().startChat();
      await openpeerCaller('plain-text.jsonl');
      await peerCallerOwner.getAgentClient().startChat();
      const entered = gate();
      const release = gate();
      const generator = builtCallerOwner.getAgentClient().getContentGenerator();
      let cancellation: AbortSignal | undefined;
      const failure = new Error('Held transport failed');
      generator.generateContent = async (request) => {
        cancellation = request.abortSignal;
        entered.release();
        await release.promise;
        throw failure;
      };
      generator.embedContent = async () => {
        entered.release();
        await release.promise;
        throw failure;
      };
      const agent = await fromConfig({
        settingsService: builtCallerSettings,
        settingsOwner: builtCallerSettingsOwner,
        config: builtCallerConfig,
        providerManager: builtCallerManager,
        mcpRuntime: builtCallerMcp,
        agentClient: builtCallerOwner.getAgentClient(),
      });
      const pending =
        kind === 'json'
          ? agent.generateJson(contents(), { type: 'object' })
          : agent.generateEmbedding(['held']);
      const result = pending.then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered.promise;
      const closing = agent.dispose();
      const outcome = closing.then(
        () => undefined,
        (error: unknown) => error,
      );
      let finished = false;
      void outcome.then(() => {
        finished = true;
      });
      try {
        await expect(agent.generateJson(contents(), {})).rejects.toThrow(
          /closed|disposed/,
        );
        await expect(agent.generateEmbedding(['late'])).rejects.toThrow(
          /closed|disposed/,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(finished).toBe(false);
        peerCallerOwner.getAgentClient().getContentGenerator().embedContent =
          async ({ texts }) => ({
            embeddings: texts.map((text) => [text.length]),
          });
        expect(
          (
            await peerCallerOwner
              .getAgentClient()
              .generateEmbedding(['sibling'])
          ).length,
        ).toBe(1);
        release.release();
        expect(await result).toBeInstanceOf(Error);
        expect(await outcome).toBeInstanceOf(AggregateDisposeError);
        expect(kind === 'embedding' || cancellation?.aborted).toBe(true);
        generator.embedContent = async ({ texts }) => ({
          embeddings: texts.map((text) => [text.length]),
        });
        expect(
          (
            await builtCallerOwner
              .getAgentClient()
              .generateEmbedding(['borrowed', 'still usable'])
          ).map((row) => row.length),
        ).toStrictEqual([1, 1]);
      } finally {
        release.release();
        await result;
        await outcome;
        await peerCallerClose();
        await builtCallerClose();
      }
    });
  }

  it('joins raw client embedding work before removing owned listeners', async () => {
    await openbuiltCaller('plain-text.jsonl');
    await builtCallerOwner.getAgentClient().startChat();
    const client = builtCallerOwner.getAgentClient();
    const entered = gate();
    const release = gate();
    client.getContentGenerator().embedContent = async ({ texts }) => {
      entered.release();
      await release.promise;
      return { embeddings: texts.map((text) => [text.length]) };
    };
    const pending = client.generateEmbedding(['one', 'two']);
    await entered.promise;
    const closing = client.dispose();
    let finished = false;
    void closing.then(() => {
      finished = true;
    });
    try {
      await expect(client.generateEmbedding(['late'])).rejects.toThrow(
        /closed/,
      );
      await Promise.resolve();
      expect(finished).toBe(false);
      release.release();
      expect((await pending).length).toBe(2);
      await closing;
    } finally {
      release.release();
      await pending;
      await closing;
      await builtCallerClose();
    }
  });

  it('carries caller cancellation into the JSON transport', async () => {
    await openbuiltCaller('plain-text.jsonl');
    await builtCallerOwner.getAgentClient().startChat();
    const controller = new AbortController();
    const entered = gate();
    const release = gate();
    let cancellation: AbortSignal | undefined;
    builtCallerOwner.getAgentClient().getContentGenerator().generateContent =
      async (request) => {
        cancellation = request.abortSignal;
        entered.release();
        await release.promise;
        const output = emptyModelOutput();
        return {
          ...output,
          content: {
            ...output.content,
            blocks: [{ type: 'text', text: '{}' }],
          },
        };
      };
    const pending = builtCallerOwner
      .getAgentClient()
      .generateJson(contents(), {}, controller.signal, 'fake-model');
    await entered.promise;
    try {
      controller.abort();
      expect(cancellation?.aborted).toBe(true);
    } finally {
      release.release();
      await pending;
      await builtCallerClose();
    }
  });
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
