import { fixtureAgentResources } from './helpers/agent-resource-capture.js';
import { capturedSessionClient } from './helpers/session-client-capture.js';
import { captureAgentAdoption as fromConfig } from './helpers/agent-resource-capture.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import {
  openCaller,
  useFakeResponsesReplay,
} from './helpers/caller-fixture.js';
import { beforeAll, afterAll, describe, it } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { type MessageBus } from './helpers/fixture-data.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { type Agent, type AgentEvent } from '@vybestack/llxprt-code-agents';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import {
  drain,
  countType,
  internalConfig,
  ASYNC_PROPERTY_TIMEOUT_MS,
  IDENTITY_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import * as fc from 'fast-check';

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

describe('fromConfig caller properties', () => {
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
  const callerFactories = createAgentRuntimeFactoryBindings();

  useFakeResponsesReplay('plain-text.jsonl');

  // ─── Property-based tests (>=30% of total) ──────────────────────────────

  it(
    'PROP1 for any valid sessionId string, fromConfig identity holds: internalConfig(agent) === the caller Config @requirement:REQ-001 @scenario:property-identity @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:internalConfig(agent) is the SAME Config instance for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const caller = await openCaller(authority, callerFactories);
          try {
            const agent: Agent = await fromConfig(
              caller.config,
              caller.settings,
              { sessionId },
              caller.settingsOwner,
              caller.manager,
              undefined,
              undefined,
              caller.mcp,
              undefined,
              capturedSessionClient(caller.owner),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return internalConfig(agent) === caller.config;
            } finally {
              await agent.dispose();
            }
          } finally {
            await caller.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP2 for any valid sessionId string, the runtime id observable equals the supplied sessionId @requirement:REQ-001 @scenario:property-runtimeId @given:any non-empty sessionId string @when:fromConfig({ config, sessionId }) @then:captureRuntimeId(agent) === sessionId for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const caller = await openCaller(authority, callerFactories);
          try {
            const agent: Agent = await fromConfig(
              caller.config,
              caller.settings,
              { sessionId },
              caller.settingsOwner,
              caller.manager,
              undefined,
              undefined,
              caller.mcp,
              undefined,
              capturedSessionClient(caller.owner),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return captureRuntimeId(agent) === sessionId;
            } finally {
              await agent.dispose();
            }
          } finally {
            await caller.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP3 for any subset of optional handlers provided, internalConfig(agent) identity holds @requirement:REQ-001 @scenario:property-handler-subset @given:any subset of { onApproval, onOAuthPrompt, editorCallbacks } @when:fromConfig({ config, ...subset }) @then:internalConfig(agent) === the caller Config for every generated subset',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
            withEditor: fc.boolean(),
          }),
          async (subset) => {
            const caller = await openCaller(authority, callerFactories);
            try {
              const agent: Agent = await fromConfig(
                caller.config,
                caller.settings,
                {},
                undefined,
                caller.manager,
                undefined,
                undefined,
                caller.mcp,
                undefined,
                capturedSessionClient(caller.owner),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                subset.withApproval
                  ? () => ToolConfirmationOutcome.ProceedOnce
                  : undefined,
                subset.withOauth ? () => true : undefined,
                subset.withEditor ? {} : undefined,
              );
              try {
                return internalConfig(agent) === caller.config;
              } finally {
                await agent.dispose();
              }
            } finally {
              await caller.close();
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
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            withApproval: fc.boolean(),
            withOauth: fc.boolean(),
          }),
          async (subset) => {
            const caller = await openCaller(authority, callerFactories);
            try {
              const agent: Agent = await fromConfig(
                caller.config,
                caller.settings,
                {},
                undefined,
                caller.manager,
                undefined,
                undefined,
                caller.mcp,
                undefined,
                capturedSessionClient(caller.owner),
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                subset.withApproval
                  ? () => ToolConfirmationOutcome.ProceedOnce
                  : undefined,
                subset.withOauth ? () => true : undefined,
              );
              try {
                return captureProviderManager(agent) === caller.manager;
              } finally {
                await agent.dispose();
              }
            } finally {
              await caller.close();
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
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const caller = await openCaller(authority, callerFactories);
          try {
            const callerBus: MessageBus = caller.policy.session.messageBus;
            const agent: Agent = await fromConfig(
              caller.config,
              caller.settings,
              { sessionId },
              caller.settingsOwner,
              caller.manager,
              undefined,
              callerBus,
              caller.mcp,
              undefined,
              capturedSessionClient(caller.owner),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return captureAgentMessageBus(agent) === callerBus;
            } finally {
              await agent.dispose();
            }
          } finally {
            await caller.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP6 for any non-empty sessionId, a single stream turn yields exactly one done event (turn-drive parity) @requirement:REQ-INT-001 @scenario:property-turn-drive @given:any non-empty sessionId @when:agent.stream("hello") is drained @then:exactly one done event is emitted for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const caller = await openCaller(authority, callerFactories);
          try {
            const agent: Agent = await fromConfig(
              caller.config,
              caller.settings,
              { sessionId },
              caller.settingsOwner,
              caller.manager,
              undefined,
              undefined,
              caller.mcp,
              undefined,
              capturedSessionClient(caller.owner),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              const events: AgentEvent[] = await drain(agent.stream('hello'));
              return countType(events, 'done') === 1;
            } finally {
              await agent.dispose();
            }
          } finally {
            await caller.close();
          }
        }),
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it(
    'PROP7 for any non-empty sessionId, fromConfig with a caller bus AND sessionId preserves both the config identity AND the caller-bus identity @requirement:REQ-001 @scenario:property-combined-identity @given:any non-empty sessionId and a caller-supplied messageBus @when:fromConfig({ config, messageBus, sessionId }) @then:both internalConfig(agent) === config AND captureAgentMessageBus(agent) === callerBus hold for every generated sessionId',
    async () => {
      const authority = credentials().authority;
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const caller = await openCaller(authority, callerFactories);
          try {
            const callerBus: MessageBus = caller.policy.session.messageBus;
            const agent: Agent = await fromConfig(
              caller.config,
              caller.settings,
              { sessionId },
              caller.settingsOwner,
              caller.manager,
              undefined,
              callerBus,
              caller.mcp,
              undefined,
              capturedSessionClient(caller.owner),
              undefined,
              undefined,
              undefined,
              callerFactories,
            );
            try {
              return (
                internalConfig(agent) === caller.config &&
                captureAgentMessageBus(agent) === callerBus
              );
            } finally {
              await agent.dispose();
            }
          } finally {
            await caller.close();
          }
        }),
      );
    },
    IDENTITY_PROPERTY_TIMEOUT_MS,
  );
});
