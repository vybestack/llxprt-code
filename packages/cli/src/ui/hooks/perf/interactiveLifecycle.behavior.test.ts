/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P12 behavioral tests for interactive instance/owner lifecycle composition.
 *
 * Every assertion exercises ACTUAL production helpers — never mirrored or
 * copied cleanup/render-catch logic:
 *  - {@link replacePreviousInstanceAndOwner} (exported from interactiveUI.tsx)
 *    driven through the tracked-state test seam
 *    {@link __setTrackedInstanceAndOwnerForTesting}.
 *  - {@link cleanupInstanceAndOwner} and {@link rollbackInteractiveFailure}
 *    (exported from session/interactiveUiLifecycle.ts), the same routines the
 *    production composition calls for pre-start replacement, registered global
 *    cleanup, render-failure rollback, and post-render setup-failure teardown.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInteractivePerfRuntime,
  type InteractivePerfRuntimeOptions,
} from './interactivePerfRuntime.js';
import type { OperationIdentitySnapshot } from '../agentStream/operationLifecycle.js';
import {
  setInteractiveStdoutObserver,
  setInteractiveRenderObserver,
  getInteractiveStdoutObserver,
  getInteractiveRenderObserver,
} from '../../inkRenderOptions.js';
import {
  getPerfPhaseObserver,
  setPerfPhaseObserver,
} from '@vybestack/llxprt-code-telemetry/perf/perfPhaseObserver.js';
import type { PerfScheduler } from '@vybestack/llxprt-code-telemetry/perf/index.js';
import {
  replacePreviousInstanceAndOwner,
  __setTrackedInstanceAndOwnerForTesting,
  __resetInteractiveUIStateForTesting,
} from '../../../session/interactiveUI.js';
import {
  cleanupInstanceAndOwner,
  rollbackInteractiveFailure,
} from '../../../session/interactiveUiLifecycle.js';

let dir: string;

function fixtureIdentity(): OperationIdentitySnapshot {
  return {
    session_id: 'sess-lifecycle',
    runtime_id: 'rt-lifecycle',
    parent_runtime_id: null,
    subagent_name: null,
    project_hash: 'hash-lifecycle',
    llxprt_version: '0.11.0',
    git_sha: 'abc1234',
    runtime: 'bun-1.3.14',
    platform: `${process.platform}-${process.arch}`,
    provider: 'test-provider',
    model: 'test-model',
    terminal_cols: 80,
    terminal_rows: 24,
    render_mode: 'incremental',
  };
}

function makeOptions(
  overrides: Partial<InteractivePerfRuntimeOptions> = {},
): InteractivePerfRuntimeOptions & { perfDir: string } {
  return {
    enabled: true,
    memoryEnabled: false,
    perfDir: dir,
    identityProvider: { snapshot: () => fixtureIdentity() },
    ...overrides,
  };
}

/**
 * Scheduler that counts timer clear() calls so a test can prove disposal
 * actually cancels the retention maintenance interval.
 */
class CountingScheduler implements PerfScheduler {
  clearCount = 0;
  setInterval(_callback: () => Promise<void>, _ms: number) {
    return {
      unref() {},
      // Arrow captures the lexical `this` (the instance) without aliasing it.
      clear: () => {
        this.clearCount += 1;
      },
    };
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(join(tmpdir(), 'perf-lifecycle-'));
  setInteractiveStdoutObserver(null);
  setInteractiveRenderObserver(null);
  setPerfPhaseObserver(null);
});

afterEach(async () => {
  // Clear any tracked instance/owner left behind by a test without invoking
  // production cleanup (tests dispose real owners explicitly). This is the
  // test-only reset path, not a production code path.
  __setTrackedInstanceAndOwnerForTesting(undefined, null);
  __resetInteractiveUIStateForTesting();
  setInteractiveStdoutObserver(null);
  setInteractiveRenderObserver(null);
  setPerfPhaseObserver(null);
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Item 1: Pre-start replacement via the ACTUAL replacePreviousInstanceAndOwner
// ---------------------------------------------------------------------------

describe('replacePreviousInstanceAndOwner — owner A then owner B (Item 1)', () => {
  it('A observers/claim/timer are gone before B installs (no observer conflict)', async () => {
    const schedulerA = new CountingScheduler();
    const ownerA = createInteractivePerfRuntime(
      makeOptions({
        runUuid: '00000000-0000-4000-8000-000000000000',
        __schedulerForTesting: schedulerA,
      }),
    );
    await ownerA!.start();

    // A installed observers, created a claim, and started the maintenance timer.
    expect(getInteractiveStdoutObserver()).toBe(ownerA!.registry);
    expect(getInteractiveRenderObserver()).toBe(ownerA!.registry);
    expect(getPerfPhaseObserver()).toBe(ownerA!.registry);
    const filesAfterA = fs.readdirSync(dir);
    expect(
      filesAfterA.some((f) =>
        f.includes('00000000-0000-4000-8000-000000000000.claim'),
      ),
    ).toBe(true);

    // Track A as the latest owner, then invoke the ACTUAL pre-start
    // replacement (the same routine startInteractiveUI calls before building
    // a new owner).
    __setTrackedInstanceAndOwnerForTesting(undefined, ownerA);
    await replacePreviousInstanceAndOwner();

    // A's observers, claim, and timer are gone.
    expect(getInteractiveStdoutObserver()).toBe(null);
    expect(getInteractiveRenderObserver()).toBe(null);
    expect(getPerfPhaseObserver()).toBe(null);
    expect(schedulerA.clearCount).toBeGreaterThanOrEqual(1);
    const filesAfterADispose = fs.readdirSync(dir);
    expect(
      filesAfterADispose.some((f) =>
        f.includes('00000000-0000-4000-8000-000000000000.claim'),
      ),
    ).toBe(false);

    // B starts without observer conflict.
    const ownerB = createInteractivePerfRuntime(
      makeOptions({ runUuid: '00000000-0000-4000-8000-000000000001' }),
    );
    await ownerB!.start();
    try {
      expect(getInteractiveStdoutObserver()).toBe(ownerB!.registry);
      expect(getInteractiveRenderObserver()).toBe(ownerB!.registry);
      expect(getPerfPhaseObserver()).toBe(ownerB!.registry);

      // B's claim exists, A's claim does not.
      const filesAfterB = fs.readdirSync(dir);
      expect(
        filesAfterB.some((f) =>
          f.includes('00000000-0000-4000-8000-000000000001.claim'),
        ),
      ).toBe(true);
      expect(
        filesAfterB.some((f) =>
          f.includes('00000000-0000-4000-8000-000000000000.claim'),
        ),
      ).toBe(false);
    } finally {
      await ownerB!.dispose();
    }
  });

  it('A → B sequential: replacement clears A, then B owns and disposes cleanly', async () => {
    const ownerA = createInteractivePerfRuntime(
      makeOptions({ runUuid: '00000000-0000-4000-8000-000000000002' }),
    );
    await ownerA!.start();
    expect(getInteractiveStdoutObserver()).toBe(ownerA!.registry);

    // ACTUAL replacement of A.
    __setTrackedInstanceAndOwnerForTesting(undefined, ownerA);
    await replacePreviousInstanceAndOwner();
    expect(getInteractiveStdoutObserver()).toBe(null);

    // Start B.
    const ownerB = createInteractivePerfRuntime(
      makeOptions({ runUuid: '00000000-0000-4000-8000-000000000003' }),
    );
    await ownerB!.start();
    try {
      expect(getInteractiveStdoutObserver()).toBe(ownerB!.registry);

      // Dispose B directly — B's observers cleared, no leak.
      await ownerB!.dispose();
      expect(getInteractiveStdoutObserver()).toBe(null);
      expect(getInteractiveRenderObserver()).toBe(null);
      expect(getPerfPhaseObserver()).toBe(null);

      // No claims left.
      const claims = fs.readdirSync(dir).filter((f) => f.endsWith('.claim'));
      expect(claims).toHaveLength(0);
    } finally {
      await ownerB!.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Item 2: A throwing clear does not skip actual unmount or real owner dispose
// ---------------------------------------------------------------------------

describe('actual cleanup helper — clear failure does not skip unmount/dispose (Item 2)', () => {
  it('a throwing clear does not skip actual unmount or real owner dispose', async () => {
    const owner = createInteractivePerfRuntime(
      makeOptions({ runUuid: '00000000-0000-4000-8000-000000000004' }),
    );
    await owner!.start();

    let unmountRan = false;
    const throwingClearInstance = {
      clear() {
        throw new Error('clear failed');
      },
      unmount() {
        unmountRan = true;
      },
    };

    // Track both, then invoke the ACTUAL replacement: clear/unmount/dispose run
    // through the shared cleanupInstanceAndOwner.
    __setTrackedInstanceAndOwnerForTesting(throwingClearInstance, owner);
    await expect(replacePreviousInstanceAndOwner()).rejects.toThrow(
      'clear failed',
    );

    // clear threw, but unmount ran and the real owner disposed (claim gone,
    // observers cleared).
    expect(unmountRan).toBe(true);
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.endsWith('.claim'))).toBe(false);
    expect(getInteractiveStdoutObserver()).toBe(null);
  });

  it('cleanupInstanceAndOwner runs clear, unmount, dispose in order and aggregates errors', async () => {
    const order: string[] = [];
    const instance = {
      clear() {
        order.push('clear');
        throw new Error('clear-err');
      },
      unmount() {
        order.push('unmount');
        throw new Error('unmount-err');
      },
    };
    const owner = {
      async dispose() {
        order.push('dispose');
        throw new Error('dispose-err');
      },
    };

    let caught: unknown;
    try {
      await cleanupInstanceAndOwner(instance, owner);
    } catch (err) {
      caught = err;
    }

    // All three steps ran in order despite each throwing.
    expect(order).toEqual(['clear', 'unmount', 'dispose']);
    expect(caught).toBeInstanceOf(AggregateError);
    const messages = (caught as AggregateError).errors.map(
      (e) => (e as Error).message,
    );
    expect(messages).toEqual(['clear-err', 'unmount-err', 'dispose-err']);
  });
});

// ---------------------------------------------------------------------------
// Item 3: ACTUAL rollbackInteractiveFailure — aggregates errors, every
// callback runs; real owner disposal during rollback.
// ---------------------------------------------------------------------------

describe('rollbackInteractiveFailure — aggregate errors, every callback runs (Item 3)', () => {
  it('aggregates render + owner + mouse + restore errors while every callback runs', async () => {
    const calls: string[] = [];
    const renderErr = new Error('render failed');

    let caught: unknown;
    try {
      await rollbackInteractiveFailure(renderErr, {
        instance: undefined,
        owner: {
          async dispose() {
            calls.push('owner');
            throw new Error('owner failed');
          },
        },
        mouse: {
          disable() {
            calls.push('mouse-disable');
            throw new Error('mouse failed');
          },
          removeListener() {
            calls.push('mouse-remove');
          },
        },
        restore: {
          restore() {
            calls.push('restore');
            throw new Error('restore failed');
          },
          removeListener() {
            calls.push('restore-remove');
          },
        },
      });
    } catch (err) {
      caught = err;
    }

    // The primary render error is preserved first.
    expect(caught).toBeInstanceOf(AggregateError);
    const agg = caught as AggregateError;
    expect(agg.errors[0]).toBe(renderErr);

    // Every cleanup error is present.
    const messages = agg.errors.map((e) => (e as Error).message);
    expect(messages).toContain('owner failed');
    expect(messages).toContain('mouse failed');
    expect(messages).toContain('restore failed');

    // Every callback ran (including the non-throwing listener removals).
    expect(calls).toEqual([
      'owner',
      'mouse-disable',
      'mouse-remove',
      'restore',
      'restore-remove',
    ]);
  });

  it('rethrows the primary error unchanged when no cleanup step fails', async () => {
    const renderErr = new Error('render failed');
    const calls: string[] = [];
    let caught: unknown;
    try {
      await rollbackInteractiveFailure(renderErr, {
        instance: undefined,
        owner: null,
        mouse: null,
        restore: {
          restore() {
            calls.push('restore');
          },
          removeListener() {
            calls.push('restore-remove');
          },
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(renderErr);
    expect(calls).toEqual(['restore', 'restore-remove']);
  });

  it('real owner disposal runs during rollback (claim removed)', async () => {
    const owner = createInteractivePerfRuntime(
      makeOptions({ runUuid: '00000000-0000-4000-8000-000000000005' }),
    );
    await owner!.start();

    try {
      // Claim exists before rollback.
      const filesBefore = fs.readdirSync(dir);
      expect(filesBefore.some((f) => f.includes('.claim'))).toBe(true);

      const renderErr = new Error('render boom');
      let caught: unknown;
      try {
        await rollbackInteractiveFailure(renderErr, {
          instance: undefined,
          owner,
          mouse: null,
          restore: {
            restore() {},
            removeListener() {},
          },
        });
      } catch (err) {
        caught = err;
      }

      // Primary render error rethrown (no cleanup step failed).
      expect(caught).toBe(renderErr);

      // Real owner disposed during rollback: claim removed, observers cleared.
      const filesAfter = fs.readdirSync(dir);
      expect(filesAfter.some((f) => f.includes('.claim'))).toBe(false);
      expect(getInteractiveStdoutObserver()).toBe(null);
    } finally {
      // Idempotent: no-op if rollback already disposed the owner.
      await owner!.dispose();
    }
  });

  it('setup-failure path: clear/unmount run on the rendered instance', async () => {
    // When render succeeds but setup fails, the transactional catch passes the
    // rendered instance to rollbackInteractiveFailure, so clear/unmount run.
    const calls: string[] = [];
    const setupErr = new Error('setup failed');
    const instance = {
      clear() {
        calls.push('clear');
      },
      unmount() {
        calls.push('unmount');
      },
    };
    let caught: unknown;
    try {
      await rollbackInteractiveFailure(setupErr, {
        instance,
        owner: null,
        mouse: null,
        restore: {
          restore() {
            calls.push('restore');
          },
          removeListener() {
            calls.push('restore-remove');
          },
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(setupErr);
    // The rendered instance was torn down (clear/unmount) plus restore ran.
    expect(calls).toEqual(['clear', 'unmount', 'restore', 'restore-remove']);
  });
});

// ---------------------------------------------------------------------------
// Item 4: Exactly-once disposal — capture+clear before dispose guarantees
// registered cleanup + replacement never double-dispose.
// ---------------------------------------------------------------------------

describe('exactly-once disposal — capture+clear before dispose (Item 4)', () => {
  it('replacement then a second replacement does not dispose twice', async () => {
    let clearCount = 0;
    let unmountCount = 0;
    let disposeCount = 0;
    const instance = {
      clear() {
        clearCount++;
      },
      unmount() {
        unmountCount++;
      },
    };
    const owner = {
      async dispose() {
        disposeCount++;
      },
    };

    __setTrackedInstanceAndOwnerForTesting(instance, owner);
    await replacePreviousInstanceAndOwner();

    // Simulate the registered global cleanup running AFTER the replacement
    // already captured+cleared the refs. It must find empty slots (no-op).
    await replacePreviousInstanceAndOwner();

    expect(clearCount).toBe(1);
    expect(unmountCount).toBe(1);
    expect(disposeCount).toBe(1);
  });

  it('cleanup that throws still clears refs so a second call is a no-op', async () => {
    let clearCount = 0;
    let unmountCount = 0;
    let disposeCount = 0;
    const instance = {
      clear() {
        clearCount++;
        throw new Error('clear boom');
      },
      unmount() {
        unmountCount++;
      },
    };
    const owner = {
      async dispose() {
        disposeCount++;
      },
    };

    __setTrackedInstanceAndOwnerForTesting(instance, owner);

    // The first replacement captures+clears refs BEFORE calling
    // cleanupInstanceAndOwner, so even though clear throws the refs are gone.
    await expect(replacePreviousInstanceAndOwner()).rejects.toThrow(
      'clear boom',
    );

    // Second call finds empty slots — no double dispose despite the throw.
    await replacePreviousInstanceAndOwner();

    expect(clearCount).toBe(1);
    expect(unmountCount).toBe(1);
    expect(disposeCount).toBe(1);
  });

  it('replacement clears owner before dispose throws so second call skips it', async () => {
    let disposeCount = 0;
    const owner = {
      async dispose() {
        disposeCount++;
        throw new Error('dispose boom');
      },
    };

    __setTrackedInstanceAndOwnerForTesting(undefined, owner);

    await expect(replacePreviousInstanceAndOwner()).rejects.toThrow(
      'dispose boom',
    );

    // Refs already cleared despite the throw — second call is a no-op.
    await replacePreviousInstanceAndOwner();

    expect(disposeCount).toBe(1);
  });
});
