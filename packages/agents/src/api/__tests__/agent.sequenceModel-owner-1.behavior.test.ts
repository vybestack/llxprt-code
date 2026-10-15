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
import { recordOwnership } from '../agentBootstrap.js';
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
import { resolveShellJobSettings } from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { AgentImpl, type AgentDeps } from '../agentImpl.js';
import { createLoopHolder } from '../loop/rebuildLoop.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P13
 * @requirement:REQ-003
 *
 * BEHAVIORAL RED suite for Agent.getCurrentSequenceModel() delegation.
 *
 * The production method today is a hardcoded `return null` stub
 * (agentImpl.ts:692-694). The pseudocode (get-current-sequence-model.md
 * lines 10-15) requires it to resolve the bound client FRESH on every call
 * (R-CLIENT invariant — never cache), null-guard a missing client, and
 * delegate to AgentClientContract.getCurrentSequenceModel().
 *
 * This suite proves the delegation behavior through the blessed dependency-
 * injection seam `AgentDeps.resolveClient` (agentImpl.ts:132) — the SAME seam
 * the sibling method getHistory
 * (agentImpl.ts:759) delegate through. Using this seam is DEPENDENCY
 * INJECTION, not mock theater: the suite assembles a real AgentDeps (built
 * from a real Config via buildCliStyleConfig) and injects a controllable
 * resolveClient that returns a fake AgentClientContract carrying a chosen
 * sequence-model value. Every assertion is on the REAL RETURN VALUE of
 * agent.getCurrentSequenceModel() — there are zero spy-call assertions.
 *
 * At RED (this phase): the positive delegation cases (T9a, T9d, PROP
 * round-trip, PROP consumer-fallback-with-model) FAIL because the stub
 * returns null regardless of what the client reports. The null contract
 * cases (T9b, T9c) PASS because null IS the genuine contract value when
 * the client reports null or is absent — they assert that real value, not
 * an inverted expectation.
 *
 * At GREEN (P14): the one-liner delegation
 *   `return this.deps.resolveClient()?.getCurrentSequenceModel() ?? null`
 * makes every case pass with no rewrite.
 */

// ─── Fake client carrying a chosen sequence-model value ─────────────────────
//
// Mirrors the established single-cast-to-contract idiom (realLoopHarness.ts
// builds a scripted client object literal with getCurrentSequenceModel: () =>
// null; rebuildLoopProbe.ts uses the { __tag } cast for value-identity). Only
// getCurrentSequenceModel is exercised by THIS method, so the object is
// intentionally minimal. The cast is localized to the injected dependency
// ONLY; the resolveClient seam itself is a real `() => fakeClient` closure.

/**
 * Builds a minimal fake AgentClientContract that reports the given sequence
 * model. Used as the injected dependency value behind resolveClient.
 */
function makeSeqClient(sequenceModel: string | null): AgentClientContract {
  return {
    getCurrentSequenceModel: () => sequenceModel,
  } as unknown as AgentClientContract;
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
describe('getCurrentSequenceModel delegation @plan:PLAN-20260621-COREAPIREMED.P13 @requirement:REQ-003', () => {
  function assembleDeps(
    resolveClient: () => AgentClientContract | undefined,
  ): AgentDeps {
    const config = builtCallerConfig;
    const runtimeState = createAgentRuntimeState({
      runtimeId: 'seq-test',
      provider: config.getProvider() ?? 'fake',
      model: config.getModel(),
    });
    const loopHolder = createLoopHolder();
    const ownership = recordOwnership({
      runtimeHandle: { cleanup: () => undefined },
      config,
      messageBus: builtCallerPolicy.session.messageBus,
      loopHolder,
      runtimeState,
      injectedSchedulerHandles: [],
      configOwnership: 'caller',
    });
    return {
      sessionClient: builtCallerOwner,
      settingsOwner: builtCallerSettingsOwner,
      workspaceSkills: builtCallerMcp.workspaceSkills.operations,
      taskLaunchOwner: new TaskLaunchOwner(new AsyncTaskManager()),
      shellOwner: new ShellJobOwner(() =>
        resolveShellJobSettings(builtCallerSettings),
      ),
      mediaStore: builtCallerOwner.getAgentClient().mediaStore,
      config,
      sessionIdentityOwnership: 'facade',
      mcpOperations: builtCallerMcp,
      switchProvider: async () => {
        throw new Error('Unexpected provider switch in sequence-model test');
      },
      // Config exposes the runtime-adopted ProviderManager (configBaseCore.ts:265).
      providerManager: builtCallerManager,
      // getCurrentSequenceModel never reads oauthManager; structural stand-in keeps the cast localized.
      oauthManager: {} as unknown as AgentDeps['oauthManager'],
      settingsService: builtCallerSettings,
      runtimeId: 'seq-test',
      runtimeHandle: { cleanup: () => undefined },
      messageBus: builtCallerPolicy.session.messageBus,
      loopHolder,
      runtimeState,
      ownership,
      rebuildLoop: () => undefined,
      // resolveClient may yield undefined (T9c null-guard case); AgentDeps types it non-optional,
      // so cast the variance at this single injected seam (runtime null-guard is the behavior under test).
      resolveClient: resolveClient as AgentDeps['resolveClient'],
      // getCurrentSequenceModel never touches these holders; minimal stand-ins.
      displayCallbacks: {},
      editorCallbacksHolder: { editorCallbacks: {} },
      displayCallbacksHolder: {},
    };
  }

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

  const observeConsumerFallbacks = async () => {
    await openbuiltCaller('plain-text.jsonl');
    const fallbackModel = builtCallerConfig.getModel();
    const observations: Array<{
      reportedModel: string;
      presentResult: string;
      absentResult: string;
      absentModel: string;
      fallbackModel: string;
    }> = [];
    const fallbackProperty = fc.asyncProperty(
      fc.string({ minLength: 1 }),
      (reportedModel) => {
        const presentAgent: Agent = new AgentImpl(
          assembleDeps(() => makeSeqClient(reportedModel)),
          async () => {
            throw new Error('Unexpected model selection');
          },
        );
        const absentAgent: Agent = new AgentImpl(
          assembleDeps(() => makeSeqClient(null)),
          async () => {
            throw new Error('Unexpected model selection');
          },
        );
        const presentResult =
          presentAgent.getCurrentSequenceModel() ?? presentAgent.getModel();
        const absentResult =
          absentAgent.getCurrentSequenceModel() ?? absentAgent.getModel();
        const absentModel = absentAgent.getModel();
        observations.push({
          reportedModel,
          presentResult,
          absentResult,
          absentModel,
          fallbackModel,
        });
        return Promise.resolve(
          presentResult === reportedModel &&
            absentResult === absentModel &&
            absentModel === fallbackModel,
        );
      },
    );
    return { fallbackProperty, observations, cleanup: builtCallerClose };
  };

  it('PROP consumer fallback: (agent.getCurrentSequenceModel() ?? agent.getModel()) equals the client reported sequence model when present, else equals agent.getModel() @requirement:REQ-003 @scenario:property-consumer-fallback @given:a random model string and an agent whose client reports it @when:a consumer computes seq ?? agent.getModel() @then:the result equals the reported model; and when the client reports null the result equals agent.getModel()', async () => {
    const { fallbackProperty, observations, cleanup } =
      await observeConsumerFallbacks();
    try {
      await fc.assert(fallbackProperty);
    } finally {
      await cleanup();
    }
    expect(
      observations.map(({ presentResult }) => presentResult),
    ).toStrictEqual(observations.map(({ reportedModel }) => reportedModel));
    expect(observations.map(({ absentResult }) => absentResult)).toStrictEqual(
      observations.map(({ absentModel }) => absentModel),
    );
    expect(observations.map(({ absentModel }) => absentModel)).toStrictEqual(
      observations.map(({ fallbackModel }) => fallbackModel),
    );
  });

  // ─── Genuine null contract via the REAL path (distinct from T9b's injected
  // seam): proves the real fake-provider client reports null sequence model
  // (no load-balancer sticky model under the fake seam) and that the public
  // fromConfig-built agent surfaces that genuine null. This is NOT a reverse
  // test — null IS the real contract value here.
  it('T9b-real fromConfig-built agent over the fake seam returns null (genuine null contract, real client) @requirement:REQ-003 @scenario:null-contract-real @given:a real agent built via fromConfig over the fake-provider seam @when:agent.getCurrentSequenceModel() @then:returns null (the real fake-provider client reports no sequence model)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: builtCallerSettingsOwner,
        settingsService: builtCallerSettings,
        providerManager: builtCallerManager,
        config: builtCallerConfig,
        mcpRuntime: builtCallerMcp,
      });
      try {
        expect(agent.getCurrentSequenceModel()).toBeNull();
      } finally {
        await agent.dispose();
      }
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
