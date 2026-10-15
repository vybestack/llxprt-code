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
import { type Agent } from '@vybestack/llxprt-code-agents';
import { AgentImpl, type AgentDeps } from '../agentImpl.js';
import { createLoopHolder } from '../loop/rebuildLoop.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
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

  it('T9a client reports "gpt-4o" → agent.getCurrentSequenceModel() === "gpt-4o" @requirement:REQ-003 @scenario:positive-delegation @given:an agent whose resolveClient returns a client reporting "gpt-4o" @when:agent.getCurrentSequenceModel() @then:returns "gpt-4o"', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const fakeClient = makeSeqClient('gpt-4o');
      const deps = assembleDeps(() => fakeClient);
      const agent: Agent = new AgentImpl(deps, async () => {
        throw new Error('Unexpected model selection');
      });
      expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
    } finally {
      await builtCallerClose();
    }
  });

  it('T9b client reports null → agent.getCurrentSequenceModel() === null (genuine contract value, stable across repeated calls) @requirement:REQ-003 @scenario:null-contract @scenario:property @given:an agent whose resolveClient returns a client reporting null @when:agent.getCurrentSequenceModel() is called repeatedly @then:returns null on every call (null-stability property)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const fakeClient = makeSeqClient(null);
      const deps = assembleDeps(() => fakeClient);
      const agent: Agent = new AgentImpl(deps, async () => {
        throw new Error('Unexpected model selection');
      });
      // Property: null-stability — repeated calls always return null (never
      // drift to undefined or a string). fc.integer drives the repetition count.
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 25 }), async (n) => {
          for (let i = 0; i < n; i++) {
            expect(agent.getCurrentSequenceModel()).toBeNull();
          }
        }),
      );
    } finally {
      await builtCallerClose();
    }
  });

  it('T9c resolveClient returns undefined (no client yet) → agent.getCurrentSequenceModel() returns null and does NOT throw @requirement:REQ-003 @scenario:null-guard @given:an agent whose resolveClient returns undefined @when:agent.getCurrentSequenceModel() @then:returns null without throwing', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      const deps = assembleDeps(() => undefined);
      const agent: Agent = new AgentImpl(deps, async () => {
        throw new Error('Unexpected model selection');
      });
      expect(agent.getCurrentSequenceModel()).toBeNull();
    } finally {
      await builtCallerClose();
    }
  });

  it('T9d after rebind (resolveClient now returns a new client reporting "claude-x") → the SAME agent returns "claude-x" (no caching — R-CLIENT fresh-resolve) @requirement:REQ-003 @scenario:no-caching @given:an agent whose resolveClient closure captures a mutable client reporting "gpt-4o" @when:the captured client is reassigned to one reporting "claude-x" and getCurrentSequenceModel() is called again @then:returns "claude-x" on the SAME agent (proves fresh re-resolve, never cached)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      let current: AgentClientContract | undefined = makeSeqClient('gpt-4o');
      const deps = assembleDeps(() => current);
      const agent: Agent = new AgentImpl(deps, async () => {
        throw new Error('Unexpected model selection');
      });
      // First call resolves the initial client.
      expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
      // Rebind: the closure now returns a DIFFERENT client on the SAME agent.
      current = makeSeqClient('claude-x');
      expect(agent.getCurrentSequenceModel()).toBe('claude-x');
    } finally {
      await builtCallerClose();
    }
  });

  it('PROP round-trip: for any model string s, when the injected client reports s, agent.getCurrentSequenceModel() === s @requirement:REQ-003 @scenario:property-round-trip @given:a random non-empty model string s and an agent whose client reports s @when:agent.getCurrentSequenceModel() @then:returns s (round-trip equality)', async () => {
    await openbuiltCaller('plain-text.jsonl');
    try {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), async (s) => {
          const fakeClient = makeSeqClient(s);
          const deps = assembleDeps(() => fakeClient);
          const agent: Agent = new AgentImpl(deps, async () => {
            throw new Error('Unexpected model selection');
          });
          expect(agent.getCurrentSequenceModel()).toBe(s);
        }),
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
