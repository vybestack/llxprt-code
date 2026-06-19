/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-007
 *
 * Behavioral tests for the shared loop-rebuild routine (used by createAgent's
 * initial build and by every client-rebinding mutation). We drive the REAL
 * rebuildLoop through its dependency-injection seam (a recording fake ctor) and
 * assert on REAL observable effects:
 *  - a fresh loop is constructed bound to the CURRENT resolved client;
 *  - on rebuild, the PRIOR run's facade AbortController is aborted (real
 *    AbortSignal state) and the PRIOR recorded subscriptions are unsubscribed;
 *  - a throwing unsubscribe is swallowed (best-effort teardown);
 *  - with no recorded subscriptions the teardown is a clean no-op.
 * No mock theater: effects are observed via real signal state, real unsubscribe
 * calls (recorded by the unsubscribers themselves), and the captured ctor
 * options.
 */

import { describe, it, expect } from 'vitest';
import {
  createRebuildLoopProbe,
  makeClient,
} from './helpers/rebuildLoopProbe.js';

describe('rebuildLoop @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001 @requirement:REQ-007', () => {
  it('initial build constructs a loop bound to the current client and arms a fresh run controller @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-001', () => {
    const probe = createRebuildLoopProbe();
    const client = makeClient('initial');
    probe.setClient(client);

    const loop = probe.rebuild();

    // exactly one construction, bound to the current client
    expect(probe.constructions).toHaveLength(1);
    expect(probe.constructions[0].options.agentClient).toBe(client);
    // the holder now owns the new loop + a fresh, un-aborted run controller
    expect(probe.holder.current).toBe(loop);
    expect(probe.holder.activeRunController).toBeDefined();
    expect(probe.holder.activeRunController?.signal.aborted).toBe(false);
    // no subscriptions recorded on a P15 initial build
    expect(probe.holder.subscriptions).toBeUndefined();
  });

  it('rebuild aborts the prior run controller and rebinds to the NEW client @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('first'));
    probe.rebuild();
    const priorController = probe.holder.activeRunController;
    expect(priorController).toBeDefined();
    expect(priorController?.signal.aborted).toBe(false);

    const secondClient = makeClient('second');
    probe.setClient(secondClient);
    const secondLoop = probe.rebuild();

    // the PRIOR controller was aborted as part of teardown
    expect(priorController?.signal.aborted).toBe(true);
    // a brand-new, un-aborted controller is armed
    expect(probe.holder.activeRunController).not.toBe(priorController);
    expect(probe.holder.activeRunController?.signal.aborted).toBe(false);
    // the new loop is bound to the SECOND client
    expect(probe.constructions).toHaveLength(2);
    expect(probe.constructions[1].options.agentClient).toBe(secondClient);
    expect(probe.holder.current).toBe(secondLoop);
  });

  it('rebuild unsubscribes every prior recorded subscription exactly once @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('first'));
    probe.rebuild();

    // record real per-turn subscriptions on the holder; each appends its tag
    const order: string[] = [];
    probe.holder.subscriptions = [() => order.push('a'), () => order.push('b')];

    probe.setClient(makeClient('second'));
    probe.rebuild();

    // both unsubscribers were invoked, in recorded order
    expect(order).toStrictEqual(['a', 'b']);
    // and the holder's subscription slot was cleared
    expect(probe.holder.subscriptions).toBeUndefined();
  });

  it('a throwing unsubscribe does not abort the rebuild (best-effort teardown) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('first'));
    probe.rebuild();

    const order: string[] = [];
    probe.holder.subscriptions = [
      () => {
        throw new Error('boom');
      },
      () => order.push('after-throw'),
    ];

    probe.setClient(makeClient('second'));
    const secondLoop = probe.rebuild();

    // teardown continued past the throwing unsubscribe to the next one
    expect(order).toStrictEqual(['after-throw']);
    // and the rebuild still produced the new loop
    expect(probe.holder.current).toBe(secondLoop);
    expect(probe.constructions).toHaveLength(2);
    expect(probe.holder.subscriptions).toBeUndefined();
  });

  it('initial build (no prior loop) SKIPS teardown — does not touch pre-seeded subscriptions @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('initial'));

    // Pre-seed subscriptions while there is NO current loop. The teardown
    // branch is guarded on `holder.current !== undefined`, so on the FIRST
    // build it must be SKIPPED entirely: these unsubscribers must NOT run.
    const order: string[] = [];
    probe.holder.subscriptions = [() => order.push('should-not-run')];

    probe.rebuild();

    // teardown was skipped → the pre-seeded unsubscriber never fired
    expect(order).toStrictEqual([]);
    // and the build still produced its fresh loop + controller
    expect(probe.constructions).toHaveLength(1);
    expect(probe.holder.activeRunController?.signal.aborted).toBe(false);
  });

  it('rebuild with a prior loop but no armed controller tears down safely (optional abort) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('first'));
    probe.rebuild();

    // Simulate a prior loop whose run controller was already cleared: current
    // is set, but activeRunController is undefined. Teardown must use optional
    // chaining (no throw) and still rebuild.
    probe.holder.activeRunController = undefined;
    expect(probe.holder.current).toBeDefined();

    probe.setClient(makeClient('second'));
    const secondLoop = probe.rebuild();

    // no throw from the absent-controller abort; a fresh controller is armed
    expect(probe.holder.current).toBe(secondLoop);
    expect(probe.constructions).toHaveLength(2);
    expect(probe.holder.activeRunController).toBeDefined();
    expect(probe.holder.activeRunController?.signal.aborted).toBe(false);
  });

  it('rebuild with no recorded subscriptions tears down cleanly (no-op unsubscribe path) @plan:PLAN-20260617-COREAPI.P15 @requirement:REQ-007', () => {
    const probe = createRebuildLoopProbe();
    probe.setClient(makeClient('first'));
    probe.rebuild();
    // explicitly leave subscriptions undefined
    expect(probe.holder.subscriptions).toBeUndefined();

    probe.setClient(makeClient('second'));
    const secondLoop = probe.rebuild();

    // a second loop is constructed regardless; no throw from the empty path
    expect(probe.constructions).toHaveLength(2);
    expect(probe.holder.current).toBe(secondLoop);
  });
});
