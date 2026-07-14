/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P13
 * @requirement:REQ-016
 *
 * LAYER-5 resource-leak / disposal (T13, RED). Behavioral integration tests
 * against a real public Agent, driven through the agentHarness. Every test FAILS
 * NATURALLY now because `AgentImpl.dispose()` throws at its stub body
 * (agentImpl.ts ~164), so the post-dispose disposed-flag reads never run. No
 * mock theater, no reverse tests, no NYI literal matching — only real behavioral
 * assertions on observable disposed flags obtained through the white-box
 * disposalProbe helper.
 *
 * Each ownership-table row from dispose.md §4.3 is asserted torn-down by its
 * own test that NAMES the row token. The capture-before-dispose pattern grabs
 * resource references first (dispose may null the facade-held slots); then
 * `await agent.dispose()` is called DIRECTLY (the harness cleanup() swallows
 * dispose errors — fine for env restore in `finally`, but disposal tests MUST
 * observe the real throw / real flag flip); then the captured reference's
 * disposed flag is read. At P24 (GREEN) dispose() flips the real flags and the
 * assertions pass with no rewrite.
 *
 * GREEN-reachability contract per row:
 * - agentClient: observes `agentClient._unsubscribe` transitioning
 *   `function → undefined` (client.ts:146 sets it; client.ts:263-265 clears it
 *   on dispose). The fake client IS constructed and its constructor DOES set
 *   `_unsubscribe`, so this is a genuine transition.
 * - scheduler + confirmationCoordinator: inject
 *   `createRecordingSchedulerFactory().factory` + drive a tool turn; assert the
 *   recording handle's REAL `disposed` boolean. CORRECT (the fake handle
 *   genuinely exposes `disposed`).
 * - messageBus: probe sums `emitter.eventNames().reduce((n,name)=>n+
 *   emitter.listenerCount(name),0)` on the real private emitter. CORRECT.
 * - lsp / extensions / sessionLock (NET-NEW per dispose.md lines 70/80/81-82):
 *   these primitives have NO boolean flag AND the headless fake does not create
 *   them by default. Per dispose.md, dispose() orchestrates teardown through the
 *   OwnershipRecord via `safe(errors, fn)`. The probe reads per-resource
 *   teardown completion markers on the ownership record (`ownership.lspShutDown`
 *   / `ownership.extensionsDisposed` / `ownership.sessionLocksReleased`) that P24
 *   sets when each NET-NEW step completes. This is legitimate TDD (pins the
 *   observable behavior P24 must produce) and is uniformly GREEN-reachable.
 * - idempotent re-dispose + AggregateDisposeError rows: CORRECT (structural
 *   predicate; failing-factory induction).
 *
 * GREEN-reachability audit: EVERY disposal test performs a PRE-dispose sanity
 * read that EXECUTES the probe against the real captured object BEFORE
 * `dispose()` runs, asserting the resource is currently NOT-yet-torn-down
 * (e.g. `expect(agentClientDisposed(probe)).toBe(false)`). This forces the
 * probe code path to run at RED, so a missing import / non-existent surface
 * would fail LOUDLY here instead of being masked by the NYI throw. The PRIMARY
 * behavioral assertion remains the POST-dispose teardown (the `toBe(true)` /
 * `toBe(0)` after `await agent.dispose()`).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAgent,
  drain,
  countType,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
} from './helpers/agentHarness.js';
import {
  agentClientDisposed,
  aggregateErrors,
  aggregateMessage,
  captureProbe,
  confirmationCoordinatorDisposed,
  type DisposalProbe,
  extensionsDisposed,
  type FakeExtension,
  installFakeExtensionLoader,
  installLoaderWithoutUnload,
  isAggregateDisposeError,
  lspDisposed,
  messageBusSubscriptionCount,
  schedulerDisposed,
  sessionLocksReleased,
} from './helpers/disposalProbe.js';
import {
  createFailingSchedulerFactory,
  createRecordingSchedulerFactory,
} from './helpers/fakeScheduler.js';

describe('Disposal @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', () => {
  it('T13 agentClient is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the agentClient is NOT yet torn down. The
      // probe reads `agentClient._unsubscribe` (a function at GREEN, set by
      // client.ts:146) which transitions to undefined on dispose
      // (client.ts:263-265). dispose() line 60 -> config.dispose() ->
      // agentClient.dispose().
      expect(agentClientDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(agentClientDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13 scheduler (facade-held injected-factory instance) is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    // Per dispose.md lines 40-47 this facade-held scheduler is CONDITIONAL T19:
    // it exists ONLY when an injected toolSchedulerFactory creates an instance
    // the facade retains. Most agents have NO facade-held scheduler, so a
    // plain-text agent would never have one and the disposed flag could never
    // flip. Build this agent WITH an injected RECORDING toolSchedulerFactory
    // (the same one T19 uses) AND drive a tool turn so the facade creates and
    // retains the injected scheduler/coordinator. dispose.md table note: "Most
    // agents have NO facade-held scheduler."
    const recording = createRecordingSchedulerFactory();
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl', {
      toolSchedulerFactory: recording.factory,
    });
    const responder = respondToFirstConfirmation(
      agent,
      ToolConfirmationOutcome.ProceedOnce,
    );
    try {
      // Run a tool turn so the facade invokes the injected factory and retains
      // the scheduler/coordinator. At RED agent.stream/onConfirmationRequest
      // throws NYI → natural fail before any scheduling.
      const events = await drain(agent.stream('use a tool'));
      expect(countType(events, 'tool-call')).toBeGreaterThanOrEqual(1);
      expect(recording.createdHandles.length).toBeGreaterThanOrEqual(1);

      // The probe's scheduler field targets the facade-held injected-factory
      // instance (captureProbe reads injectedFactoryScheduler). At GREEN the
      // factory created >=1 handle and the facade retained it.
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the injected scheduler handle is NOT yet torn
      // down. Executes the probe against the real captured handle.
      expect(schedulerDisposed(probe)).toBe(false);
      // dispose.md line 41: injectedFactoryScheduler.dispose() (guarded
      // existence check; CONDITIONAL T19).
      await agent.dispose();
      expect(schedulerDisposed(probe)).toBe(true);
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });

  it('T13 confirmationCoordinator is torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    // Per dispose.md lines 45-47 the coordinator is CONDITIONAL T19: it is
    // owned by the facade-held injected-factory scheduler and exists ONLY when
    // an injected toolSchedulerFactory created a retained instance. Build this
    // agent WITH an injected RECORDING toolSchedulerFactory AND drive a tool
    // turn so the facade retains the coordinator backing the injected
    // scheduler. A plain-text agent has no facade-held coordinator.
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

      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the coordinator backing the facade-held
      // scheduler is NOT yet torn down.
      expect(confirmationCoordinatorDisposed(probe)).toBe(false);
      // dispose.md line 46: injectedFactoryCoordinator.dispose() (CONDITIONAL
      // T19; coordinator is owned by the injected-factory scheduler).
      await agent.dispose();
      expect(confirmationCoordinatorDisposed(probe)).toBe(true);
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });

  it('T13 messageBus has zero subscriptions after dispose @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the real emitter reports its genuine current
      // listener count (>=0). This executes the probe's emitter-summation
      // (eventNames().reduce + listenerCount) against the captured bus BEFORE
      // dispose, proving the surface is reachable (would surface a missing
      // import / non-existent emitter here, not after the NYI throw).
      const preCount = messageBusSubscriptionCount(probe);
      expect(preCount).toBeGreaterThanOrEqual(0);
      // dispose() lines 50-52 unsubscribe all recorded bus subscriptions, so
      // the emitter's total listener count reaches its post-dispose baseline.
      await agent.dispose();
      expect(messageBusSubscriptionCount(probe)).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it('T13 lsp service is shut down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the LSP teardown has NOT yet run. The probe
      // reads the per-resource teardown marker `ownership.lspShutDown` that P24
      // sets when `config.shutdownLspService()` completes. LSP shutdown is a
      // NET-NEW step (dispose.md line 70) — `shutdownLsp()`
      // (lspIntegration.ts:388) clears state slots but has NO boolean flag, and
      // the headless fake never starts LSP, so the observable is the ownership
      // record's completion marker.
      expect(lspDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(lspDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13 extensions are torn down on dispose (disposed flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the extensions teardown has NOT yet run. The
      // probe reads the per-resource teardown marker
      // `ownership.extensionsDisposed` that P24 sets when
      // `extensionsManager.dispose()` completes. Extensions teardown is a
      // NET-NEW step (dispose.md line 80) — Config has NO `extensionsManager`
      // field (only `getExtensions()` via `_extensionLoader`), so the observable
      // is the ownership record's completion marker.
      expect(extensionsDisposed(probe)).toBe(false);
      await agent.dispose();
      expect(extensionsDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13e extension teardown unloads ONLY the active extensions (inactive ones are filtered out), in encounter order @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // Install a loader carrying a mix of active and inactive extensions. The
      // observable contract (dispose.md line 80): dispose() reads
      // getExtensions(), filters to isActive, and unloads each active one. The
      // recorder captures the NAMES actually passed to unloadExtension, so the
      // assertion verifies the real filtering output — inactive extensions are
      // NEVER unloaded, active ones are unloaded in encounter order.
      const extensions: readonly FakeExtension[] = [
        {
          name: 'alpha',
          version: '1.0.0',
          isActive: true,
          path: '/ext/alpha',
          contextFiles: [],
        },
        {
          name: 'beta-inactive',
          version: '1.0.0',
          isActive: false,
          path: '/ext/beta',
          contextFiles: [],
        },
        {
          name: 'gamma',
          version: '2.0.0',
          isActive: true,
          path: '/ext/gamma',
          contextFiles: [],
        },
      ];
      const recorder = installFakeExtensionLoader(probe, extensions);

      // Pre-dispose: nothing unloaded yet, marker not set.
      expect(recorder.unloaded).toStrictEqual([]);
      expect(extensionsDisposed(probe)).toBe(false);

      await agent.dispose();

      // ONLY the two active extensions were unloaded, in encounter order; the
      // inactive 'beta-inactive' was filtered out by the isActive predicate.
      expect(recorder.unloaded).toStrictEqual(['alpha', 'gamma']);
      // The teardown step completed and recorded its marker.
      expect(extensionsDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13e when every extension is inactive, NONE are unloaded yet teardown still completes @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // All extensions inactive: the isActive filter yields an empty set, so
      // unloadExtension is NEVER called, yet dispose() still completes the
      // teardown step and records its completion marker.
      const extensions: readonly FakeExtension[] = [
        {
          name: 'idle-one',
          version: '1.0.0',
          isActive: false,
          path: '/ext/one',
          contextFiles: [],
        },
        {
          name: 'idle-two',
          version: '1.0.0',
          isActive: false,
          path: '/ext/two',
          contextFiles: [],
        },
      ];
      const recorder = installFakeExtensionLoader(probe, extensions);

      await agent.dispose();

      expect(recorder.unloaded).toStrictEqual([]);
      expect(extensionsDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13e a loader lacking the optional unloadExtension method is skipped defensively: dispose completes, nothing is unloaded @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // Loader exposes getExtensions() with an ACTIVE extension but does NOT
      // surface unloadExtension. dispose()'s defensive guard
      // (unloadExtensionSafely) must skip the missing method rather than
      // crashing — dispose still completes and records its marker, with nothing
      // unloaded.
      const extensions: readonly FakeExtension[] = [
        {
          name: 'active-but-unloadless',
          version: '1.0.0',
          isActive: true,
          path: '/ext/x',
          contextFiles: [],
        },
      ];
      const recorder = installLoaderWithoutUnload(probe, extensions);

      await agent.dispose();

      expect(recorder.unloaded).toStrictEqual([]);
      expect(extensionsDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13 sessionLock is released on dispose (released flag is true) @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: the session lock teardown has NOT yet run. The
      // probe reads the per-resource teardown marker
      // `ownership.sessionLocksReleased` that P24 sets when every captured
      // lock's `release()` completes. Session-lock teardown is a NET-NEW step
      // (dispose.md lines 81-82) — `SessionLockManager.release()` uses a closure
      // variable (NOT a property) and `LockHandle` has no `.released`, so the
      // observable is the ownership record's completion marker.
      expect(sessionLocksReleased(probe)).toBe(false);
      await agent.dispose();
      expect(sessionLocksReleased(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13 re-dispose is idempotent: a second dispose() resolves without throwing and disposed flags remain true @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const probe: DisposalProbe = captureProbe(agent);
      // PRE-dispose sanity read: agentClient + extensions not yet torn down.
      // agentClient reads `_unsubscribe` (function → undefined); extensions
      // reads the ownership completion marker. Both are genuine pre-dispose
      // "not-yet-torn-down" reads.
      expect(agentClientDisposed(probe)).toBe(false);
      expect(extensionsDisposed(probe)).toBe(false);
      // First dispose performs the teardown; dispose.md lines 11-12 guard with
      // a disposed flag so a second dispose() is a no-op that resolves cleanly.
      await agent.dispose();
      // The second call must not throw — the idempotent guard short-circuits.
      await agent.dispose();
      // Disposed flags remain true after the idempotent second dispose.
      expect(agentClientDisposed(probe)).toBe(true);
      expect(extensionsDisposed(probe)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('T13 partial teardown failure surfaces an AggregateDisposeError carrying the induced failure @plan:PLAN-20260617-COREAPI.P13 @requirement:REQ-016', async () => {
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
      expect(countType(events, 'tool-call')).toBeGreaterThanOrEqual(1);

      // dispose() should REJECT with an AggregateDisposeError whose `errors`
      // array contains the induced scheduler-dispose failure.
      let captured: unknown = undefined;
      try {
        await agent.dispose();
        // dispose() must NOT resolve successfully when a teardown step failed.
        expect.fail(
          'dispose() should have rejected with AggregateDisposeError but resolved',
        );
      } catch (e: unknown) {
        captured = e;
      }

      // Structural assertion (AggregateDisposeError does not exist yet at P13 —
      // it is created at P24). The predicate checks name + errors shape without
      // importing the class.
      expect(isAggregateDisposeError(captured)).toBe(true);

      // The induced failure appears in the aggregate's errors array.
      const errors = aggregateErrors(captured);
      const foundInduced = errors.some(
        (err) => err instanceof Error && err.message === inducedFailureMessage,
      );
      expect(foundInduced).toBe(true);

      // The aggregate's summary message reports the error COUNT and embeds the
      // induced failure's text via the `${errors.length} error(s): ${details}`
      // template with '; '-joined detail. Mutants on the count interpolation,
      // the join, the map projection, or the template string would not produce
      // this exact summary.
      const summary = aggregateMessage(captured);
      expect(summary).toContain(`${errors.length} error(s)`);
      expect(summary).toContain(inducedFailureMessage);
      expect(summary).toContain('Agent dispose failed');
    } finally {
      responder.unsubscribe();
      await cleanup();
    }
  });
});
