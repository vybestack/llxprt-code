/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P07
 * @requirement:REQ-003
 *
 * BEHAVIORAL RED suite for the `agent.tasks` sub-controller
 * (AgentTasksControl). Drives through the PUBLIC ROOT via the buildAgent
 * harness (helpers/agentHarness.ts:79). The REAL AsyncTaskManager is seeded
 * through the public config path with ZERO mocking:
 *   agent.getConfig().getAsyncTaskManager() (config.ts:601)
 *   → the SAME lazily-created AsyncTaskManager the control resolves
 *   → mgr.registerTask(RegisterTaskInput) (asyncTaskManager.ts:148) marks
 *     the task 'running'.
 *
 * Reads go through `agent.tasks.list()/listRunning()/get(id)/cancel(id)/
 * cancelAllRunning()` — the SAME manager the control closes over, so the
 * read-path is causally real (no stub).
 *
 * At RED (before P08): `agent.tasks` is undefined on the Agent interface, so
 * every public-harness positive (T7/T8/T10) FAILS with a behavioral TypeError
 * (missing-property → "Cannot read properties of undefined"). The T9
 * undefined-safe case dynamically imports the not-yet-created control module,
 * so its failure at RED is an isolated module-resolution error INSIDE that one
 * test — the whole file still PARSES and the positives drive the behavioral RED.
 *
 * At GREEN (P08): the TasksControl delegates to Config.getAsyncTaskManager()
 * per call, projects each core AsyncTaskInfo to a public AgentTaskInfo that
 * OMITS abortController, and is undefined-safe on every method.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildAgent } from './helpers/agentHarness.js';

describe('agent.tasks undefined-safe async-task control @plan:PLAN-20260622-COREAPIGAP.P07 @requirement:REQ-003', () => {
  it('T7 seed N running tasks on the real manager, cancelAllRunning returns N and leaves listRunning empty @requirement:REQ-003 @scenario:cancel-all-count @given:a real manager seeded with 2 running tasks via agent.getConfig().getAsyncTaskManager().registerTask @when:agent.tasks.cancelAllRunning() is called @then:the returned count === 2 AND a subsequent agent.tasks.listRunning() has length 0 (terminal idempotent state)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const mgr = agent.getConfig().getAsyncTaskManager()!;
      expect(mgr).toBeDefined();
      const ids = ['t7-a', 't7-b'];
      for (const id of ids) {
        mgr.registerTask({
          id,
          subagentName: 's',
          goalPrompt: 'g',
          abortController: new AbortController(),
        });
      }
      // Both tasks are 'running' before the call.
      expect(agent.tasks.listRunning()).toHaveLength(2);
      const cancelled = agent.tasks.cancelAllRunning();
      expect(cancelled).toBe(2);
      // Idempotent terminal state: no running tasks remain.
      expect(agent.tasks.listRunning()).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it('T8 projection strips abortController from the public view of a running task @requirement:REQ-003 @scenario:no-abortController @given:a real manager seeded with 1 running task that carries an AbortController on the core manager @when:agent.tasks.list() is called @then:the projected view does NOT include an abortController key (Object.keys(view) omits it AND "abortController" in view === false)', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const mgr = agent.getConfig().getAsyncTaskManager()!;
      const ac = new AbortController();
      mgr.registerTask({
        id: 't8-x',
        subagentName: 's',
        goalPrompt: 'g',
        abortController: ac,
      });
      // The CORE task DID carry an AbortController (proof of real seeding).
      const coreTask = mgr.getTask('t8-x')!;
      expect(coreTask.abortController).toBe(ac);
      // The PUBLIC view MUST NOT expose it.
      const list = agent.tasks.list();
      expect(list.length).toBeGreaterThanOrEqual(1);
      const view = list.find((v) => v.id === 't8-x')!;
      expect(view).toBeDefined();
      expect(Object.keys(view)).not.toContain('abortController');
      expect('abortController' in view).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('T9 direct-construction undefined-safe: when getManager returns undefined every method is a no-op ([], undefined, false, 0) and none throw @requirement:REQ-003 @scenario:undefined-safe @given:a TasksControl constructed with getManager: () => undefined (a REAL closure, not a spy) @when:list/listRunning/get/cancel/cancelAllRunning are called @then:list() === [], listRunning() === [], get("x") === undefined, cancel("x") === false, cancelAllRunning() === 0, and no call throws', async () => {
    // Dynamic import keeps the file parseable at RED (before P08 creates the
    // module). The public-harness positives (T7/T8/T10) drive the behavioral
    // RED; this test's RED failure is an isolated module-resolution error.
    const { TasksControl } = await import('../control/tasksControl.js');
    const control = new TasksControl({ getManager: () => undefined });
    expect(control.list()).toStrictEqual([]);
    expect(control.listRunning()).toStrictEqual([]);
    expect(control.get('x')).toBeUndefined();
    expect(control.cancel('x')).toBe(false);
    expect(control.cancelAllRunning()).toBe(0);
  });

  it('T10 list/listRunning/get/cancel fidelity over a mix of running, completed, and cancelled tasks @requirement:REQ-003 @scenario:fidelity @given:a real manager seeded with 2 running tasks where 1 is then completed @when:list/listRunning/get(knownId)/get(missing)/cancel(knownId)/cancel(missing) are called @then:list() length === 2 (both tasks remain in history); listRunning() length === 1; get(knownId) returns the projected view with matching id; get(missing) === undefined; cancel(knownId) === true; cancel(missing) === false', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const mgr = agent.getConfig().getAsyncTaskManager()!;
      mgr.registerTask({
        id: 't10-run',
        subagentName: 's',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });
      mgr.registerTask({
        id: 't10-done',
        subagentName: 's',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });
      // Complete one task: it leaves the running set but stays in history.
      expect(
        mgr.completeTask('t10-done', { result: 'ok' } as never),
      ).toBe(true);
      // list() reflects ALL tasks (both remain in history).
      const all = agent.tasks.list();
      expect(all).toHaveLength(2);
      // listRunning() reflects ONLY the still-running task.
      const running = agent.tasks.listRunning();
      expect(running).toHaveLength(1);
      expect(running[0].id).toBe('t10-run');
      // get(knownId) returns the projected view with the matching id.
      const known = agent.tasks.get('t10-done');
      expect(known).toBeDefined();
      expect(known!.id).toBe('t10-done');
      // The projected view never leaks abortController.
      expect('abortController' in known!).toBe(false);
      // get(missing) === undefined.
      expect(agent.tasks.get('does-not-exist')).toBeUndefined();
      // cancel(knownId running) === true.
      expect(agent.tasks.cancel('t10-run')).toBe(true);
      // cancel(missing) === false.
      expect(agent.tasks.cancel('does-not-exist')).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('PROP projection fidelity: for a generated list of N (1..5) running tasks, list() length === N, the id set matches, and NO view has an abortController key @requirement:REQ-003 @scenario:property-projection-fidelity @given:a generated list of N running tasks with random ids and goalPrompts seeded on the real manager @when:agent.tasks.list() @then:list() length === N; the set of view ids === the set of seeded ids; and no returned view has an abortController key', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1 }).filter((s) => !s.includes(' ')),
            goalPrompt: fc.string(),
          }),
          { minLength: 1, maxLength: 5, selector: (r) => r.id },
        ),
        async (tasks) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            const mgr = agent.getConfig().getAsyncTaskManager()!;
            for (const t of tasks) {
              mgr.registerTask({
                id: t.id,
                subagentName: 's',
                goalPrompt: t.goalPrompt,
                abortController: new AbortController(),
              });
            }
            const views = agent.tasks.list();
            // MIN-2 distinct cases are exercised by the generator (1..5 tasks).
            expect(views).toHaveLength(tasks.length);
            const viewIds = new Set(views.map((v) => v.id));
            for (const t of tasks) {
              expect(viewIds.has(t.id)).toBe(true);
            }
            // REQ-003.7: no projected view leaks abortController.
            for (const v of views) {
              expect('abortController' in v).toBe(false);
              expect(Object.keys(v)).not.toContain('abortController');
            }
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });

  it('PROP cancelAllRunning count: for a generated N (0..5) running tasks, cancelAllRunning() === N and listRunning() afterwards is empty @requirement:REQ-003 @scenario:property-cancel-count @given:a generated N (0..5) running tasks seeded on the real manager @when:agent.tasks.cancelAllRunning() is called @then:the returned count === N AND a subsequent agent.tasks.listRunning() has length 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 5 }),
        fc.uniqueArray(
          fc.string({ minLength: 1 }).filter((s) => !s.includes(' ')),
          { minLength: 0, maxLength: 5 },
        ),
        async (n, ids) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl');
          try {
            const mgr = agent.getConfig().getAsyncTaskManager()!;
            // Use exactly n ids from the generated pool (trim/pad not needed —
            // uniqueArray with minLength:0, maxLength:5 yields distinct ids).
            const chosen = ids.slice(0, n);
            while (chosen.length < n) {
              chosen.push(`prop-cancel-pad-${chosen.length}`);
            }
            for (const id of chosen) {
              mgr.registerTask({
                id,
                subagentName: 's',
                goalPrompt: 'g',
                abortController: new AbortController(),
              });
            }
            expect(agent.tasks.listRunning()).toHaveLength(n);
            const cancelled = agent.tasks.cancelAllRunning();
            // MIN-2 distinct cases are exercised by the generator (0..5).
            expect(cancelled).toBe(n);
            expect(agent.tasks.listRunning()).toHaveLength(0);
          } finally {
            await cleanup();
          }
        },
      ),
    );
  });
});
