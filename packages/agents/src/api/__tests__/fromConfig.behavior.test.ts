/**
 * @license
 * Copyright 2025 Vybestack LLC
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

import { describe, it, expect, vi } from 'bun:test';
import * as fc from 'fast-check';
import {
  fromConfig,
  createAgentClient,
  createToolScheduler,
  createTaskRegistration,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import {
  AsyncTaskManager,
  type RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { disposeCliRuntime } from '@vybestack/llxprt-code-providers/runtime.js';
import { AgentImpl } from '../agentImpl.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  buildCliStyleConfig,
  buildFactoryLessConfig,
  type CallerAgentRuntimeFactories,
} from './helpers/buildCliStyleConfig.js';
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
  ASYNC_PROPERTY_TIMEOUT_MS,
  IDENTITY_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

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

function requireRecord(value: unknown, label: string): RecordLike {
  const record = asRecord(value);
  if (record === null) {
    throw new Error(`Expected ${label} to be an object`);
  }
  return record;
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

/** Reaches the AgentImpl messageBus field (agentImpl.ts AgentDeps). */
function captureAgentMessageBus(agent: Agent): unknown {
  const impl = asRecord(agent);
  if (impl === null) {
    return undefined;
  }
  return impl['messageBus'] ?? impl['bus'] ?? undefined;
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

function createSignal(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = (): void => {
    throw new Error('signal initialized without a resolver');
  };
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}

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

describe('fromConfig tokenizer readiness @requirement:REQ-3217-001 @requirement:REQ-3217-003', () => {
  it('awaits post-activation provider/model preparation before returning a usable Agent', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const preparationStarted = createSignal();
    const releasePreparation = createSignal();
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
    built.config.setTokenizerFactory(factory);

    try {
      const pendingAgent = fromConfig({
        config: built.config,
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
        expect(built.config.getTokenizerFactory()).toBe(factory);

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
      await built.cleanup();
    }
  });
});

describe('fromConfig behavior @plan:PLAN-20260621-COREAPIREMED.P08 @requirement:REQ-001 @requirement:REQ-INT-001', () => {
  it('T1 fromConfig returns an Agent whose internalConfig(agent) === the SAME caller-supplied Config (identity) @requirement:REQ-001 @scenario:adoption @given:a real CLI-style Config @when:fromConfig({ config }) @then:internalConfig(agent) is the SAME Config instance', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const agent: Agent = await fromConfig({ config });
      expect(internalConfig(agent)).toBe(config);
    } finally {
      await built.cleanup();
    }
  });

  it('T1b internalConfig(agent).getSettingsService() === the caller Config getSettingsService() (identity) @requirement:REQ-001 @scenario:adoption @given:a real CLI-style Config @when:fromConfig({ config }) @then:internalConfig(agent).getSettingsService() is the SAME SettingsService instance', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const expected = config.getSettingsService();
      const agent: Agent = await fromConfig({ config });
      expect(internalConfig(agent).getSettingsService()).toBe(expected);
    } finally {
      await built.cleanup();
    }
  });

  it('T1c fromConfig adopts the provider and model already on the Config (value assertions) @requirement:REQ-001 @scenario:adoption @given:a Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      expect(agent.getProvider()).toBe('fake');
      expect(agent.getModel()).toBe('fake-model');
    } finally {
      await built.cleanup();
    }
  });

  it('T1d fromConfig({}) without a config rejects with a clear validation error (NOT NotYetImplemented) @requirement:REQ-001 @scenario:validation @given:an options object missing the required config field @when:fromConfig({} as never) @then:the promise rejects with an Error whose message names the missing config field (never the NotYetImplemented stub string)', async () => {
    await expect(fromConfig({} as never)).rejects.toThrow(/config|Config/i);
  });

  it('T1e fromConfig with sessionId sets the runtime id deterministically; without sessionId it derives a non-empty runtime id @requirement:REQ-001 @scenario:runtimeId @given:a caller-supplied sessionId @when:fromConfig({ config, sessionId }) @then:the runtime id observable equals the supplied sessionId; @given:no sessionId @then:the runtime id observable is a non-empty generated string', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agentNamed: Agent = await fromConfig({
        config: built.config,
        sessionId: 'deterministic-session-42',
      });
      expect(captureRuntimeId(agentNamed)).toBe('deterministic-session-42');
    } finally {
      await built.cleanup();
    }
  });

  it('T1e-deriv without sessionId the runtime derives a non-empty generated id @requirement:REQ-001 @scenario:runtimeId @given:no sessionId @when:fromConfig({ config }) @then:the runtime id observable is a non-empty generated string', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      const id = captureRuntimeId(agent);
      expect(typeof id).toBe('string');
      expect((id as string).length).toBeGreaterThan(0);
    } finally {
      await built.cleanup();
    }
  });

  it('T6 no second ProviderManager (CRIT-1): the runtime reachable post-build IS the SAME manager instance as config.getProviderManager() (identity) @requirement:REQ-001 @scenario:no-double-manager @given:a Config whose getProviderManager() returns a real manager @when:fromConfig({ config }) @then:the agent runtime manager is the SAME instance (no second manager constructed)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const callerManager = config.getProviderManager();
      const agent: Agent = await fromConfig({ config });
      expect(captureProviderManager(agent)).toBe(callerManager);
    } finally {
      await built.cleanup();
    }
  });

  it('T6-adopted-switch a provider switch through the agent resolves the adopted runtime (value parity, no crash) @requirement:REQ-001 @scenario:provider-switch @given:a fromConfig agent over a Config with one manager @when:setProvider("fake") is invoked @then:the switch completes without throwing and the active provider reflects the adopted runtime', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      await agent.setProvider('fake', 'fake-model');
      expect(agent.getProvider()).toBe('fake');
    } finally {
      await built.cleanup();
    }
  });

  it('T6b single-manager turn drive: the adopted runtime manager is the ONLY manager governing — a stream turn resolves through it to exactly one done (no second construction) @requirement:REQ-001 @scenario:single-manager-drive @given:a fromConfig agent over the helper Config (whose getProviderManager() supplies one manager) @when:a single stream turn is driven through the agent @then:the agent runtime manager observable is the SAME instance the Config supplied AND the turn resolves to exactly one done event — a single adopted manager governs the turn, not a freshly-built one', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const callerManager = config.getProviderManager();
      const agent: Agent = await fromConfig({ config });
      expect(captureProviderManager(agent)).toBe(callerManager);
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
      expect(captureProviderManager(agent)).toBe(callerManager);
    } finally {
      await built.cleanup();
    }
  });

  it('T6c caller MessageBus adoption (CRIT-2): fromConfig({ config, messageBus }) — the runtime bus IS the caller-supplied bus instance (identity, NOT a second bus) @requirement:REQ-001 @scenario:caller-bus @given:a caller-supplied MessageBus instance @when:fromConfig({ config, messageBus }) @then:the runtime/OAuth-path bus observable is the SAME instance (no second bus constructed)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        config: built.config,
        messageBus: callerBus,
      });
      expect(captureAgentMessageBus(agent)).toBe(callerBus);
    } finally {
      await built.cleanup();
    }
  });

  it('routes skill and MCP lifecycle work through each same-label session bus when both sessions adopt one Config', async () => {
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      {},
      { skillsSupport: true },
    );
    const config = built.config;
    const busA = built.messageBus;
    const busB = new MessageBus(
      config.getPolicyEngine(),
      config.getDebugMode(),
    );
    const skillBuses: MessageBus[] = [];
    const mcpBuses: MessageBus[] = [];
    config.setPostSkillDiscoveryToolRegistrar(
      (_registry, _skillService, messageBus) => {
        skillBuses.push(messageBus);
      },
    );
    vi.spyOn(config, 'refreshMcpContext').mockImplementation(
      async (messageBus) => {
        mcpBuses.push(messageBus);
      },
    );
    let agentA: Agent | undefined;
    let agentB: Agent | undefined;
    try {
      agentA = await fromConfig({
        config,
        messageBus: busA,
        sessionId: 'shared-label',
      });
      agentB = await fromConfig({
        config,
        messageBus: busB,
        sessionId: 'shared-label',
      });
      expect(agentA.getMessageBus()).toBe(busA);
      expect(agentB.getMessageBus()).toBe(busB);
      expect(agentA.mcp).not.toBe(agentB.mcp);
      skillBuses.length = 0;
      mcpBuses.length = 0;

      await agentA.skills.reload();
      expect(skillBuses).toStrictEqual([busA, busA, busB]);
      await agentB.skills.reload();
      expect(skillBuses).toStrictEqual([busA, busA, busB, busB, busA, busB]);
      await agentA.mcp.refresh();
      await agentB.mcp.refresh();

      expect(mcpBuses).toHaveLength(2);
      expect(mcpBuses[0]).toBe(busA);
      expect(mcpBuses[1]).toBe(busB);

      await agentB.dispose();
      agentB = undefined;
      skillBuses.length = 0;
      await agentA.skills.reload();
      expect(skillBuses).toStrictEqual([busA, busA]);
    } finally {
      await agentB?.dispose();
      await agentA?.dispose();
      await built.cleanup();
      busA.removeAllListeners();
      busB.removeAllListeners();
    }
  });

  it('T6d no Config.getMessageBus (CRIT-2): fromConfig({ config }) WITHOUT messageBus builds exactly one bus from config.getPolicyEngine() and never reads a bus off the Config — a turn still drives and exactly one bus governs @requirement:REQ-001 @scenario:single-bus @given:a Config with no caller-supplied messageBus and NO getMessageBus method @when:fromConfig({ config }) and a single stream turn @then:the turn drives without crashing and the runtime has exactly one non-null bus', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      expect(
        typeof (config as unknown as { getMessageBus?: unknown }).getMessageBus,
      ).toBe('undefined');
      const agent: Agent = await fromConfig({ config });
      const bus = captureAgentMessageBus(agent);
      expect(bus).toBeDefined();
      expect(bus).not.toBeNull();
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.cleanup();
    }
  });

  it('T7 ownership: agent.dispose() does NOT dispose a fromConfig-supplied Config — the caller Config agentClient is NOT torn down @requirement:REQ-001.3 @scenario:caller-owned-config @given:a fromConfig agent over a caller-supplied Config @when:agent.dispose() runs @then:agentClientDisposed(probe) === false (the caller retains ownership of the Config lifecycle)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      const probe: DisposalProbe = captureProbe(agent);
      const callerProbe = {
        ...probe,
        agentClient: built.config.getAgentClient(),
      };
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(agentClientDisposed(probe)).toBe(true);
      expect(agentClientDisposed(callerProbe)).toBe(false);
    } finally {
      await built.cleanup();
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

  it('keeps the adopted Config and borrowed bus functional while disposal joins an in-flight task', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const taskJoin = createSignal();
    try {
      const callerBus: MessageBus = built.messageBus;
      const eventType = MessageBusType.TOOL_CONFIRMATION_REQUEST;
      const subscribeOn = (): number => {
        callerBus.subscribe(eventType, () => undefined);
        return callerBus.listenerCount(eventType);
      };
      const before = subscribeOn();
      expect(before).toBeGreaterThanOrEqual(1);
      const agent: Agent = await fromConfig({
        config: built.config,
        messageBus: callerBus,
      });
      const impl = requireRecord(agent, 'AgentImpl');
      const deps = requireRecord(impl['deps'], 'AgentImpl deps');
      const taskServices = requireRecord(
        deps['taskServices'],
        'session task services',
      );
      const manager: unknown = taskServices['manager'];
      if (!(manager instanceof AsyncTaskManager)) {
        throw new Error('Agent has no session task manager');
      }
      const cancellationStarted = createSignal();
      const controller = new AbortController();
      controller.signal.addEventListener('abort', cancellationStarted.resolve, {
        once: true,
      });
      manager.registerTask({
        id: 'borrowed-resource-join',
        subagentName: 'worker',
        goalPrompt: 'hold disposal open',
        abortController: controller,
      });
      manager.trackExecution('borrowed-resource-join', taskJoin.promise);

      let disposalSettled = false;
      const disposal = agent.dispose().then(() => {
        disposalSettled = true;
      });
      await cancellationStarted.promise;
      expect(disposalSettled).toBe(false);
      expect(internalConfig(agent)).toBe(built.config);
      built.config.setModel('during-disposal-model');
      expect(built.config.getModel()).toBe('during-disposal-model');
      const during = callerBus.listenerCount(eventType);
      expect(subscribeOn()).toBe(during + 1);

      taskJoin.resolve();
      await disposal;
      expect(callerBus.listenerCount(eventType)).toBe(before + 1);
      expect(subscribeOn()).toBe(before + 2);
      callerBus.removeAllListeners();
      expect(callerBus.listenerCount(eventType)).toBe(0);
    } finally {
      taskJoin.resolve();
      await built.cleanup();
    }
  });

  it('T10 smoke: a single turn via agent.stream() over the FakeProvider fixture yields exactly one done event @requirement:REQ-INT-001 @scenario:turn-drive @given:a fromConfig agent over the plain-text fixture @when:agent.stream("hello") is drained @then:exactly one done event is emitted', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      const events: AgentEvent[] = await drain(agent.stream('hello'));
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await built.cleanup();
    }
  });

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it(
    'PROP1 for any valid sessionId string, fromConfig identity holds: internalConfig(agent) === the caller Config @requirement:REQ-001 @scenario:property-identity @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:internalConfig(agent) is the SAME Config instance for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({
              config: built.config,
              sessionId,
            });
            return internalConfig(agent) === built.config;
          } finally {
            await built.cleanup();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP2 for any valid sessionId string, the runtime id observable equals the supplied sessionId @requirement:REQ-001 @scenario:property-runtimeId @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:captureRuntimeId(agent) === sessionId for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({
              config: built.config,
              sessionId,
            });
            return captureRuntimeId(agent) === sessionId;
          } finally {
            await built.cleanup();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP3 for any subset of optional handlers provided, internalConfig(agent) identity holds @requirement:REQ-001 @scenario:property-handler-subset @given:any subset of { onApproval, onOAuthPrompt, editorCallbacks } @when:fromConfig({ config, ...subset }) @then:internalConfig(agent) === the caller Config for every generated subset',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
            withEditor: fc.boolean(),
          }),
          async (subset) => {
            const built = await buildCliStyleConfig('plain-text.jsonl');
            try {
              const opts: Record<string, unknown> = { config: built.config };
              if (subset.withApproval) {
                opts['onApproval'] = () => ({
                  outcome: ToolConfirmationOutcome.ProceedOnce,
                });
              }
              if (subset.withOauth) {
                opts['onOAuthPrompt'] = () => true;
              }
              if (subset.withEditor) {
                opts['editorCallbacks'] = {};
              }
              const agent: Agent = await fromConfig(
                opts as unknown as Parameters<typeof fromConfig>[0],
              );
              return internalConfig(agent) === built.config;
            } finally {
              await built.cleanup();
            }
          },
        ),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP4 for any subset of optional handlers provided, the no-second-manager invariant holds (the runtime manager IS the caller manager) @requirement:REQ-001 @scenario:property-no-double-manager @given:any subset of optional handlers @when:fromConfig({ config, ...subset }) @then:captureProviderManager(agent) === config.getProviderManager() for every generated subset',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
          }),
          async (subset) => {
            const built = await buildCliStyleConfig('plain-text.jsonl');
            try {
              const opts: Record<string, unknown> = { config: built.config };
              if (subset.withApproval) {
                opts['onApproval'] = () => ({
                  outcome: ToolConfirmationOutcome.ProceedOnce,
                });
              }
              if (subset.withOauth) {
                opts['onOAuthPrompt'] = () => true;
              }
              const agent: Agent = await fromConfig(
                opts as unknown as Parameters<typeof fromConfig>[0],
              );
              const callerManager = built.config.getProviderManager();
              return captureProviderManager(agent) === callerManager;
            } finally {
              await built.cleanup();
            }
          },
        ),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP5 for any non-empty sessionId, the caller-supplied MessageBus adoption invariant holds (the runtime bus IS the caller bus) @requirement:REQ-001 @scenario:property-caller-bus @given:any non-empty sessionId and a caller-supplied messageBus @when:fromConfig({ config, messageBus, sessionId }) @then:captureAgentMessageBus(agent) === callerBus for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const callerBus: MessageBus = built.messageBus;
            const agent: Agent = await fromConfig({
              config: built.config,
              messageBus: callerBus,
              sessionId,
            });
            return captureAgentMessageBus(agent) === callerBus;
          } finally {
            await built.cleanup();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP6 for any non-empty sessionId, a single stream turn yields exactly one done event (turn-drive parity) @requirement:REQ-INT-001 @scenario:property-turn-drive @given:any non-empty sessionId @when:agent.stream("hello") is drained @then:exactly one done event is emitted for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const agent: Agent = await fromConfig({
              config: built.config,
              sessionId,
            });
            const events: AgentEvent[] = await drain(agent.stream('hello'));
            return countType(events, 'done') === 1;
          } finally {
            await built.cleanup();
          }
        }),
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP7 for any non-empty sessionId, fromConfig with a caller bus AND sessionId preserves both the config identity AND the caller-bus identity @requirement:REQ-001 @scenario:property-combined-identity @given:any non-empty sessionId and a caller-supplied messageBus @when:fromConfig({ config, messageBus, sessionId }) @then:both internalConfig(agent) === config AND captureAgentMessageBus(agent) === callerBus hold for every generated sessionId',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const built = await buildCliStyleConfig('plain-text.jsonl');
          try {
            const callerBus: MessageBus = built.messageBus;
            const agent: Agent = await fromConfig({
              config: built.config,
              messageBus: callerBus,
              sessionId,
            });
            return (
              internalConfig(agent) === built.config &&
              captureAgentMessageBus(agent) === callerBus
            );
          } finally {
            await built.cleanup();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );
});

// ─── Agent-owned runtime factory defaults on adoption (issue #3222) ─────────
//
// A non-CLI API consumer builds a MINIMAL Config with no agent runtime
// factories (buildFactoryLessConfig mirrors exactly that). fromConfig must
// adopt it into a working agent by installing agent-owned defaults for
// anything absent — while NEVER overriding caller-supplied factories.

describe('fromConfig agent-owned assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC2', () => {
  it('T2a adopting a factory-less minimal Config yields a working agent: the client initializes, its scheduler is creatable, and the shipped task tool is registered @requirement:REQ-3222-AC2 @scenario:factory-less-adoption @given:a minimal Config with no agent factories or task registration @when:fromConfig({ config, sessionId, messageBus }) @then:the client initializes, the agent scheduler acquires a handle, and the tool surface lists "task"', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    const runtimeId = 'issue3222-fromconfig-factoryless';
    try {
      const agent: Agent = await fromConfig({
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
      });
      try {
        const config = internalConfig(agent);

        const scheduler = await agent.scheduler.acquire(
          agent,
          'session',
          {
            outputUpdateHandler: vi.fn(),
            onAllToolCallsComplete: vi.fn(),
            getPreferredEditor: vi.fn(),
            onEditorClose: vi.fn(),
          },
          undefined,
          {
            messageBus: built.messageBus,
            toolRegistry: config.getToolRegistry(),
          },
        );
        expect(scheduler).toBeDefined();
        agent.scheduler.release(agent, 'session', scheduler);

        const names = agent.tools.list().map((tool) => tool.name);
        expect(names).toContain('task');

        // The client reports initialized through the public readiness
        // signal once a turn has driven it — chat creation is lazy by
        // design in AgentClient (same as the CLI-style adoption path).
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
        if (!(agent instanceof AgentImpl)) {
          throw new Error('Expected the real Agent implementation');
        }
        expect(agent.agentClient.isInitialized()).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });

  it('T2b caller-supplied factories survive adoption and drive a turn @requirement:REQ-3222-AC2 @scenario:caller-wins @given:a minimal Config with caller client and task factories and an explicit agent scheduler factory @when:fromConfig({ config, sessionId, toolSchedulerFactory }) @then:the client and task factories retain identity, the scheduler factory creates a handle, and a turn completes', async () => {
    const runtimeId = 'issue3222-fromconfig-callercwins';
    let created = 0;
    const callerFactories: CallerAgentRuntimeFactories = {
      agentClientFactory: (config, runtimeState) =>
        createAgentClient(config, runtimeState),
      toolSchedulerFactory: (options) => {
        created++;
        return createToolScheduler(options);
      },
      taskToolRegistration: createTaskRegistration(),
    };
    const built = await buildFactoryLessConfig('plain-text.jsonl', {
      agentClientFactory: callerFactories.agentClientFactory,
      taskToolRegistration: callerFactories.taskToolRegistration,
    });
    try {
      const agent: Agent = await fromConfig({
        config: built.config,
        sessionId: runtimeId,
        toolSchedulerFactory: callerFactories.toolSchedulerFactory,
      });
      try {
        const config = internalConfig(agent);
        expect(config.getAgentClientFactory()).toBe(
          callerFactories.agentClientFactory,
        );
        const scheduler = await agent.scheduler.acquire(
          agent,
          'session',
          { getPreferredEditor: () => undefined, onEditorClose: () => {} },
          undefined,
          {
            messageBus: built.messageBus,
            toolRegistry: config.getToolRegistry(),
          },
        );
        expect(created).toBe(1);
        agent.scheduler.release(agent, 'session', scheduler);
        expect(config.getTaskToolRegistration()).toBe(
          callerFactories.taskToolRegistration,
        );

        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await disposeCliRuntime(runtimeId);
      await built.cleanup();
    }
  });

  it(
    'T2b-PROP for any non-empty sessionId, caller factories keep their identity through adoption @requirement:REQ-3222-AC2 @scenario:caller-wins @given:any non-empty sessionId and caller factories @when:fromConfig({ config, sessionId, toolSchedulerFactory }) @then:client and task factories retain identity and the agent creates a scheduler',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          let creations = 0;
          const callerFactories: CallerAgentRuntimeFactories = {
            agentClientFactory: (config, runtimeState) =>
              createAgentClient(config, runtimeState),
            toolSchedulerFactory: (options) => {
              creations++;
              return createToolScheduler(options);
            },
            taskToolRegistration: createTaskRegistration(),
          };
          const built = await buildFactoryLessConfig('plain-text.jsonl', {
            agentClientFactory: callerFactories.agentClientFactory,
            taskToolRegistration: callerFactories.taskToolRegistration,
          });
          try {
            const agent: Agent = await fromConfig({
              config: built.config,
              sessionId,
              toolSchedulerFactory: callerFactories.toolSchedulerFactory,
            });
            try {
              const config = internalConfig(agent);
              const scheduler = await agent.scheduler.acquire(
                agent,
                'session',
                {
                  getPreferredEditor: () => undefined,
                  onEditorClose: () => {},
                },
                undefined,
                {
                  messageBus: built.messageBus,
                  toolRegistry: config.getToolRegistry(),
                },
              );
              agent.scheduler.release(agent, 'session', scheduler);
              return (
                config.getAgentClientFactory() ===
                  callerFactories.agentClientFactory &&
                config.getTaskToolRegistration() ===
                  callerFactories.taskToolRegistration &&
                creations === 1
              );
            } finally {
              await agent.dispose();
            }
          } finally {
            await disposeCliRuntime(sessionId);
            await built.cleanup();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
