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
import {
  SessionProviderReads,
  fromConfig,
} from '@vybestack/llxprt-code-agents';
import { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { drain, countType } from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC2
 *
 * BEHAVIORAL suite for fromConfig's task-tool reconciliation on Configs the
 * CALLER initialized before adoption (review finding on #3222):
 * ensureAgentRuntimeFactories installs the shipped task-tool registration as
 * a field default, but the registration is consumed only at tool-registry
 * construction and ensureInitialized is a no-op for an already-initialized
 * Config — so the registry the caller built stays without the task tool
 * unless adoption carries the late-installed default into the LIVE registry.
 * These tests initialize the Config THEMSELVES (with an agent-client factory
 * but no task-tool registration), then adopt it via fromConfig and observe
 * the returned Agent's runtime. Caller-supplied registrations and
 * excludeTools governance must never be overridden by the reconcile.
 */

/** The agent runtime's projected tool-name surface. */

function createReadinessFactory(
  prepareTokenizer: (providerName: string, model?: string) => Promise<void>,
  countTokens: (providerName: string, model?: string) => number,
): RuntimeTokenizerFactory {
  return {
    prepareTokenizer,
    getTokenizer: (providerName, model) => ({
      fallbackPolicy: 'deny',
      countTokens: () => countTokens(providerName, model),
    }),
    estimatePrompt: async (request) => ({
      count: await request.legacyEstimate(),
      method: 'calibrated',
      family: 'test-readiness',
      estimatorVersion: 'test-readiness-v1',
      assetRevision: 'none',
      projectionRevision: request.projectionRevision,
    }),
  };
}

function readinessSignal() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
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

describe('fromConfig tokenizer readiness @requirement:REQ-3217-001 @requirement:REQ-3217-003', () => {
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

  it('awaits post-activation provider/model preparation before returning a usable Agent', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const preparationStarted = readinessSignal();
    const releasePreparation = readinessSignal();
    const events: string[] = [];
    let prepared = false;
    const factory = createReadinessFactory(
      async (providerName, model) => {
        events.push(`prepare:${providerName}:${model ?? ''}`);
        preparationStarted.resolve();
        await releasePreparation.promise;
        prepared = true;
        events.push('prepared');
      },
      (providerName, model) => {
        if (!prepared) {
          throw new Error('tokenizer used before preparation completed');
        }
        events.push(`tokenize:${providerName}:${model ?? ''}`);
        return 7;
      },
    );

    try {
      const pendingAgent = fromConfig({
        tokenizerFactory: factory,
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        agentClient: builtCallerOwner.getAgentClient(),
        providerManager: builtCallerManager,
        runtimeFactoryBindings: builtCallerFactories,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
        activation: {
          provider: 'fake',
          model: 'ready-model',
          authMode: 'auto',
        },
      });
      await preparationStarted.promise;
      let completed = false;
      const observedAgent = pendingAgent.then((agent) => {
        completed = true;
        return agent;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(completed).toBe(false);

      releasePreparation.resolve();
      const agent = await observedAgent;
      try {
        await agent.agentClient.startChat(await agent.agentClient.getHistory());
        expect(builtCallerManager.getTokenizerFactory()).toBe(factory);

        const turnEvents = await drain(agent.stream('hello'));
        expect(countType(turnEvents, 'done')).toBe(1);
        expect(events[0]).toBe('prepare:fake:ready-model');
        expect(events[1]).toBe('prepared');
        expect(
          events.some((event) => event === 'tokenize:fake:ready-model'),
        ).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      releasePreparation.resolve();
      await builtCallerClose();
    }
  });

  it('rejects with the causal preparation failure reached through authoritative post-activation state without allowing an ownerless accessor', async () => {
    await openbuiltCaller('plain-text.jsonl');
    const failure = new Error('mandatory tokenizer readiness failed causally');
    const runtimeId = 'from-config-rejected-tokenizer-readiness';
    // Mutate the Config's provider field to stale state. The isolated runtime
    // manager still has 'fake' active (authoritative). fromConfig must derive
    // the readiness target from the manager, not from this stale Config field.
    Object.defineProperty(builtCallerConfig, 'getProvider', {
      value: () => 'stale-config-provider',
    });
    let readinessTarget:
      | { readonly provider: string; readonly model: string }
      | undefined;
    const tokenizerFactory = createReadinessFactory(
      async (providerName, model) => {
        readinessTarget = { provider: providerName, model: model ?? '' };
        throw failure;
      },
      () => {
        throw new Error('unreachable tokenizer use');
      },
    );

    try {
      await expect(
        fromConfig({
          settingsOwner: builtCallerSettingsOwner,
          settingsService: builtCallerSettings,
          agentClient: builtCallerOwner.getAgentClient(),
          providerManager: builtCallerManager,
          runtimeFactoryBindings: builtCallerFactories,
          config: builtCallerConfig,
          mcpRuntime: builtCallerMcp,
          sessionId: runtimeId,
          tokenizerFactory,
        }),
      ).rejects.toBe(failure);
      // Authoritative post-activation manager state ('fake'/'fake-model')
      // reached readiness — NOT the stale Config provider
      // ('stale-config-provider').
      expect(readinessTarget).toStrictEqual({
        provider: 'fake',
        model: 'fake-model',
      });
      expect(readinessTarget?.provider).not.toBe('stale-config-provider');
      expect(() => Reflect.construct(SessionProviderReads, [])).toThrow(
        'Provider reads require an explicit session owner',
      );
    } finally {
      await builtCallerClose();
    }
  });
});

function requireCallerActivation(
  result: Awaited<ReturnType<typeof executeProviderActivation>>,
): void {
  if (result.authFailed) throw result.authError;
}
