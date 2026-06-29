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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  fromConfig,
  type Agent,
  type AgentEvent,
} from '@vybestack/llxprt-code-agents';
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
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

/**
 * Re-throw a captured teardown error (e.g. from agent.dispose()) so a real
 * teardown bug still fails the test, while keeping the capture/rethrow
 * conditional OUT of the test body (vitest/no-conditional-in-test). Pass
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
    for (const fn of cleanupFns) {
      await fn().catch(() => {
        /* best-effort cleanup */
      });
    }
    cleanupFns = [];
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
    const built = await buildCliStyleConfig('plain-text.jsonl');
    cleanupFns.push(built.cleanup);
    const config = built.config;

    // Pre-adoption baseline: the caller-owned Config's runtime is queryable
    // through its own public surface before the Agent is even built.
    expect(config.getProvider()).toBe('fake');
    expect(config.getModel()).toBe('fake-model');

    const agent: Agent = await fromConfig({ config });

    // Adoption (public surface only): the Agent reports the SAME provider/model
    // the caller-owned Config was built with, proving the adopted runtime —
    // not a freshly-constructed one — is driving the Agent. Private internal
    // registration (internalConfigAccess) is an implementation detail outside
    // the public consumer contract, so it is NOT asserted here.
    let disposeError: unknown = undefined;
    try {
      expect(agent.getProvider()).toBe(config.getProvider());
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
