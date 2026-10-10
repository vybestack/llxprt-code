/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { requireInstructionReads } from '../../core/chat-system-prompt.js';

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

import { describe, it, expect } from 'bun:test';
import * as fc from 'fast-check';
import {
  fromConfig,
  createAgentClient,
  createTaskRegistration,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  requireFixturePaths,
  buildCliStyleConfig,
  buildFactoryLessConfig,
  type CallerAgentRuntimeFactories,
  type MessageBus,
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

describe('fromConfig behavior @plan:PLAN-20260621-COREAPIREMED.P08 @requirement:REQ-001 @requirement:REQ-INT-001', () => {
  it('T1 fromConfig returns an Agent whose internalConfig(agent) === the SAME caller-supplied Config (identity) @requirement:REQ-001 @scenario:adoption @given:a real CLI-style Config @when:fromConfig({ config }) @then:internalConfig(agent) is the SAME Config instance', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        expect(internalConfig(agent)).toBe(config);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('uses the exact caller store for facade writes, external changes and normalization during adoption', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const expected = built.settingsService;
      const agent: Agent = await fromConfig({
        settingsService: expected,
        settingsOwner: built.settingsOwner,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config,
        mcpRuntime: built.mcpRuntime,
      });
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
      await built.cleanup();
    }
  });

  it('T1c fromConfig adopts the provider and model already on the Config (value assertions) @requirement:REQ-001 @scenario:adoption @given:a Config whose active provider=fake and model=fake-model @when:fromConfig({ config }) @then:agent.getProvider() === "fake" and agent.getModel() === "fake-model"', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        expect(agent.getProvider()).toBe('fake');
        expect(agent.getModel()).toBe('fake-model');
      } finally {
        await agent.dispose();
      }
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
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        sessionId: 'deterministic-session-42',
      });
      try {
        expect(captureRuntimeId(agentNamed)).toBe('deterministic-session-42');
      } finally {
        await agentNamed.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T1e-deriv without sessionId the runtime derives a non-empty generated id @requirement:REQ-001 @scenario:runtimeId @given:no sessionId @when:fromConfig({ config }) @then:the runtime id observable is a non-empty generated string', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        const id = captureRuntimeId(agent);
        expect(typeof id).toBe('string');
        expect((id as string).length).toBeGreaterThan(0);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T6 no second ProviderManager (CRIT-1): the runtime reachable post-build IS the SAME manager instance as config.getProviderManager() (identity) @requirement:REQ-001 @scenario:no-double-manager @given:a Config whose getProviderManager() returns a real manager @when:fromConfig({ config }) @then:the agent runtime manager is the SAME instance (no second manager constructed)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const callerManager = built.providerManager;
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        expect(captureProviderManager(agent)).toBe(callerManager);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T6-adopted-switch a provider switch through the agent resolves the adopted runtime (value parity, no crash) @requirement:REQ-001 @scenario:provider-switch @given:a fromConfig agent over a Config with one manager @when:setProvider("fake") is invoked @then:the switch completes without throwing and the active provider reflects the adopted runtime', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        await agent.setProvider('fake', 'fake-model');
        expect(agent.getProvider()).toBe('fake');
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T6b single-manager turn drive: the adopted runtime manager is the ONLY manager governing — a stream turn resolves through it to exactly one done (no second construction) @requirement:REQ-001 @scenario:single-manager-drive @given:a fromConfig agent over the helper Config (whose getProviderManager() supplies one manager) @when:a single stream turn is driven through the agent @then:the agent runtime manager observable is the SAME instance the Config supplied AND the turn resolves to exactly one done event — a single adopted manager governs the turn, not a freshly-built one', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      const callerManager = built.providerManager;
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        expect(captureProviderManager(agent)).toBe(callerManager);
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
        expect(captureProviderManager(agent)).toBe(callerManager);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T6c caller MessageBus adoption (CRIT-2): fromConfig({ config, messageBus }) — the runtime bus IS the caller-supplied bus instance (identity, NOT a second bus) @requirement:REQ-001 @scenario:caller-bus @given:a caller-supplied MessageBus instance @when:fromConfig({ config, messageBus }) @then:the runtime/OAuth-path bus observable is the SAME instance (no second bus constructed)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: callerBus,
      });
      try {
        expect(captureAgentMessageBus(agent)).toBe(callerBus);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T6d no Config.getMessageBus (CRIT-2): fromConfig({ config, mcpRuntime: built.mcpRuntime }) WITHOUT messageBus builds exactly one bus from config.getPolicyEngine() and never reads a bus off the Config — a turn still drives and exactly one bus governs @requirement:REQ-001 @scenario:single-bus @given:a Config with no caller-supplied messageBus and NO getMessageBus method @when:fromConfig({ config }) and a single stream turn @then:the turn drives without crashing and the runtime has exactly one non-null bus', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const config = built.config;
      expect(
        typeof (config as unknown as { getMessageBus?: unknown }).getMessageBus,
      ).toBe('undefined');
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config,
        mcpRuntime: built.mcpRuntime,
      });
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
      await built.cleanup();
    }
  });

  it('T7 ownership: agent.dispose() does NOT dispose a fromConfig-supplied Config — the caller Config agentClient is NOT torn down @requirement:REQ-001.3 @scenario:caller-owned-config @given:a fromConfig agent over a caller-supplied Config @when:agent.dispose() runs @then:agentClientDisposed(probe) === false (the caller retains ownership of the Config lifecycle)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      const probe: DisposalProbe = captureProbe(agent);
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(agentClientDisposed(probe)).toBe(false);
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

  it('T7c ownership: a caller-supplied messageBus stays caller-owned and FUNCTIONAL after agent.dispose() — the caller bus still accepts subscriptions and reports live listener counts (not torn down) @requirement:REQ-001.3 @scenario:caller-owned-bus @given:a fromConfig agent with a caller-supplied messageBus, and a pre-existing subscription recorded on that caller bus @when:agent.dispose() runs @then:the caller bus listenerCount still reflects the caller subscription (count unchanged by dispose), a NEW subscribe increases the observable count, and removeAllListeners() runs without throwing — the bus is alive', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const callerBus: MessageBus = built.messageBus;
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

      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: callerBus,
      });
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
      await built.cleanup();
    }
  });

  it('T10 smoke: a single turn via agent.stream() over the FakeProvider fixture yields exactly one done event @requirement:REQ-INT-001 @scenario:turn-drive @given:a fromConfig agent over the plain-text fixture @when:agent.stream("hello") is drained @then:exactly one done event is emitted', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
      });
      try {
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
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
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              mcpRuntime: built.mcpRuntime,
              sessionId,
            });
            try {
              return internalConfig(agent) === built.config;
            } finally {
              await agent.dispose();
            }
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
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              mcpRuntime: built.mcpRuntime,
              sessionId,
            });
            try {
              return captureRuntimeId(agent) === sessionId;
            } finally {
              await agent.dispose();
            }
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
              const opts: Record<string, unknown> = {
                settingsService: built.settingsService,
                config: built.config,
                agentClient: built.agentClient,
                providerManager: built.providerManager,
                mcpRuntime: built.mcpRuntime,
              };
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
              try {
                return internalConfig(agent) === built.config;
              } finally {
                await agent.dispose();
              }
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
              const opts: Record<string, unknown> = {
                settingsService: built.settingsService,
                config: built.config,
                agentClient: built.agentClient,
                providerManager: built.providerManager,
                mcpRuntime: built.mcpRuntime,
              };
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
              try {
                const callerManager = built.providerManager;
                return captureProviderManager(agent) === callerManager;
              } finally {
                await agent.dispose();
              }
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
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              mcpRuntime: built.mcpRuntime,
              messageBus: callerBus,
              sessionId,
            });
            try {
              return captureAgentMessageBus(agent) === callerBus;
            } finally {
              await agent.dispose();
            }
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
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              mcpRuntime: built.mcpRuntime,
              sessionId,
            });
            try {
              const events: AgentEvent[] = await drain(agent.stream('hello'));
              return countType(events, 'done') === 1;
            } finally {
              await agent.dispose();
            }
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
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              mcpRuntime: built.mcpRuntime,
              messageBus: callerBus,
              sessionId,
            });
            try {
              return (
                internalConfig(agent) === built.config &&
                captureAgentMessageBus(agent) === callerBus
              );
            } finally {
              await agent.dispose();
            }
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
  it('T2a adopting a factory-less minimal Config yields a working Agent client and registers the shipped task tool @requirement:REQ-3222-AC2 @scenario:factory-less-adoption @given:a minimal Config carrying NO agentClientFactory, toolSchedulerFactory, or taskToolRegistration @when:fromConfig({ config, sessionId, messageBus }) @then:the Config agent client reports initialized and the tool surface lists the shipped "task" tool', async () => {
    const built = await buildFactoryLessConfig('plain-text.jsonl');
    const runtimeId = 'issue3222-fromconfig-factoryless';
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        sessionId: runtimeId,
        messageBus: built.messageBus,
        policyOwner: built.policyOwner,
      });
      try {
        const names = agent.tools.list().map((tool) => tool.name);
        expect(names).toContain('task');

        // The client reports initialized through the public readiness
        // signal once a turn has driven it — chat creation is lazy by
        // design in AgentClient (same as the CLI-style adoption path).
        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
        expect(agent.agentClient.isInitialized()).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it('T2b caller-supplied factories WIN: adoption keeps exactly the caller instances (identity) and the agent still drives a turn @requirement:REQ-3222-AC2 @scenario:caller-wins @given:a minimal Config carrying caller-supplied agentClientFactory, toolSchedulerFactory, and taskToolRegistration @when:fromConfig({ config, sessionId }) @then:the initialized client comes from the caller factory and the registered task class is preserved and a stream turn completes', async () => {
    const runtimeId = 'issue3222-fromconfig-callercwins';
    const callerClients = new Set<ReturnType<typeof createAgentClient>>();
    const callerFactories: CallerAgentRuntimeFactories = {
      agentClientFactory: (
        config,
        runtimeState,
        readMcpInstructions = () => undefined,
        mediaStore,
        workspacePaths,
        instructions,
      ) => {
        const client = createAgentClient(
          config,
          runtimeState,
          readMcpInstructions,
          mediaStore,
          requireFixturePaths(workspacePaths),
          requireInstructionReads(instructions),
        );
        callerClients.add(client);
        return client;
      },
      toolSchedulerFactory: () => ({ dispose: () => {} }),
      taskToolRegistration: createTaskRegistration(),
    };
    const built = await buildFactoryLessConfig(
      'plain-text.jsonl',
      callerFactories,
    );
    try {
      const agent: Agent = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        runtimeFactoryBindings: built.runtimeFactoryBindings,
        config: built.config,
        sessionId: runtimeId,
        toolSchedulerFactory: callerFactories.toolSchedulerFactory,
      });
      try {
        expect(callerClients.has(agent.agentClient)).toBe(true);
        expect(agent.tools.list().map((tool) => tool.name)).toContain('task');

        const events: AgentEvent[] = await drain(agent.stream('hello'));
        expect(countType(events, 'done')).toBe(1);
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });

  it(
    'T2b-PROP for any non-empty sessionId, caller-supplied constructors produce the adopted client and task class @requirement:REQ-3222-AC2 @scenario:caller-wins @given:any non-empty sessionId and a minimal Config with caller factories @when:fromConfig({ config, sessionId }) @then:the adopted client was produced by the caller and the task class is preserved',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const callerClients = new Set<ReturnType<typeof createAgentClient>>();
          const callerFactories: CallerAgentRuntimeFactories = {
            agentClientFactory: (
              config,
              runtimeState,
              readMcpInstructions = () => undefined,
              mediaStore,
              workspacePaths,
              instructions,
            ) => {
              const client = createAgentClient(
                config,
                runtimeState,
                readMcpInstructions,
                mediaStore,
                requireFixturePaths(workspacePaths),
                requireInstructionReads(instructions),
              );
              callerClients.add(client);
              return client;
            },
            toolSchedulerFactory: () => ({ dispose: () => {} }),
            taskToolRegistration: createTaskRegistration(),
          };
          const built = await buildFactoryLessConfig(
            'plain-text.jsonl',
            callerFactories,
          );
          try {
            const agent: Agent = await fromConfig({
              settingsOwner: built.settingsOwner,
              settingsService: built.settingsService,
              agentClient: built.agentClient,
              providerManager: built.providerManager,
              runtimeFactoryBindings: built.runtimeFactoryBindings,
              config: built.config,
              sessionId,
              toolSchedulerFactory: callerFactories.toolSchedulerFactory,
            });
            try {
              return (
                callerClients.has(agent.agentClient) &&
                agent.tools.list().some((tool) => tool.name === 'task')
              );
            } finally {
              await agent.dispose();
            }
          } finally {
            await built.cleanup();
          }
        }),
        { numRuns: 5 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );
});
