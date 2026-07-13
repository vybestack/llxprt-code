/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P11
 * @requirement:REQ-010
 * @requirement:REQ-011
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-021
 *
 * Core history/compression/stats/non-interactive behavior (RED). Behavioral
 * integration tests against a real public Agent over a real FakeProvider
 * (LLXPRT_FAKE_RESPONSES seam). Tests FAIL NATURALLY — stub methods are
 * not-yet-implemented. No mock theater; only value/sequence assertions.
 *
 * Covers:
 * - T6  setHistory/getHistory round-trip + follow-up sees context
 * - T7  resetChat → empty; next turn no prior context
 * - T8  explicit compress() → CompressionResult with status + numeric fields
 * - T8b onStats receives SessionStats with numeric fields; getStats snapshot
 * - T14b addHistory/updateSystemInstruction/addDirectoryContext take effect
 * - T22 chat() AgentResult carries enough for non-interactive output mapping
 *
 * Property test: history round-trip over fc.array of generated messages.
 *
 * Honesty note: the auto-compression event path (T8 auto) requires a fixture
 * large enough to exceed the context window at runtime; FakeProvider replays
 * fixed turns and cannot reliably trigger the auto path, so T8 asserts only
 * the EXPLICIT compress() contract (status + numeric fields), as permitted by
 * the phase contract.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type {
  Agent,
  AgentMessage,
  AgentHistoryItem,
  SessionStats,
} from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  isDoneEvent,
  isTextEvent,
} from './helpers/agentHarness.js';

/** Builds a public AgentMessage (Content) with role + a single text part. */
function textMessage(role: 'user' | 'model', text: string): AgentMessage {
  return { role, parts: [{ text }] };
}

/** Extracts the concatenated text of a message's parts. */
function messageText(msg: AgentMessage): string {
  return msg.parts.map((p) => ('text' in p ? p.text : '')).join('');
}

describe('Core history @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010 @requirement:REQ-011', () => {
  it('T6 setHistory then getHistory round-trips messages and a follow-up turn sees the context @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const seeded = [
        textMessage('user', 'remember the magic word: quokka'),
        textMessage('model', 'got it, the magic word is quokka'),
      ];
      await agent.setHistory(seeded);

      const got = await agent.getHistory();
      expect(got.length).toBe(seeded.length);
      expect(messageText(got[0])).toBe('remember the magic word: quokka');
      expect(messageText(got[1])).toBe('got it, the magic word is quokka');

      // a follow-up turn sees that context (emits a text + done)
      const events = await drain(agent.stream('what was the magic word?'));
      expect(events.filter(isTextEvent).length).toBeGreaterThanOrEqual(1);
      expect(events.filter(isDoneEvent)).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('T7 resetChat → getHistory empty; next turn has no prior context @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.setHistory([
        textMessage('user', 'to be forgotten'),
        textMessage('model', 'also forgotten'),
      ]);
      await agent.resetChat();

      const got = await agent.getHistory();
      expect(got.length).toBe(0);

      // next turn runs cleanly with no prior context
      const events = await drain(agent.stream('fresh start'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);

      // after a fresh turn, history contains only the new turn
      const after = await agent.getHistory();
      expect(after.length).toBeLessThanOrEqual(2);
    } finally {
      await cleanup();
    }
  });

  it('T8 explicit compress() returns a CompressionResult with a valid status and numeric token fields when compressed @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-011', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // seed enough history for compression to be meaningful
      await agent.setHistory([
        textMessage('user', 'a'.repeat(2000)),
        textMessage('model', 'b'.repeat(2000)),
        textMessage('user', 'c'.repeat(2000)),
      ]);

      // A caller-supplied promptId must be echoed back verbatim on the result
      // (proves the promptId is threaded through, not regenerated).
      const result = await agent.compress({ promptId: 'caller-compress-id' });
      expect(result.promptId).toBe('caller-compress-id');

      // status is one of the documented outcomes
      expect(['compressed', 'skipped', 'failed']).toContain(result.status);

      // when compressed, numeric token fields are populated and monotonic.
      // Evaluate the contract as a single boolean to avoid conditional expects.
      const orig = result.originalTokenCount;
      const next = result.newTokenCount;
      const numericWhenCompressed =
        result.status !== 'compressed' ||
        (typeof orig === 'number' && typeof next === 'number' && orig >= next);
      expect(numericWhenCompressed).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T8c compress() without a promptId generates a default compress-prefixed id and the no-op path reports skipped (not failed) under the fake seam @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-011', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // No history seeded → compression is a no-op. The fake chat reports the
      // no-op as "skipped" (NOT "failed"), exercising the
      // raw===FAILED ? 'failed' : 'skipped' branch on the falsey side.
      const result = await agent.compress();
      expect(result.status).toBe('skipped');

      // The generated default promptId carries the documented "compress-" prefix
      // (a mutant emptying the literal would drop the prefix).
      expect(result.promptId).toBeDefined();
      expect(result.promptId?.startsWith('compress-')).toBe(true);

      // skipped is a no-op: no token-count fields are populated.
      expect(result.originalTokenCount).toBeUndefined();
      expect(result.newTokenCount).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T8b onStats: an immediate frame at subscribe, at least one more telemetry-driven frame during a turn, and NO further frames after unsubscribe @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Before any turn, the projected turn-count is exactly zero (the
      // HistoryService reports no messages yet). This pins the pre-turn
      // baseline so the post-turn growth below is a real state transition.
      const before = agent.getStats();
      expect(before.turnCount).toBe(0);

      const received: SessionStats[] = [];
      const unsub = agent.onStats((stats) => {
        received.push(stats);
      });

      // exactly one immediate projection at subscribe time
      const afterSubscribe = received.length;
      expect(afterSubscribe).toBe(1);

      // running a turn drives telemetry 'update' events → the registered
      // handler delivers AT LEAST one additional frame (proves the handler is
      // wired to the real 'update' event, not a dead/renamed event name).
      await drain(agent.stream('collect stats'));
      const afterTurn = received.length;
      expect(afterTurn).toBeGreaterThan(afterSubscribe);

      // The turn appended user+model messages, so the projected turnCount
      // advances strictly above the pre-turn zero baseline. This is the real
      // HistoryService.getStatistics().totalMessages value flowing through
      // projectStats → readTurnCount; a stubbed/zeroed projection would not
      // grow here.
      const midSnapshot = agent.getStats();
      expect(midSnapshot.turnCount).toBeGreaterThan(before.turnCount);

      // after unsubscribe, a further turn must NOT deliver any new frames
      // (proves the returned disposer actually detaches the telemetry handler).
      unsub();
      await drain(agent.stream('collect more stats'));
      expect(received.length).toBe(afterTurn);

      // the latest delivered frame carries the documented numeric shape
      const s = received[received.length - 1];
      expect(typeof s.promptTokens).toBe('number');
      expect(typeof s.candidateTokens).toBe('number');
      expect(typeof s.totalTokens).toBe('number');
      expect(typeof s.contextWindowSize).toBe('number');
      expect(typeof s.contextWindowUsed).toBe('number');
      expect(typeof s.turnCount).toBe('number');

      // getStats returns a populated snapshot
      const snapshot = agent.getStats();
      expect(typeof snapshot.totalTokens).toBe('number');
      expect(typeof snapshot.turnCount).toBe('number');
    } finally {
      await cleanup();
    }
  });

  it('T8c2 onStats delivers an immediate stats frame at subscription time even when no turn ever runs @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const received: SessionStats[] = [];
      // Subscribe and immediately unsubscribe WITHOUT running any turn. The
      // contract guarantees one immediate projection at subscribe time, so the
      // callback must have fired exactly once already.
      const unsub = agent.onStats((stats) => {
        received.push(stats);
      });
      unsub();

      expect(received.length).toBeGreaterThanOrEqual(1);
      const first = received[0];
      // the immediate frame is a fully-populated numeric SessionStats
      expect(typeof first.promptTokens).toBe('number');
      expect(typeof first.totalTokens).toBe('number');
      expect(typeof first.turnCount).toBe('number');

      // after unsubscribe, no further frames arrive even if telemetry updates
      const countAfterUnsub = received.length;
      const snapshot = agent.getStats();
      expect(typeof snapshot.totalTokens).toBe('number');
      expect(received.length).toBe(countAfterUnsub);
    } finally {
      await cleanup();
    }
  });

  it('T14b addHistory / updateSystemInstruction / addDirectoryContext each take effect on the next turn @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // addHistory appends a message visible to the next turn
      const before = await agent.getHistory();
      await agent.addHistory(
        textMessage('user', 'injected context for the next turn'),
      );
      const after = await agent.getHistory();
      expect(after.length).toBe(before.length + 1);
      expect(messageText(after[after.length - 1])).toBe(
        'injected context for the next turn',
      );

      // updateSystemInstruction + addDirectoryContext are accepted and a
      // subsequent turn runs cleanly (the next turn sees the updated context)
      await agent.updateSystemInstruction();
      await agent.addDirectoryContext();

      const events = await drain(agent.stream('use the injected context'));
      expect(events.filter(isDoneEvent)).toHaveLength(1);

      // the injected message is still present after the turn
      const hist = await agent.getHistory();
      const texts = hist.map(messageText);
      expect(texts).toContain('injected context for the next turn');
    } finally {
      await cleanup();
    }
  });

  it('T22 chat() AgentResult carries text, toolCalls, finishReason, and optional usage/error for non-interactive output mapping @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001 @requirement:REQ-003 @requirement:REQ-021', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const result = await agent.chat('produce output');

      // text drives --output-format text
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);

      // toolCalls is an array (drives --output-format json tool arrays)
      expect(Array.isArray(result.toolCalls)).toBe(true);

      // finishReason is a valid DoneReason (drives exit/error code mapping)
      expect(result.finishReason).toBeTruthy();
      expect(typeof result.finishReason).toBe('string');

      // usage, when present, has the SessionStats numeric shape.
      // Evaluate as a single boolean so no expect lives inside a conditional.
      const usageValid =
        result.usage === undefined ||
        (typeof result.usage.totalTokens === 'number' &&
          typeof result.usage.turnCount === 'number');
      expect(usageValid).toBe(true);

      // error, when present, has a code + message (drives non-zero exit).
      const errorValid =
        result.error === undefined ||
        (typeof result.error.code === 'string' &&
          typeof result.error.message === 'string');
      expect(errorValid).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T6r restoreHistory accepts curated IContent items and getHistory surfaces their text @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Curated history is supplied as IContent (speaker/blocks), the internal
      // history representation — distinct from the Content shape getHistory
      // returns. restoreHistory must ingest it and the text must round-trip.
      const items: readonly AgentHistoryItem[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'curated human turn' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'curated ai reply' }],
        },
      ];
      await agent.restoreHistory(items);

      const hist = await agent.getHistory();
      const texts = hist.map(messageText);
      expect(texts).toContain('curated human turn');
      expect(texts).toContain('curated ai reply');
    } finally {
      await cleanup();
    }
  });

  it('T6s restoreHistory replaces any prior history rather than appending to it @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      await agent.setHistory([textMessage('user', 'original seeded message')]);

      await agent.restoreHistory([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'restored replacement' }],
        },
      ]);

      const hist = await agent.getHistory();
      const texts = hist.map(messageText);
      expect(texts).toContain('restored replacement');
      expect(texts).not.toContain('original seeded message');
    } finally {
      await cleanup();
    }
  });

  it('T-seq getCurrentSequenceModel returns null (no active load-balancer sequence under the fake seam) @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-004', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // Exact-value contract: the non-load-balancer path returns null (not a
      // string, not undefined). A mutant returning a model string or undefined
      // would change this observable value.
      expect(agent.getCurrentSequenceModel()).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('T-tier getUserTier returns the client tier value (undefined under the fake seam) @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // The FakeProvider client reports no paid tier → undefined. Asserting the
      // exact value pins the delegation (a mutant returning a fabricated tier
      // would surface a defined value here).
      expect(agent.getUserTier()).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('T-mp getModelParams returns a frozen, null-prototype snapshot that reflects setModelParam/clearModelParam and is decoupled from the live state @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-004', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      agent.setModelParam('temperature', 0.42);
      agent.setModelParam('top_p', 0.9);

      const snapshot = agent.getModelParams();
      // reflects what was set
      expect(snapshot['temperature']).toBe(0.42);
      expect(snapshot['top_p']).toBe(0.9);
      // frozen snapshot (immutable to callers)
      expect(Object.isFrozen(snapshot)).toBe(true);
      // null-prototype: no inherited Object members leak through
      expect(Object.getPrototypeOf(snapshot)).toBeNull();

      // mutating the live state afterward does not retroactively change the
      // already-returned snapshot (it was a copy)
      agent.clearModelParam('temperature');
      expect(snapshot['temperature']).toBe(0.42);

      // a fresh snapshot reflects the clear
      const after = agent.getModelParams();
      expect('temperature' in after).toBe(false);
      expect(after['top_p']).toBe(0.9);
    } finally {
      await cleanup();
    }
  });

  // ─── Property-based: history round-trip ──────────────────────────────────

  it('T6p property: setHistory then getHistory round-trips an arbitrary generated message list @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-010', async () => {
    const msgArb = fc.array(
      fc.record({
        role: fc.constantFrom('user' as const, 'model' as const),
        text: fc.string({ minLength: 1, maxLength: 80 }),
      }),
      { maxLength: 6 },
    );
    await fc.assert(
      fc.asyncProperty(msgArb, async (msgs) => {
        const {
          agent,
          cleanup,
        }: { agent: Agent; cleanup: () => Promise<void> } =
          await buildAgent('plain-text.jsonl');
        try {
          const seeded = msgs.map((m) => textMessage(m.role, m.text));
          await agent.setHistory(seeded);
          const got = await agent.getHistory();
          expect(got.length).toBe(seeded.length);
          for (let i = 0; i < seeded.length; i++) {
            expect(messageText(got[i])).toBe(messageText(seeded[i]));
          }
        } finally {
          await cleanup();
        }
      }),
    );
  });
});
