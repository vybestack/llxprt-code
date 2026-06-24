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
 * the sibling methods getUserTier (agentImpl.ts:755) and getHistory
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

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { buildAgent, type AgentDeps } from '../agentImpl.js';
import { createLoopHolder } from '../loop/rebuildLoop.js';
import { recordOwnership } from '../agentBootstrap.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

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

/**
 * Assembles a real AgentDeps bundle from a real Config (via buildCliStyleConfig)
 * with a CONTROLLABLE resolveClient seam. The config-derived fields (config,
 * providerManager, messageBus, settingsService, runtimeState) are genuine so
 * the AgentImpl constructor's config reads (getAgentClient, getTargetDir,
 * getMcpClientManager, getToolRegistry) succeed against real objects. The
 * lightweight structural fields (runtimeId, runtimeHandle, loopHolder,
 * ownership, rebuildLoop) are real-shaped stand-ins for surfaces the
 * getCurrentSequenceModel path never touches.
 */
function assembleDeps(
  built: Awaited<ReturnType<typeof buildCliStyleConfig>>,
  resolveClient: () => AgentClientContract | undefined,
): AgentDeps {
  const config = built.config;
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'seq-test',
    provider: config.getProvider() ?? 'fake',
    model: config.getModel(),
  });
  const loopHolder = createLoopHolder();
  const ownership = recordOwnership({
    runtimeHandle: { cleanup: () => undefined },
    config,
    messageBus: built.messageBus,
    loopHolder,
    runtimeState,
    injectedSchedulerHandles: [],
    configOwnership: 'caller',
  });
  return {
    config,
    // Config exposes the runtime-adopted ProviderManager (configBaseCore.ts:265).
    providerManager: config.getProviderManager()!,
    // getCurrentSequenceModel never reads oauthManager; structural stand-in keeps the cast localized.
    oauthManager: {} as unknown as AgentDeps['oauthManager'],
    settingsService: config.getSettingsService(),
    runtimeId: 'seq-test',
    runtimeHandle: { cleanup: () => undefined },
    messageBus: built.messageBus,
    loopHolder,
    runtimeState,
    ownership,
    rebuildLoop: () => undefined,
    // resolveClient may yield undefined (T9c null-guard case); AgentDeps types it non-optional,
    // so cast the variance at this single injected seam (runtime null-guard is the behavior under test).
    resolveClient: resolveClient as AgentDeps['resolveClient'],
  };
}

describe('getCurrentSequenceModel delegation @plan:PLAN-20260621-COREAPIREMED.P13 @requirement:REQ-003', () => {
  it('T9a client reports "gpt-4o" → agent.getCurrentSequenceModel() === "gpt-4o" @requirement:REQ-003 @scenario:positive-delegation @given:an agent whose resolveClient returns a client reporting "gpt-4o" @when:agent.getCurrentSequenceModel() @then:returns "gpt-4o"', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const fakeClient = makeSeqClient('gpt-4o');
      const deps = assembleDeps(built, () => fakeClient);
      const agent: Agent = buildAgent(deps);
      expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
    } finally {
      await built.cleanup();
    }
  });

  it('T9b client reports null → agent.getCurrentSequenceModel() === null (genuine contract value, stable across repeated calls) @requirement:REQ-003 @scenario:null-contract @scenario:property @given:an agent whose resolveClient returns a client reporting null @when:agent.getCurrentSequenceModel() is called repeatedly @then:returns null on every call (null-stability property)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const fakeClient = makeSeqClient(null);
      const deps = assembleDeps(built, () => fakeClient);
      const agent: Agent = buildAgent(deps);
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
      await built.cleanup();
    }
  });

  it('T9c resolveClient returns undefined (no client yet) → agent.getCurrentSequenceModel() returns null and does NOT throw @requirement:REQ-003 @scenario:null-guard @given:an agent whose resolveClient returns undefined @when:agent.getCurrentSequenceModel() @then:returns null without throwing', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const deps = assembleDeps(built, () => undefined);
      const agent: Agent = buildAgent(deps);
      expect(agent.getCurrentSequenceModel()).toBeNull();
    } finally {
      await built.cleanup();
    }
  });

  it('T9d after rebind (resolveClient now returns a new client reporting "claude-x") → the SAME agent returns "claude-x" (no caching — R-CLIENT fresh-resolve) @requirement:REQ-003 @scenario:no-caching @given:an agent whose resolveClient closure captures a mutable client reporting "gpt-4o" @when:the captured client is reassigned to one reporting "claude-x" and getCurrentSequenceModel() is called again @then:returns "claude-x" on the SAME agent (proves fresh re-resolve, never cached)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      let current: AgentClientContract | undefined = makeSeqClient('gpt-4o');
      const deps = assembleDeps(built, () => current);
      const agent: Agent = buildAgent(deps);
      // First call resolves the initial client.
      expect(agent.getCurrentSequenceModel()).toBe('gpt-4o');
      // Rebind: the closure now returns a DIFFERENT client on the SAME agent.
      current = makeSeqClient('claude-x');
      expect(agent.getCurrentSequenceModel()).toBe('claude-x');
    } finally {
      await built.cleanup();
    }
  });

  it('PROP round-trip: for any model string s, when the injected client reports s, agent.getCurrentSequenceModel() === s @requirement:REQ-003 @scenario:property-round-trip @given:a random non-empty model string s and an agent whose client reports s @when:agent.getCurrentSequenceModel() @then:returns s (round-trip equality)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), async (s) => {
          const fakeClient = makeSeqClient(s);
          const deps = assembleDeps(built, () => fakeClient);
          const agent: Agent = buildAgent(deps);
          expect(agent.getCurrentSequenceModel()).toBe(s);
        }),
      );
    } finally {
      await built.cleanup();
    }
  });

  it('PROP consumer fallback: (agent.getCurrentSequenceModel() ?? agent.getModel()) equals the client reported sequence model when present, else equals agent.getModel() @requirement:REQ-003 @scenario:property-consumer-fallback @given:a random model string and an agent whose client reports it @when:a consumer computes seq ?? agent.getModel() @then:the result equals the reported model; and when the client reports null the result equals agent.getModel()', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const fallbackModel = built.config.getModel();
      await fc.assert(
        fc.asyncProperty(fc.string({ minLength: 1 }), async (s) => {
          // Present case: seq ?? model === seq.
          const presentClient = makeSeqClient(s);
          const presentDeps = assembleDeps(built, () => presentClient);
          const presentAgent: Agent = buildAgent(presentDeps);
          const presentFallback = presentAgent.getCurrentSequenceModel();
          expect(presentFallback ?? presentAgent.getModel()).toBe(s);

          // Absent case: seq ?? model === agent.getModel().
          const absentClient = makeSeqClient(null);
          const absentDeps = assembleDeps(built, () => absentClient);
          const absentAgent: Agent = buildAgent(absentDeps);
          const absentFallback = absentAgent.getCurrentSequenceModel();
          expect(absentFallback ?? absentAgent.getModel()).toBe(
            absentAgent.getModel(),
          );
          // The absent agent's getModel mirrors the Config model.
          expect(absentAgent.getModel()).toBe(fallbackModel);
        }),
      );
    } finally {
      await built.cleanup();
    }
  });

  // ─── Genuine null contract via the REAL path (distinct from T9b's injected
  // seam): proves the real fake-provider client reports null sequence model
  // (no load-balancer sticky model under the fake seam) and that the public
  // fromConfig-built agent surfaces that genuine null. This is NOT a reverse
  // test — null IS the real contract value here.
  it('T9b-real fromConfig-built agent over the fake seam returns null (genuine null contract, real client) @requirement:REQ-003 @scenario:null-contract-real @given:a real agent built via fromConfig over the fake-provider seam @when:agent.getCurrentSequenceModel() @then:returns null (the real fake-provider client reports no sequence model)', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const agent: Agent = await fromConfig({ config: built.config });
      try {
        expect(agent.getCurrentSequenceModel()).toBeNull();
      } finally {
        await agent.dispose();
      }
    } finally {
      await built.cleanup();
    }
  });
});
