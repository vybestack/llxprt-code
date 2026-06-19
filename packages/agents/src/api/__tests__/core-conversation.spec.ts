/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P11
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-007
 * @requirement:REQ-012
 *
 * Core conversation behavior (RED). Behavioral integration tests against a
 * real public Agent over a real FakeProvider (wired via the
 * LLXPRT_FAKE_RESPONSES production seam). Tests FAIL NATURALLY because the
 * stub AgentImpl methods are not-yet-implemented; no reverse tests, no mock
 * theater — only assertions on concrete values / event sequences.
 *
 * Covers T1 (stream/chat ordering + DoneReason), T9 (abort → single
 * done{aborted}), T10 (generate() is side-channel), T14 (multi-step
 * continuation via stream/chat).
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import {
  buildAgent,
  drain,
  typesOf,
  countType,
  isDoneEvent,
  isTextEvent,
  DONE_REASONS,
} from './helpers/agentHarness.js';

describe('Core conversation @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001 @requirement:REQ-003', () => {
  it('T1 stream yields ordered thinking then text then exactly one terminal done @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001 @requirement:REQ-003', async () => {
    const { agent, cleanup } = await buildAgent('thinking-text.jsonl');
    try {
      const events = await drain(agent.stream('hi'));
      const types = typesOf(events);

      // thinking precedes text
      const thinkingIdx = types.indexOf('thinking');
      const textIdx = types.indexOf('text');
      expect(thinkingIdx).toBeGreaterThanOrEqual(0);
      expect(textIdx).toBeGreaterThan(thinkingIdx);

      // the text event carries the real fixture content
      const textEvents = events.filter(isTextEvent);
      expect(textEvents.length).toBeGreaterThanOrEqual(1);
      expect(textEvents[0].text).toBe('hello with a thought');

      // exactly one terminal done whose reason is a valid DoneReason
      const done = events.filter(isDoneEvent);
      expect(done).toHaveLength(1);
      expect(DONE_REASONS).toContain(done[0].reason);

      // done is the last event
      expect(types[types.length - 1]).toBe('done');
    } finally {
      await cleanup();
    }
  });

  it('T1 chat() returns AgentResult with non-empty text and finishReason stop @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001 @requirement:REQ-003', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const result = await agent.chat('hello');
      expect(typeof result.text).toBe('string');
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.finishReason).toBe('stop');
      expect(Array.isArray(result.toolCalls)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T9 abort mid-stream yields exactly one done{aborted} and no events after it @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-003', async () => {
    const { agent, cleanup } = await buildAgent('thinking-text.jsonl');
    try {
      const controller = new AbortController();
      const collected: AgentEvent[] = [];
      // abort shortly after the stream begins
      const abortTimer = setTimeout(() => controller.abort(), 0);
      try {
        for await (const event of agent.stream('go', {
          signal: controller.signal,
        })) {
          collected.push(event);
        }
      } finally {
        clearTimeout(abortTimer);
      }

      const events = collected;
      const done = events.filter(isDoneEvent);

      // exactly one done
      expect(done).toHaveLength(1);
      expect(done[0].reason).toBe('aborted');

      // done is the LAST event — nothing after it
      const types = typesOf(events);
      expect(types[types.length - 1]).toBe('done');
      const doneIdx = types.lastIndexOf('done');
      expect(doneIdx).toBe(types.length - 1);
    } finally {
      await cleanup();
    }
  });

  it('T10 generate() returns a string without mutating history or running a tool loop @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-012', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const before = await agent.getHistory();
      const beforeLen = before.length;

      const out = await agent.generate('summarize this');

      // generate returns the provider's response text verbatim — the exact
      // value, not merely "a string". A LogicalOperator mutant on the
      // `getResponseText(response) ?? ''` fallback (→ `&& ''`) would return an
      // empty string instead of the real reply, which this exact match kills.
      expect(out).toBe('a plain text reply');

      // generate is side-channel: history length is unchanged
      const after = await agent.getHistory();
      expect(after.length).toBe(beforeLen);
    } finally {
      await cleanup();
    }
  });

  it('T10b generate() is non-empty and still side-channel when given a structured input @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-012', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const beforeLen = (await agent.getHistory()).length;

      // Structured AgentInput exercises the toPartListUnion(.text) branch of
      // generate(); the response text is returned verbatim from the provider.
      const out = await agent.generate({ text: 'structured side-channel' });
      expect(out).toBe('a plain text reply');

      // still side-channel — no history mutation
      expect((await agent.getHistory()).length).toBe(beforeLen);
    } finally {
      await cleanup();
    }
  });

  it('T10c generateJson delegates a detached snapshot to the client and surfaces the client error (no provider JSON support under the fake seam) @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-012', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const beforeLen = (await agent.getHistory()).length;
      const contents = [{ role: 'user' as const, parts: [{ text: 'hi' }] }];

      // generateJson reaches the real client with a snapshot copy of contents.
      // The fake provider has no JSON path, so the client's real error is
      // surfaced verbatim — proving the delegation actually executed.
      await expect(
        agent.generateJson(contents, { type: 'object' }),
      ).rejects.toThrow(/Failed to generate content/);

      // detached: the side-channel call did not mutate the live history
      expect((await agent.getHistory()).length).toBe(beforeLen);
    } finally {
      await cleanup();
    }
  });

  it('T10d generateEmbedding delegates the input texts to the client and surfaces the unsupported-embeddings error @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-012', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // generateEmbedding forwards a copy of the texts to the client; the fake
      // provider does not support embeddings, so the real client error is
      // surfaced — confirming the delegation reached the provider layer.
      await expect(agent.generateEmbedding(['hello'])).rejects.toThrow(
        /Embeddings not supported/,
      );
    } finally {
      await cleanup();
    }
  });

  it('T14 multi-step continuation preserves ordered events across turns via the public stream @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-007', async () => {
    const { agent, cleanup } = await buildAgent('multi-turn-text.jsonl');
    try {
      // first turn
      const first = await drain(agent.stream('turn one'));
      const firstDone = first.filter(isDoneEvent);
      expect(firstDone).toHaveLength(1);
      expect(countType(first, 'text')).toBeGreaterThanOrEqual(1);

      // second turn continues the same session; ordered events again
      const second = await drain(agent.stream('turn two'));
      const secondDone = second.filter(isDoneEvent);
      expect(secondDone).toHaveLength(1);
      expect(countType(second, 'text')).toBeGreaterThanOrEqual(1);

      // each turn's done is its terminal event
      const secondTypes = typesOf(second);
      expect(secondTypes[secondTypes.length - 1]).toBe('done');
    } finally {
      await cleanup();
    }
  });

  // ─── Property-based: universal stream-termination invariant ──────────────

  it('T1p property: for ANY user-prompt text (empty/whitespace/unicode), the stream ALWAYS ends with exactly one terminal done whose reason is a valid DoneReason and is the LAST event @plan:PLAN-20260617-COREAPI.P11 @requirement:REQ-001 @requirement:REQ-003', async () => {
    // The stream-termination contract must hold for ANY prompt text the caller
    // passes — there is no input that may leave a turn without a terminal done,
    // emit two dones, or end on a non-done event. This drives the REAL public
    // Agent over the REAL FakeProvider for each generated prompt. If a
    // production line dropped the terminal done synthesis (e.g. mapLoopStream
    // failed to emit done for an empty/odd prompt, or emitted a duplicate),
    // some generated string would falsify exactly one of these assertions.
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 120 }), async (prompt) => {
        // A fresh agent per iteration with guaranteed cleanup — no leaked
        // agents across generated runs.
        const { agent, cleanup } = await buildAgent('plain-text.jsonl');
        try {
          const events = await drain(agent.stream(prompt));
          const types = typesOf(events);

          // exactly one terminal done for this arbitrary prompt
          const done = events.filter(isDoneEvent);
          expect(done).toHaveLength(1);

          // its reason is a valid DoneReason (closed enum, no leaks)
          expect(DONE_REASONS).toContain(done[0].reason);

          // done is the LAST event — nothing emitted after termination
          expect(types[types.length - 1]).toBe('done');
        } finally {
          await cleanup();
        }
      }),
      { numRuns: 15 },
    );
  });
});
