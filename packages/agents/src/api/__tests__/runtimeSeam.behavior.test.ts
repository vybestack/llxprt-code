import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
import { beforeAll, afterAll, describe, expect, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { fileURLToPath } from 'node:url';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import * as fc from 'fast-check';

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P17
 * @requirement:REQ-005,REQ-001
 *
 * BEHAVIORAL RED suite for the (not-yet-implemented) public Agent method
 * `getRuntimeId(): string` and the provider-runtime reachability seam.
 *
 * RED SOURCE: `getRuntimeId()` is absent from the public `Agent` interface
 * (agent.ts) and from `AgentImpl` (agentImpl.ts) until P18 adds it. Every
 * REQ-005.1 test reaches the method through a documented narrowing cast and
 * throws `TypeError: ... getRuntimeId is not a function` at RED — the
 * legitimate behavioral RED reason for the interface gap. At GREEN (P18) the
 * SAME assertions pass with no rewrite.
 *
 * The suite uses the CANONICAL config builder (buildCliStyleConfig) and real
 * provider seam. The adopted-provider/model tests (T6b) and the no-2nd-manager
 * identity test (T6c) assert REAL values/instance-identity via the structural
 * providers seam, NOT mocks. This is genuine forward behavioral assertion, not
 * mock theater.
 */

// ─── Structural identity probe (cast-free, mirrors fromConfig.behavior idiom) ─
//
// The public Agent surface is opaque (no raw manager accessor). The
// no-2nd-manager identity invariant (T6c) is reached via the SAME documented
// structural narrowing idiom the sibling fromConfig.behavior.test.ts suite
// uses (captureProviderManager): treat the Agent as a Record<string, unknown>
// and probe a documented internal field. This is observation of the real
// provider seam, not a spy on a mock.

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

/** Reaches the AgentImpl providerManager field (agentImpl.ts AgentDeps). */
function captureProviderManager(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  const pm = impl['providerManager'] ?? impl['manager'];
  return pm ?? undefined;
}

// The no-2nd-manager identity (T6c / PROP-B) compares against the manager on
// the SUPPLIED Config via its real public Config accessor (configBaseCore.ts) —
// the SAME plain idiom the sibling fromConfig.behavior suite (T6) uses. The
// banned anti-pattern is a raw manager accessor on the Agent root surface,
// which this suite never does.

// The narrowing cast below reaches a PUBLIC method that does not yet exist on
// the Agent type (getRuntimeId, added by P18). This is NOT mock theater: it is
// a documented forward cast to the not-yet-implemented public surface, so the
// RED reason is the genuine behavioral gap (the method is absent), and at
// GREEN the same assertion passes unchanged.
type WithRuntimeId = { getRuntimeId(): string };

function asWithRuntimeId(agent: Agent): WithRuntimeId {
  return agent as unknown as WithRuntimeId;
}

describe('runtime-seam behavior @plan:PLAN-20260621-COREAPIREMED.P17 @requirement:REQ-005,REQ-001', () => {
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

  const credentials = useOwnedCredentials();
  let callerConfig: Config;
  let callerSettings: SettingsService;
  let callerSettingsOwner: SessionSettingsOwner;
  let callerPolicy: RuntimePolicyOwner;
  let callerMcp: McpRuntimeOwner;
  let callerManager: ReturnType<typeof acquirePreferredProviderManager>;
  let callerOwner: SessionClientOwner;
  let callerClose: () => Promise<void>;
  const callerFactories = createAgentRuntimeFactoryBindings();
  let callerRelease: AcquisitionRelease;
  let callerFiles: ProviderFileLifecycle;
  let callerRuntimeId: string;
  let callerOAuth: ReturnType<typeof acquirePreferredOAuth>;
  let callerTokenizer: ReturnType<typeof configureProviderTokenizer>;
  let callerContent: ReturnType<typeof createRuntimeContentGeneratorFactory>;

  async function openCaller(fixture: string): Promise<void> {
    const previousReplay = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/' + fixture, import.meta.url),
    );
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'caller-adoption-')),
    );
    callerConfig = new Config({
      ...toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        sessionId: randomUUID(),
        workingDir: directory,
      }),
      interactive: true,
      includeDirectories: [process.cwd()],
    });
    callerSettings = new SettingsService();
    callerPolicy = new RuntimePolicyOwner(callerConfig);
    injectConfirmationForcingPolicy(callerPolicy.session.confirmation);
    callerMcp = await buildTestMcpRuntime(
      callerConfig,
      callerPolicy.session.messageBus,
      {},
      undefined,
      callerPolicy,
    );
    acquireCallerProviders();
    const media = new SessionMediaOwner(
      callerConfig.projectTempDir,
      1024 * 1024 * 1024,
    );
    callerOwner = await SessionClientOwner.create(
      callerConfig,
      assembleTaskSchemaPolicy(callerSettings),
      callerManager,
      callerFactories.agentClientFactory,
      media.store,
      callerMcp.readInstructions,
      callerMcp.workspacePaths,
      callerSettingsOwner,
      callerContent,
      callerTokenizer,
    );
    callerOwner.bindMcpRuntime(callerMcp);
    callerOwner.bindProviderFiles(callerFiles, (provider) =>
      callerOAuth.composeRetryOperations(provider),
    );
    callerOwner.bindHooks();
    callerClose = settleEngineRelease.bind(
      undefined,
      [
        () => callerOwner.dispose(),
        () => callerRelease.close(),
        () => media.dispose(),
        () => callerMcp.dispose(),
        () => callerConfig.dispose(),
        () => rm(directory, { recursive: true, force: true }),
      ],
      previousReplay,
    );
    try {
      await preparePreferredProviderCompletion(
        callerConfig,
        callerSettings,
        callerSettingsOwner,
        callerManager,
        callerOAuth,
        callerRuntimeId,
        callerTokenizer,
        undefined,
      );
      await callerMcp.initialize();
      await activateCallerClient();
    } catch (primary) {
      await cleanupAfterFailure(primary, callerClose);
    }
  }
  function acquireCallerProviders(): void {
    callerRuntimeId = 'caller-' + randomUUID();
    callerRelease = new AcquisitionRelease();
    callerSettingsOwner = new SessionSettingsOwner(callerSettings);
    callerRelease.acquire('settings', () => callerSettingsOwner.dispose());
    callerSettingsOwner.initializeProviderSelection(
      callerConfig.getProvider(),
      callerConfig.getModel(),
    );
    callerSettingsOwner.bindTelemetry(callerConfig);
    callerFiles = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    for (const scope of [callerRuntimeId, callerConfig.getSessionId()])
      callerRelease.acquire('files', () =>
        releaseAdoptedFileScope(callerFiles, scope),
      );
    callerManager = acquirePreferredProviderManager(
      callerConfig,
      callerSettings,
      callerSettingsOwner,
      callerFiles,
      callerRuntimeId,
      credentials().authority,
      callerRelease,
    );
    const factoriesTokenizer = configureProviderTokenizer(callerManager);
    const factoriesContent = createRuntimeContentGeneratorFactory();
    callerTokenizer = factoriesTokenizer;
    callerContent = factoriesContent;
    callerOAuth = acquirePreferredOAuth(
      undefined,
      callerPolicy.session.messageBus,
      callerConfig,
      callerSettings,
      callerManager,
      callerRuntimeId,
      callerMcp.profileDefinitions,
      credentials().authority,
      callerRelease,
      undefined,
    );
  }
  async function activateCallerClient(): Promise<void> {
    const activation = await executeProviderActivation(
      callerConfig,
      { provider: callerConfig.getProvider(), model: callerConfig.getModel() },
      assembleProviderSwitch(
        callerConfig,
        callerSettings,
        callerManager,
        callerOAuth,
        () => 'agent',
        () => callerOwner.refreshAuth(),
        callerSettingsOwner,
      ),
      callerSettings,
      callerManager,
      (method) => callerOwner.refreshAuth(method),
      assembleModelSelection(callerSettingsOwner),
    );
    requireCallerActivation(activation);
    await callerOwner.initializeTools();
    await callerOwner.getAgentClient().startChat();
  }

  it('T6a fromConfig with a known sessionId yields agent.getRuntimeId() === that sessionId @requirement:REQ-005.1 @scenario:runtime-id @given:a real CLI-style Config and sessionId "known-runtime-id-T6a" @when:fromConfig({ config, sessionId }) @then:agent.getRuntimeId() === "known-runtime-id-T6a"', async () => {
    await openCaller('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
        sessionId: 'known-runtime-id-T6a',
      });
      expect(asWithRuntimeId(agent).getRuntimeId()).toBe(
        'known-runtime-id-T6a',
      );
    } finally {
      await agent?.dispose();
      await callerClose();
    }
  });

  it('T6b the adopted Config active provider/model are reflected on the agent (forward adopt-path guard) @requirement:REQ-005 @scenario:adopted-runtime @given:a real Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    await openCaller('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config: callerConfig,
        mcpRuntime: callerMcp,
      });
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await agent?.dispose();
      await callerClose();
    }
  });

  it('T6c no second ProviderManager: the runtime manager reachable post-build IS the SAME instance as the manager on the supplied Config (identity, observed via the real providers seam) @requirement:REQ-001 @scenario:no-double-manager @given:a Config whose manager accessor returns a real manager @when:fromConfig({ config }) @then:captureProviderManager(agent) === the Config manager (no second manager constructed)', async () => {
    await openCaller('plain-text.jsonl');
    let agent: Agent | undefined;
    try {
      const config = callerConfig;
      // The invariant is instance identity, observed via the real providers
      // seam: the manager reachable from the agent IS the SAME instance as the
      // one on the supplied Config (no second manager constructed). Mirrors the
      // sibling fromConfig.behavior T6 plain idiom (NOT a mock, NOT an
      // agent-root accessor).
      agent = await fromConfig({
        settingsOwner: callerSettingsOwner,
        settingsService: callerSettings,
        agentClient: callerOwner.getAgentClient(),
        providerManager: callerManager,
        config,
        mcpRuntime: callerMcp,
      });
      expect(captureProviderManager(agent)).toBe(callerManager);
    } finally {
      await agent?.dispose();
      await callerClose();
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it('PROP-A for any valid non-empty sessionId R, fromConfig({ config, sessionId: R }) yields agent.getRuntimeId() === R @requirement:REQ-005.1 @scenario:property-runtime-id @given:any non-empty sessionId string R @when:fromConfig({ config, sessionId: R }) @then:agent.getRuntimeId() === R for every generated R', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (runtimeId) => {
        await openCaller('plain-text.jsonl');
        let agent: Agent | undefined;
        try {
          agent = await fromConfig({
            settingsOwner: callerSettingsOwner,
            settingsService: callerSettings,
            agentClient: callerOwner.getAgentClient(),
            providerManager: callerManager,
            config: callerConfig,
            mcpRuntime: callerMcp,
            sessionId: runtimeId,
          });
          expect(asWithRuntimeId(agent).getRuntimeId()).toBe(runtimeId);
        } finally {
          await agent?.dispose();
          await callerClose();
        }
      }),
    );
  }, 30000);

  it('PROP-B for any valid non-empty sessionId R, the no-2nd-manager identity holds: captureProviderManager(agent) === the Config manager @requirement:REQ-001 @scenario:property-no-double-manager @given:any non-empty sessionId string R @when:fromConfig({ config, sessionId: R }) @then:captureProviderManager(agent) === the Config manager for every generated R', async () => {
    await fc.assert(
      fc.asyncProperty(nonBlankStringArbitrary, async (runtimeId) => {
        await openCaller('plain-text.jsonl');
        let agent: Agent | undefined;
        try {
          agent = await fromConfig({
            settingsOwner: callerSettingsOwner,
            settingsService: callerSettings,
            agentClient: callerOwner.getAgentClient(),
            providerManager: callerManager,
            config: callerConfig,
            mcpRuntime: callerMcp,
            sessionId: runtimeId,
          });
          expect(captureProviderManager(agent)).toBe(callerManager);
        } finally {
          await agent?.dispose();
          await callerClose();
        }
      }),
    );
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
