/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-016
 *
 * LAYER-5 resource-leak / disposal. Behavioral integration tests against a real
 * public Agent, driven through the agentHarness. Each ownership-table row from
 * dispose.md §4.3 is asserted torn-down by its own test that NAMES the row
 * token. `await agent.dispose()` is called DIRECTLY (the harness cleanup()
 * swallows dispose errors, which is fine for env restore in `finally` but
 * disposal tests MUST observe the real throw / real effect).
 *
 * Observation per row (public Agent API and real effects only):
 * - agentClient: `agent.getHistory()` resolves while the agent is open and
 *   rejects as disposed once the session client owner is torn down.
 * - scheduler + confirmationCoordinator: the test's own
 *   `createRecordingSchedulerFactory().factory` is injected through the public
 *   `toolSchedulerFactory` input and a tool turn is driven; the recording
 *   handle the factory returned exposes a real `disposed` boolean.
 * - sessionLock: the recording lock file `<chats dir>/<sessionId>.lock` exists
 *   while recording is on and is gone after dispose.
 * - idempotent re-dispose + AggregateDisposeError rows: structural predicates
 *   over the real rejection (failing-factory induction).
 *
 * Rows asserted at domain level (internals the Agent API cannot read):
 * - messageBus subscriptions: `runtime-policy-owner-disposal.behavior.test.ts`.
 * - extensions: `workspace-extension-disposal.behavior.test.ts`.
 * - client teardown itself: `session-client-owner-disposal.behavior.test.ts`.
 */

import { describe, it, expect } from 'bun:test';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  buildAgent,
  drain,
  countType,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import {
  aggregateErrors,
  aggregateMessage,
  isAggregateDisposeError,
} from './helpers/disposalProbe.js';
import {
  createFailingSchedulerFactory,
  createRecordingSchedulerFactory,
  type RecordingSchedulerFactory,
  type RecordingSchedulerHandle,
} from './helpers/fakeScheduler.js';

function firstHandle(
  recording: RecordingSchedulerFactory,
): RecordingSchedulerHandle {
  const handle = recording.createdHandles.at(0);
  if (handle === undefined)
    throw new Error('No scheduler reached actual injected acquisition');
  return handle;
}

function lockFiles(chatsDir: string): string[] {
  return readdirSync(chatsDir).filter((name) => name.endsWith('.lock'));
}

describe('Disposal @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', () => {
  it('T13 agentClient is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // PRE-dispose sanity read: the session client is live and answers.
      await expect(agent.getHistory()).resolves.toStrictEqual([]);
      await agent.dispose();
      await expect(agent.getHistory()).rejects.toThrow(/disposed/);
    } finally {
      await cleanup();
    }
  });

  it('T13 scheduler (facade-held injected-factory instance) is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    // Per dispose.md lines 40-47 this facade-held scheduler is CONDITIONAL T19:
    // it exists ONLY when an injected toolSchedulerFactory creates an instance
    // the facade retains. Build this agent WITH an injected RECORDING
    // toolSchedulerFactory AND drive a tool turn so the facade creates and
    // retains the injected scheduler/coordinator.
    const recording = createRecordingSchedulerFactory();
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      toolSchedulerFactory: recording.factory,
    });
    const responder = respondToFirstConfirmation(
      agent,
      ToolConfirmationOutcome.ProceedOnce,
    );
    try {
      const events = await drain(agent.stream('use a tool'));
      expect(countType(events, 'tool-call')).toBeGreaterThanOrEqual(1);
      expect(recording.createdHandles.length).toBeGreaterThanOrEqual(1);

      // The handle the test's factory returned IS the facade-held scheduler.
      const handle = firstHandle(recording);
      // PRE-dispose sanity read: the injected scheduler handle is NOT yet torn
      // down.
      expect(handle.disposed).toBe(false);
      // dispose.md line 41: injectedFactoryScheduler.dispose() (guarded
      // existence check; CONDITIONAL T19).
      await agent.dispose();
      expect(handle.disposed).toBe(true);
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });

  it('T13 confirmationCoordinator is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    // Per dispose.md lines 45-47 the coordinator is CONDITIONAL T19: it is
    // owned by the facade-held injected-factory scheduler and exists ONLY when
    // an injected toolSchedulerFactory created a retained instance. The
    // recording handle backs both rows, so this reads the same handle.
    const recording = createRecordingSchedulerFactory();
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      toolSchedulerFactory: recording.factory,
    });
    const responder = respondToFirstConfirmation(
      agent,
      ToolConfirmationOutcome.ProceedOnce,
    );
    try {
      const events = await drain(agent.stream('use a tool'));
      expect(countType(events, 'tool-call')).toBeGreaterThanOrEqual(1);
      expect(recording.createdHandles.length).toBeGreaterThanOrEqual(1);

      const handle = firstHandle(recording);
      // PRE-dispose sanity read: the coordinator backing the facade-held
      // scheduler is NOT yet torn down.
      expect(handle.disposed).toBe(false);
      // dispose.md line 46: injectedFactoryCoordinator.dispose() (CONDITIONAL
      // T19; coordinator is owned by the injected-factory scheduler).
      await agent.dispose();
      expect(handle.disposed).toBe(true);
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });

  it('T13 sessionLock is released on dispose (released flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const sessionId = `disposal-lock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      sessionId,
    });
    try {
      // Recording takes the session's real lock file in the chats directory,
      // which is the directory of the recording journal.
      await agent.setHistory([
        { speaker: 'human', blocks: [{ type: 'text', text: 'lock-seed' }] },
      ]);
      await agent.session.setRecording({ enabled: true });
      const journal = agent.session.getRecording().path;
      if (!journal) throw new Error('Recording journal missing');
      const chatsDir = dirname(journal);
      const lockName = `${sessionId}.lock`;

      // PRE-dispose sanity read: the session lock is held.
      expect(lockFiles(chatsDir)).toContain(lockName);
      await agent.dispose();
      expect(lockFiles(chatsDir)).not.toContain(lockName);
    } finally {
      await cleanup();
    }
  });

  it('T13 re-dispose is idempotent: a second dispose() resolves without throwing and the agentClient stays disposed @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      // PRE-dispose sanity read: the session client is live and answers.
      await expect(agent.getHistory()).resolves.toStrictEqual([]);
      // First dispose performs the teardown; dispose.md lines 11-12 guard with
      // a disposed flag so a second dispose() is a no-op that resolves cleanly.
      await agent.dispose();
      // The second call must not throw — the idempotent guard short-circuits.
      await agent.dispose();
      // The session client stays torn down after the idempotent second dispose.
      await expect(agent.getHistory()).rejects.toThrow(/disposed/);
    } finally {
      await cleanup();
    }
  });

  it('T13 partial teardown failure surfaces an AggregateDisposeError carrying the induced failure @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const observation = await observePartialTeardownFailure();
    expect(observation.toolCallCount).toBeGreaterThanOrEqual(1);
    expect(observation.disposeRejected).toBe(true);
    expect(observation.isAggregateError).toBe(true);
    expect(observation.foundInduced).toBe(true);
    expect(observation.summary).toContain(`${observation.errorCount} error(s)`);
    expect(observation.summary).toContain(observation.inducedFailureMessage);
    expect(observation.summary).toContain('Agent dispose failed');
  });

  const observePartialTeardownFailure = async () => {
    // Induce a partial-teardown failure by injecting a toolSchedulerFactory
    // whose created handle's dispose() REJECTS. dispose.md line 101 says
    // dispose() must throw AggregateDisposeError(errors) when any teardown step
    // fails; the safe() accumulator (line 110-112) collects failures and the
    // aggregate carries them in an `errors` array.
    const { factory: failingFactory, inducedFailureMessage } =
      createFailingSchedulerFactory();
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      toolSchedulerFactory: failingFactory,
    });
    const responder = respondToFirstConfirmation(
      agent,
      ToolConfirmationOutcome.ProceedOnce,
    );
    try {
      // Run a turn so the facade retains the injected scheduler (the factory is
      // only invoked when a tool is scheduled). At RED agent.stream throws NYI
      // before any scheduling → natural fail. At GREEN the facade creates and
      // holds the failing handle.
      const events = await drain(agent.stream('run a tool turn'));
      const toolCallCount = countType(events, 'tool-call');

      // dispose() should REJECT with an AggregateDisposeError whose `errors`
      // array contains the induced scheduler-dispose failure.
      let captured: unknown = undefined;
      try {
        await agent.dispose();
      } catch (e: unknown) {
        captured = e;
      }
      const disposeRejected = captured !== undefined;

      // Structural assertion (AggregateDisposeError does not exist yet at P13 —
      // it is created at P24). The predicate checks name + errors shape without
      // importing the class.
      const isAggregateError = isAggregateDisposeError(captured);

      // The induced failure appears in the aggregate's errors array.
      const errors = aggregateErrors(captured);
      const foundInduced = errors.some(
        (err) => err instanceof Error && err.message === inducedFailureMessage,
      );

      // The aggregate's summary message reports the error COUNT and embeds the
      // induced failure's text via the `${errors.length} error(s): ${details}`
      // template with '; '-joined detail. Mutants on the count interpolation,
      // the join, the map projection, or the template string would not produce
      // this exact summary.
      const summary = aggregateMessage(captured);
      return {
        toolCallCount,
        disposeRejected,
        isAggregateError,
        foundInduced,
        summary,
        errorCount: errors.length,
        inducedFailureMessage,
      };
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  };
});
