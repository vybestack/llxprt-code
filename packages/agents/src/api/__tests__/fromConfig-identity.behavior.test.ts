import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import {
  createCapturedSessionOwner,
  capturedSessionClient,
} from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
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
import { type MessageBus } from './helpers/fixture-data.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { injectConfirmationForcingPolicy } from '../confirmationForcing.js';
import { executeProviderActivation } from '../providerActivationExecutor.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { assembleModelSelection } from '../model-selection.js';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  captureProbe,
  agentClientDisposed,
  type DisposalProbe,
} from './helpers/disposalProbe.js';
import {
  drain,
  countType,
  buildAgent,
  internalConfig,
} from './helpers/agentHarness.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260621-COREAPIREMED.P08
 * @requirement:REQ-001,REQ-INT-001
 *
 * BEHAVIORAL RED suite for the (not-yet-implemented) public `fromConfig` API.
 * Every test fails at RED because the P06 stub raises NotYetImplemented before
 * any agent is returned, so identity/turn/ownership assertions are never
 * reached. These are genuine forward behavioral assertions (identities and
 * values), not assertions about the stub error itself, and contain no mock
 * theater.
 *
 * The suite reuses the CANONICAL config builder (buildCliStyleConfig) and the
 * established disposal-observation probe (disposalProbe) — no duplication.
 * At GREEN (P09) `fromConfig` adopts the external Config and the SAME
 * assertions pass with no rewrite.
 */

// ─── Structural identity probes (cast-free, mirrors agentHarness idiom) ──────
//
// The public Agent surface is opaque (no getRuntimeId / getProviderManager
// accessor). The identity invariants under test (T1e runtime id, T6 provider
// manager, T6c caller MessageBus adoption) are reached via the SAME documented
// structural narrowing idiom the codebase already uses
// (captureHistoryServiceIdentity in agentHarness.ts): treat the Agent as a
// Record<string, unknown> and probe a documented internal field. At RED these
// return undefined because fromConfig throws NotYetImplemented before any agent
// is returned; the identity assertions fail naturally. At GREEN the fields are
// populated and the SAME assertions pass.

interface RecordLike {
  readonly [key: string]: unknown;
}

function asRecord(v: unknown): RecordLike | null {
  return typeof v === 'object' && v !== null ? (v as RecordLike) : null;
}

/** Reaches the AgentImpl providerManager field (agentImpl.ts AgentDeps). */
function captureProviderManager(agent: Agent): unknown {
  return fixtureAgentResources(agent).manager;
}

/** Reaches the AgentImpl messageBus field (agentImpl.ts AgentDeps). */
function captureAgentMessageBus(agent: Agent): unknown {
  return fixtureAgentResources(agent).messageBus;
}

/** Reaches the AgentImpl runtimeId field (agentImpl.ts AgentDeps). */
function captureRuntimeId(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  const id = impl['runtimeId'];
  return typeof id === 'string' ? id : undefined;
}

describe('fromConfig caller identities', () => {
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
    callerOwner = await createCapturedSessionOwner(
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
    await capturedSessionClient(callerOwner).startChat();
  }

  it('T1 fromConfig returns an Agent whose internalConfig(agent) === the SAME caller-supplied Config (identity) @requirement:REQ-001 @scenario:adoption @given:a real CLI-style Config @when:fromConfig({ config }) @then:internalConfig(agent) is the SAME Config instance', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const agent: Agent = await fromConfig(
        config,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
      );
      try {
        expect(internalConfig(agent)).toBe(config);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('uses the exact caller store for facade writes, external changes and normalization during adoption', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const expected = callerSettings;
      const agent: Agent = await fromConfig(
        config,
        expected,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
      );
      try {
        agent.setEphemeralSetting('streaming', false);
        expect(expected.get('streaming')).toBe('disabled');
        expected.set('context-limit', '8192');
        expect(agent.getEphemeralSetting('context-limit')).toBe(8192);
        expect(expected.get('context-limit')).toBe(8192);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T1c fromConfig adopts the provider and model already on the Config (value assertions) @requirement:REQ-001 @scenario:adoption @given:a Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        expect(agent.getProvider()).toBe('fake');
        expect(agent.getModel()).toBe('fake-model');
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T1d fromConfig({}) without a config rejects with a clear validation error (NOT NotYetImplemented) @requirement:REQ-001 @scenario:validation @given:an options object missing the required config field @when:fromConfig({} as never) @then:the promise rejects with an Error whose message names the missing config field (never the NotYetImplemented stub string)', async () => {
    await expect(
      fromConfig(undefined as never, undefined as never),
    ).rejects.toThrow(/config|Config/i);
  });

  it('T1e fromConfig with sessionId sets the runtime id deterministically; without sessionId it derives a non-empty runtime id @requirement:REQ-001 @scenario:runtimeId @given:a caller-supplied sessionId @when:fromConfig({ config, sessionId }) @then:the runtime id observable equals the supplied sessionId; @given:no sessionId @then:the runtime id observable is a non-empty generated string', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agentNamed: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        { sessionId: 'deterministic-session-42' },
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        expect(captureRuntimeId(agentNamed)).toBe('deterministic-session-42');
      } finally {
        await agentNamed.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T1e-deriv without sessionId the runtime derives a non-empty generated id @requirement:REQ-001 @scenario:runtimeId @given:no sessionId @when:fromConfig({ config }) @then:the runtime id observable is a non-empty generated string', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        const id = captureRuntimeId(agent);
        expect(typeof id).toBe('string');
        expect((id as string).length).toBeGreaterThan(0);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T6 no second ProviderManager (CRIT-1): the runtime reachable post-build IS the SAME manager instance as config.getProviderManager() (identity) @requirement:REQ-001 @scenario:no-double-manager @given:a Config whose getProviderManager() returns a real manager @when:fromConfig({ config }) @then:the agent runtime manager is the SAME instance (no second manager constructed)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const agent: Agent = await fromConfig(
        config,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
      );
      try {
        expect(captureProviderManager(agent)).toBe(callerManager);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T6-adopted-switch a provider switch through the agent resolves the adopted runtime (value parity, no crash) @requirement:REQ-001 @scenario:provider-switch @given:a fromConfig agent over a Config with one manager @when:setProvider("fake") is invoked @then:the switch completes without throwing and the active provider reflects the adopted runtime', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        await agent.setProvider('fake', 'fake-model');
        expect(agent.getProvider()).toBe('fake');
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T6b single-manager turn drive: the adopted runtime manager is the ONLY manager governing — a stream turn resolves through it to exactly one done (no second construction) @requirement:REQ-001 @scenario:single-manager-drive @given:a fromConfig agent over the helper Config (whose getProviderManager() supplies one manager) @when:a single stream turn is driven through the agent @then:the agent runtime manager observable is the SAME instance the Config supplied AND the turn resolves to exactly one done event — a single adopted manager governs the turn, not a freshly-built one', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      const agent: Agent = await fromConfig(
        config,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
      );
      try {
        expect(captureProviderManager(agent)).toBe(callerManager);
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
        expect(captureProviderManager(agent)).toBe(callerManager);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T6c caller MessageBus adoption (CRIT-2): fromConfig({ config, messageBus }) — the runtime bus IS the caller-supplied bus instance (identity, NOT a second bus) @requirement:REQ-001 @scenario:caller-bus @given:a caller-supplied MessageBus instance @when:fromConfig({ config, messageBus }) @then:the runtime/OAuth-path bus observable is the SAME instance (no second bus constructed)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const callerBus: MessageBus = callerPolicy.session.messageBus;
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        callerBus,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        expect(captureAgentMessageBus(agent)).toBe(callerBus);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T6d no Config.getMessageBus (CRIT-2): fromConfig({ config, mcpRuntime: built.mcpRuntime }) WITHOUT messageBus builds exactly one bus from config.getPolicyEngine() and never reads a bus off the Config — a turn still drives and exactly one bus governs @requirement:REQ-001 @scenario:single-bus @given:a Config with no caller-supplied messageBus and NO getMessageBus method @when:fromConfig({ config }) and a single stream turn @then:the turn drives without crashing and the runtime has exactly one non-null bus', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const config = callerConfig;
      expect(
        typeof (config as unknown as { getMessageBus?: unknown }).getMessageBus,
      ).toBe('undefined');
      const agent: Agent = await fromConfig(
        config,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
      );
      try {
        const bus = captureAgentMessageBus(agent);
        expect(bus).toBeDefined();
        expect(bus).not.toBeNull();
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
    }
  });

  it('T7 ownership: agent.dispose() does NOT dispose a fromConfig-supplied Config — the caller Config agentClient is NOT torn down @requirement:REQ-001.3 @scenario:caller-owned-config @given:a fromConfig agent over a caller-supplied Config @when:agent.dispose() runs @then:agentClientDisposed(probe) === false (the caller retains ownership of the Config lifecycle)', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      const probe: DisposalProbe = captureProbe(agent);
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(agentClientDisposed(probe)).toBe(false);
    } finally {
      await callerClose();
    }
  });

  it('T7b ownership contrast: a createAgent-created Config IS disposed by agent.dispose() — agentClientDisposed(probe) === true after dispose @requirement:REQ-001.3 @scenario:agent-owned-config @given:a createAgent-built agent (Config owned by the agent) @when:agent.dispose() runs @then:agentClientDisposed(probe) === true (the ownership flag differentiates createAgent from fromConfig)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(agentClientDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T7c ownership: a caller-supplied messageBus stays caller-owned and FUNCTIONAL after agent.dispose() — the caller bus still accepts subscriptions and reports live listener counts (not torn down) @requirement:REQ-001.3 @scenario:caller-owned-bus @given:a fromConfig agent with a caller-supplied messageBus, and a pre-existing subscription recorded on that caller bus @when:agent.dispose() runs @then:the caller bus listenerCount still reflects the caller subscription (count unchanged by dispose), a NEW subscribe increases the observable count, and removeAllListeners() runs without throwing — the bus is alive', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const callerBus: MessageBus = callerPolicy.session.messageBus;
      // Probe the caller bus via the SAME documented structural-narrowing idiom
      // used by captureProviderManager (no deep imports for MessageBusType).
      const bus = asRecord(callerBus);
      const eventType = 'tool-confirmation-request';
      const listenerCountOf = (b: RecordLike): number => {
        const fn = b['listenerCount'];
        return typeof fn === 'function'
          ? (fn.call(callerBus, eventType) as number)
          : -1;
      };
      const subscribeOn = (b: RecordLike): boolean => {
        const fn = b['subscribe'];
        if (typeof fn !== 'function') return false;
        fn.call(callerBus, eventType, () => undefined);
        return true;
      };
      const removeAllOn = (b: RecordLike): boolean => {
        const fn = b['removeAllListeners'];
        if (typeof fn !== 'function') return false;
        fn.call(callerBus);
        return true;
      };
      expect(bus).not.toBeNull();
      // Record a caller-side subscription BEFORE the agent exists.
      expect(subscribeOn(bus as RecordLike)).toBe(true);
      const before = listenerCountOf(bus as RecordLike);
      expect(before).toBeGreaterThanOrEqual(1);

      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        callerBus,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      await agent.dispose();

      // The caller bus must still be ALIVE: its observable listener count is
      // unchanged by agent.dispose() (the caller subscription survived), a NEW
      // subscribe still takes effect (count grows), and removeAllListeners()
      // runs without throwing (count collapses to 0).
      const afterDispose = listenerCountOf(bus as RecordLike);
      expect(afterDispose).toBe(before);
      expect(subscribeOn(bus as RecordLike)).toBe(true);
      expect(listenerCountOf(bus as RecordLike)).toBe(afterDispose + 1);
      expect(removeAllOn(bus as RecordLike)).toBe(true);
      expect(listenerCountOf(bus as RecordLike)).toBe(0);
    } finally {
      await callerClose();
    }
  });

  it('T10 smoke: a single turn via agent.stream() over the FakeProvider fixture yields exactly one done event @requirement:REQ-INT-001 @scenario:turn-drive @given:a fromConfig agent over the plain-text fixture @when:agent.stream("hello") is drained @then:exactly one done event is emitted', async () => {
    await openCaller('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig(
        callerConfig,
        callerSettings,
        {},
        callerSettingsOwner,
        callerManager,
        undefined,
        undefined,
        callerMcp,
        undefined,
        capturedSessionClient(callerOwner),
        undefined,
        undefined,
        undefined,
        callerFactories,
      );
      try {
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await callerClose();
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
