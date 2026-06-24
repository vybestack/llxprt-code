/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-006
 * @requirement:REQ-016
 *
 * LAYER-5 injected scheduler factory (T19, RED). Behavioral integration tests
 * against a real public Agent, driven through the agentHarness. The injected
 * `AgentSchedulerFactory` (AgentConfig.toolSchedulerFactory) is an infra fake
 * (fakeScheduler.ts) that records each created handle with a REAL observable
 * `disposed` boolean. The test asserts the factory-created instance is USED for
 * tool scheduling (a tool-call event occurred during the turn) and TORN DOWN on
 * dispose (the handle's `disposed` flag is true), while the caller-owned factory
 * function itself is not "disposed" (it has no dispose; the handle count equals
 * the created instances).
 *
 * Every test FAILS NATURALLY now because `agent.stream()` (agentImpl.ts ~52)
 * throws before any scheduling occurs, and `agent.dispose()` (~164) throws
 * before any teardown — so the behavioral assertions never pass at RED. No mock
 * theater, no call-spy matchers, only real behavioral assertions on observable
 * event sequences and the real handle `disposed` boolean.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAgent,
  drain,
  countType,
  isToolCallEvent,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import { createRecordingSchedulerFactory } from './helpers/fakeScheduler.js';

describe('Scheduler factory @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-006 @requirement:REQ-016', () => {
  it('T19 injected scheduler factory instance is used for tool scheduling and torn down on dispose @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-006 @requirement:REQ-016', async () => {
    const recording = createRecordingSchedulerFactory();
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      toolSchedulerFactory: recording.factory,
    });
    const responder = respondToFirstConfirmation(
      agent,
      ToolConfirmationOutcome.ProceedOnce,
    );
    try {
      // Run a tool turn. The fixture drives a read_file tool call then an
      // answer. At RED agent.stream throws NYI → the turn never produces events
      // → natural fail. At GREEN the facade invokes the injected factory to
      // create the scheduler instance used for this turn's tool scheduling.
      const events = await drain(agent.stream('use a tool'));
      // A tool-call event occurred — observable proof the tool path ran.
      expect(countType(events, 'tool-call')).toBeGreaterThanOrEqual(1);
      expect(events.filter(isToolCallEvent).length).toBeGreaterThanOrEqual(1);

      // The factory created at least one handle — observable proof the injected
      // factory instance was USED for tool scheduling (the count equals the real
      // instances created, read off the recording array — behavioral, never a
      // call-spy matcher).
      expect(recording.createdHandles.length).toBeGreaterThanOrEqual(1);

      // The caller-owned factory function itself is not "disposed" — it has no
      // dispose method; it remains usable. Assert the handle count is exactly
      // the instances created (the factory was not destroyed by dispose).
      const createdBeforeDispose = recording.createdHandles.length;

      // Dispose the agent. At RED agent.dispose throws NYI → natural fail. At
      // GREEN (P23/P24) the facade disposes the factory-created scheduler
      // instance (dispose.md line 41), flipping its real `disposed` flag.
      await agent.dispose();

      // The factory-created handle was torn down — its real observable disposed
      // boolean is true.
      for (const handle of recording.createdHandles) {
        expect(handle.disposed).toBe(true);
      }

      // The caller-owned factory function is NOT disposed: the handle count
      // is unchanged and equals the created instances (the factory remains
      // callable; it was not destroyed by the agent's dispose).
      expect(recording.createdHandles.length).toBe(createdBeforeDispose);
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });
});
