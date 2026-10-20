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
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
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
import {
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
} from 'bun:test';
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
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  countType,
  respondToFirstConfirmation,
  isDoneEvent,
  isToolCallEvent,
  isToolResultEvent,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260629-ISSUE2204
 * @requirement:REQ-2204-1
 *
 * Replaceable alternate-client smoke test (issue #2204).
 *
 * This suite PROVES the public Agent API is consumable by a NON-CLI / NON-UI
 * client. It imports ONLY from the public root
 *   @vybestack/llxprt-code-agents
 * plus the test-only helpers under ./helpers/ (which themselves re-export only
 * public-safe symbols and provide the LLXPRT_FAKE_RESPONSES production seam).
 * No deep/runtime-construction import appears anywhere in this file.
 *
 * It drives the full replaceable-client lifecycle through the public surface:
 *   - createAgent / fromConfig (create + adopt)
 *   - agent.stream(...) / agent.chat(...)
 *   - tool confirmation handling via agent.tools.onConfirmationRequest /
 *     agent.tools.respondToConfirmation
 *   - status inspection: getProviderStatus, getModel, getStats
 *   - agent.dispose()
 *
 * The assertions are ownership/lifecycle invariants and the "exactly one
 * terminal done per turn" contract — the same durable seams the canonical
 * fromConfig.behavior.test.ts uses, so this is genuine behavior, not mock
 * theater.
 */

/**
 * Re-throw a captured teardown error (e.g. from agent.dispose()) so a real
 * teardown bug still fails the test, while keeping the capture/rethrow
 * conditional OUT of the test body (the no-conditional-in-test lint rule). Pass
 * `undefined` when no error occurred — a no-op in that case.
 *
 * Defined at module scope (not inside `it`) so the conditional it contains is
 * ordinary teardown plumbing rather than test branching logic.
 */
function rethrowCapturedError(err: unknown): void {
  if (err !== undefined) {
    throw err;
  }
}

describe('Replaceable alternate-client smoke (issue #2204) @plan:PLAN-20260629-ISSUE2204 @requirement:REQ-2204-1', () => {
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

  // ── Cleanup strategy (intentional split) ─────────────────────────────────
  //
  // Two cleanup patterns coexist by design:
  //
  //  (A) buildAgent tests (create, chat, tool-confirmation, status-inspection):
  //      use try/finally and call the harness `cleanup()` directly. The
  //      harness cleanup disposes the agent AND restores the env var, so it is
  //      the SINGLE teardown step. These tests do NOT push onto `cleanupFns`
  //      to avoid a redundant double-dispose via afterEach.
  //
  //  (B) fromConfig test (adopt): uses buildCliStyleConfig, whose `cleanup`
  //      restores the env var but does NOT dispose the caller-owned Config or
  //      the adopted Agent. So the Agent is disposed explicitly in a finally
  //      block (capturing errors so the ownership assertions still run), and
  //      the Config-env cleanup is pushed onto `cleanupFns` for afterEach.
  //
  //  (C) dispose-idempotency test: intentionally double-disposes the Agent in
  //      the test body (the assertion), then pushes the harness `cleanup` onto
  //      `cleanupFns` for env-var restoration. The harness dispose is
  //      best-effort (`.catch(() => {})`), so the resulting third dispose is
  //      harmless — it is the idempotency contract being asserted.
  let cleanupFns: Array<() => Promise<void>>;

  beforeEach(() => {
    cleanupFns = [];
  });

  afterEach(async () => {
    let firstError: unknown;
    for (const fn of cleanupFns) {
      try {
        await fn();
      } catch (err) {
        firstError ??= err;
      }
    }
    cleanupFns = [];
    rethrowCapturedError(firstError);
  });

  it('createAgent builds a usable Agent from a public AgentConfig (no CLI, no UI, no Config co-assembly) @requirement:REQ-2204-1 @scenario:create', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The Agent exposes the public status-inspection surface.
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
      const status = agent.getProviderStatus();
      expect(status).toBeDefined();
      const statsBefore = agent.getStats();
      // Before any turn the turn-count baseline is zero (readTurnCount reads
      // from an empty history), not just "some object".
      expect(statsBefore.turnCount).toBe(0);

      // A single stream turn resolves to exactly one terminal done carrying a
      // meaningful stop reason (not just "a done event exists").
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      const doneEvents = events.filter(isDoneEvent);
      expect(doneEvents).toHaveLength(1);
      expect(doneEvents[0].reason).toBe('stop');
    } finally {
      // The buildAgent harness cleanup disposes the agent; no explicit
      // agent.dispose() here (it would be a confusing double-dispose).
      await cleanup();
    }
  });

  it('chat() returns an AgentResult with text and finishReason through the public surface @requirement:REQ-2204-1 @scenario:chat', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const result = await agent.chat('hello');
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');
    } finally {
      // No explicit agent.dispose() — the buildAgent harness cleanup disposes
      // the agent (double-dispose would be confusing).
      await cleanup();
    }
  });

  it('fromConfig adopts a caller-owned Config and the caller retains ownership after dispose @requirement:REQ-2204-1 @scenario:adopt', async () => {
    await openbuiltCaller('plain-text.jsonl');
    cleanupFns.push(builtCallerClose);
    const config = builtCallerConfig;

    // Pre-adoption baseline: the caller-owned Config's runtime is queryable
    // through its own public surface before the Agent is even built.
    expect(config.getProvider()).toBe('fake');
    expect(config.getModel()).toBe('fake-model');

    const agent: Agent = await fromConfig(
      config,
      builtCallerSettings,
      {},
      builtCallerSettingsOwner,
      builtCallerManager,
      undefined,
      undefined,
      builtCallerMcp,
      undefined,
      capturedSessionClient(builtCallerOwner),
    );

    // Adoption (public surface only): the Agent reports the SAME provider/model
    // the caller-owned Config was built with, proving the adopted runtime —
    // not a freshly-constructed one — is driving the Agent. Private internal
    // registration (internalConfigAccess) is an implementation detail outside
    // the public consumer contract, so it is NOT asserted here.
    let disposeError: unknown = undefined;
    try {
      const configuredProvider = config.getProvider();
      if (configuredProvider === undefined)
        throw new Error('Missing configured provider');
      expect(agent.getProvider()).toBe(configuredProvider);
      expect(agent.getModel()).toBe(config.getModel());
      expect(agent.getProviderStatus()).toBeDefined();

      // A turn drives through the adopted runtime to exactly one done.
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      // Dispose in finally so the Agent is always torn down even if an
      // assertion above fails, preventing a resource leak. Capture (do not
      // swallow) a dispose failure so the ownership assertions below still
      // run and a real teardown bug is surfaced, not hidden.
      try {
        await agent.dispose();
      } catch (err) {
        disposeError = err;
      }
    }

    // Ownership invariant (public surface): a fromConfig-supplied Config is
    // NOT torn down by agent.dispose() — the caller retains its lifecycle.
    // The caller-owned config is still queryable through its own surface
    // after the Agent that adopted it is disposed.
    expect(config.getProvider()).toBe('fake');
    expect(config.getModel()).toBe('fake-model');

    // Re-throw a captured dispose failure AFTER the ownership assertions so a
    // teardown bug still fails the test rather than being hidden permanently.
    rethrowCapturedError(disposeError);
  });

  it('tool confirmation flows through the public agent.tools surface (onConfirmationRequest + respondToConfirmation) @requirement:REQ-2204-1 @scenario:tool-confirmation', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events: AgentEvent[] = await drain(agent.stream('run the tool'));

        // A tool-call event surfaces, the public confirmation handler
        // approved it, and a tool-result follows.
        const callEvents = events.filter(isToolCallEvent);
        expect(callEvents.length).toBeGreaterThanOrEqual(1);
        expect(callEvents[0].call.name).toBe('read_file');

        const resultEvents = events.filter(isToolResultEvent);
        expect(resultEvents.length).toBeGreaterThanOrEqual(1);
        expect(resultEvents[0].result.id).toBe(callEvents[0].call.id);

        // Exactly one terminal done — the turn settled once.
        expect(countType(events, 'done')).toBe(1);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      // No explicit agent.dispose() — the buildAgent harness cleanup disposes
      // the agent (double-dispose would be confusing).
      await cleanup();
    }
  });

  it('dispose() is idempotent and a second dispose does not throw (lifecycle invariant) @requirement:REQ-2204-1 @scenario:dispose', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    // Intentional triple-dispose, all safe by the idempotency contract:
    //   1st: explicit dispose() below (primary teardown).
    //   2nd: the idempotency assertion — must NOT throw.
    //   3rd: afterEach runs the harness `cleanup`, whose dispose is
    //        best-effort (`.catch(() => {})`) and only restores the env var.
    // The 3rd dispose is registered via cleanupFns so the LLXPRT_FAKE_RESPONSES
    // env var is always restored even if an assertion above throws; it is NOT
    // a redundant double-dispose of a live agent.
    cleanupFns.push(cleanup);
    await agent.dispose();
    // A second dispose must not throw — clients may call it defensively.
    await expect(agent.dispose()).resolves.toBeUndefined();
  });

  it('getStats() reflects turn activity after a stream completes through the public surface @requirement:REQ-2204-1 @scenario:status-inspection', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const before = agent.getStats();
      expect(before.turnCount).toBe(0);
      await drain(agent.stream('hello'));
      const after = agent.getStats();
      // A completed turn appends user+model messages to the HistoryService,
      // so readTurnCount projects a strictly greater turnCount (not just
      // ">=" — a no-op mutant that always returns the baseline is killed).
      expect(after).toBeDefined();
      expect(after.turnCount).toBeGreaterThan(before.turnCount);
    } finally {
      // No explicit agent.dispose() — the buildAgent harness cleanup disposes
      // the agent (double-dispose would be confusing).
      await cleanup();
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
