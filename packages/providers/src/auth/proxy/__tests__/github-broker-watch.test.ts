/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioural tests for the blocking pr.checks watch.
 *
 * The poll schedule and terminal condition are the parts that can be wrong,
 * so they are driven with an injected clock and sleep rather than real time.
 * No test waits on wall-clock delays.
 *
 * @plan PLAN-20260731-GHBROKER.P13
 * @requirement REQ-007, REQ-010, REQ-013
 * @pseudocode 003-github-broker.md lines 96-100, 105-109
 */

import { describe, it, expect } from 'bun:test';
import {
  EARLY_POLL_MS,
  STEADY_POLL_MS,
  checksConcluded,
  pollIntervalFor,
  summarise,
  toCheckRows,
  watchChecks,
  interruptibleSleep,
} from '../github-broker-watch.js';
import { OP_REGISTRY } from '../github-broker-ops.js';

function row(name: string, bucket: string) {
  return { name, bucket, state: bucket.toUpperCase(), link: 'l' };
}

/**
 * Drives watchChecks with a virtual clock: each simulated sleep advances
 * time instantly, so the schedule is asserted without real delays.
 */
function harness(responses: unknown[]) {
  let clock = 0;
  const slept: number[] = [];
  const argvSeen: string[][] = [];
  let i = 0;
  const run = async (argv: readonly string[]) => {
    argvSeen.push([...argv]);
    return responses[Math.min(i++, responses.length - 1)];
  };
  const sleep = async (ms: number) => {
    slept.push(ms);
    clock += ms;
  };
  return {
    run,
    sleep,
    slept,
    argvSeen,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('watch schedule', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('polls fast early then backs off', () => {
    expect(pollIntervalFor(0)).toBe(EARLY_POLL_MS);
    expect(pollIntervalFor(29_999)).toBe(EARLY_POLL_MS);
    expect(pollIntervalFor(30_000)).toBe(STEADY_POLL_MS);
    expect(pollIntervalFor(600_000)).toBe(STEADY_POLL_MS);
  });

  /**
   * Lint and format checks fail inside the first minute, so the early phase
   * must actually be the fast one.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('uses the early cadence for the first three polls', async () => {
    const h = harness([[row('lint', 'pending')]]);
    await watchChecks(['pr', 'checks'], h.run, new AbortController().signal, {
      now: h.now,
      sleep: h.sleep,
      maxDurationMs: 45_000,
    });
    expect(h.slept.slice(0, 3)).toStrictEqual([
      EARLY_POLL_MS,
      EARLY_POLL_MS,
      EARLY_POLL_MS,
    ]);
    expect(h.slept).toContain(STEADY_POLL_MS);
  });
});

describe('terminal condition', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('is reached when no check is pending', () => {
    expect(checksConcluded([row('a', 'pass'), row('b', 'fail')])).toBe(true);
    expect(checksConcluded([row('a', 'pass'), row('b', 'pending')])).toBe(
      false,
    );
    expect(checksConcluded([row('a', 'skipping')])).toBe(true);
  });

  /**
   * An empty list means checks have not been registered yet, which is not
   * the same as being finished.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('is not reached when no checks have appeared yet', () => {
    expect(checksConcluded([])).toBe(false);
  });

  /**
   * A failing run must still terminate the watch — waiting for red checks
   * to turn green would hang forever.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('concludes on failure, not only on success', async () => {
    const h = harness([[row('lint', 'fail'), row('test', 'pass')]]);
    const out = await watchChecks(
      ['pr', 'checks'],
      h.run,
      new AbortController().signal,
      { now: h.now, sleep: h.sleep },
    );
    expect(out.concluded).toBe(true);
    expect(out.cancelled).toBe(false);
    expect(out.summary.fail).toBe(1);
    expect(out.polls).toBe(1);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('returns once pending checks finish', async () => {
    const h = harness([
      [row('a', 'pending')],
      [row('a', 'pending')],
      [row('a', 'pass')],
    ]);
    const out = await watchChecks(
      ['pr', 'checks'],
      h.run,
      new AbortController().signal,
      { now: h.now, sleep: h.sleep },
    );
    expect(out.concluded).toBe(true);
    expect(out.polls).toBe(3);
    expect(out.summary.pass).toBe(1);
  });
});

describe('cancellation', () => {
  /**
   * Cancelling must not spend another request.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-007
   */
  it('stops without another poll once aborted', async () => {
    const controller = new AbortController();
    const h = harness([[row('a', 'pending')]]);
    let calls = 0;
    const run = async (argv: readonly string[]) => {
      calls += 1;
      if (calls === 2) controller.abort();
      return h.run(argv);
    };
    const out = await watchChecks(['pr', 'checks'], run, controller.signal, {
      now: h.now,
      sleep: h.sleep,
    });
    expect(out.cancelled).toBe(true);
    expect(out.concluded).toBe(false);
    expect(calls).toBe(2);
  });

  /**
   * Aborting must not wait out the remaining interval, otherwise Ctrl+C
   * appears to hang for up to a full poll period.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-007
   */
  it('interruptible sleep resolves immediately on abort', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = interruptibleSleep(60_000, controller.signal);
    controller.abort();
    await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-007
   */
  it('interruptible sleep returns at once when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    await interruptibleSleep(60_000, controller.signal);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('bounds and shaping', () => {
  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-007
   */
  it('gives up at the maximum duration rather than polling forever', async () => {
    const h = harness([[row('a', 'pending')]]);
    const out = await watchChecks(
      ['pr', 'checks'],
      h.run,
      new AbortController().signal,
      { now: h.now, sleep: h.sleep, maxDurationMs: 120_000 },
    );
    expect(out.concluded).toBe(false);
    expect(out.cancelled).toBe(false);
    expect(out.elapsedMs).toBeGreaterThanOrEqual(120_000);
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-013
   */
  it('summarises by bucket', () => {
    const summary = summarise([
      row('a', 'pass'),
      row('b', 'pass'),
      row('c', 'fail'),
      row('d', 'pending'),
      row('e', 'skipping'),
    ]);
    expect(summary).toStrictEqual({
      pass: 2,
      fail: 1,
      pending: 1,
      skipping: 1,
    });
  });

  /**
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-013
   */
  it('tolerates malformed rows without throwing', () => {
    expect(toCheckRows(null)).toStrictEqual([]);
    expect(toCheckRows([null, { name: 'x' }])).toHaveLength(2);
  });

  /**
   * The watch must not become a mutating op by accident.
   *
   * @plan PLAN-20260731-GHBROKER.P13
   * @requirement REQ-010
   */
  it('pr.checks accepts watch and stays non-mutating', () => {
    const d = OP_REGISTRY['pr.checks'];
    expect('watch' in d.params).toBe(true);
    expect(d.mutating).toBe(false);
    expect(typeof d.execute).toBe('function');
  });
});

/**
 * A watch can run for an hour. Ending it because one poll failed would be
 * worse than useless: the checks it was waiting on keep running, and the
 * caller loses the wait for a fault that had already passed.
 */
describe('transient poll failures', () => {
  /** Drives watchChecks where some polls throw before a real answer. */
  function flakyHarness(script: Array<unknown | Error>) {
    let clock = 0;
    let i = 0;
    const run = async (): Promise<unknown> => {
      const next = script[Math.min(i++, script.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    };
    const sleep = async (ms: number): Promise<void> => {
      clock += ms;
    };
    return { run, sleep, now: () => clock };
  }

  /**
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-010
   */
  it('recovers when a poll throws and the next succeeds', async () => {
    const h = flakyHarness([new Error('network blip'), [row('a', 'pass')]]);
    const out = await watchChecks(
      ['pr', 'checks'],
      h.run,
      new AbortController().signal,
      { now: h.now, sleep: h.sleep },
    );
    expect(out.concluded).toBe(true);
    expect(out.summary.pass).toBe(1);
    // The failed attempt is not counted as a completed poll.
    expect(out.polls).toBe(1);
  });

  /**
   * A persistent fault must still surface, and carry its own cause rather
   * than being reported as an ordinary timeout.
   *
   * @plan PLAN-20260731-GHBROKER.P19
   * @requirement REQ-010
   */
  it('gives up and rethrows when failures persist', async () => {
    const h = flakyHarness([new Error('gh is broken')]);
    await expect(
      watchChecks(['pr', 'checks'], h.run, new AbortController().signal, {
        now: h.now,
        sleep: h.sleep,
      }),
    ).rejects.toThrow('gh is broken');
  });
});
