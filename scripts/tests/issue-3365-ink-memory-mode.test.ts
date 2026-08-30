/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20260826-INKGUARD.P01
 * @requirement REQ-3365-01
 */

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateMultiMetricPlateau,
  type PostGcMetrics,
} from '../issue-2852-memory-benchmark.ts';

/** Same tolerance the runner applies. */
const PLATEAU_TOLERANCE = 0.1;
const MB = 1_000_000;

const repoRoot = resolve(import.meta.dir, '../..');

function readScript(name: string): string {
  return readFileSync(resolve(repoRoot, 'scripts', name), 'utf8');
}

/**
 * Runs the workload in a child process so the test controls Ink's CI
 * detection. Ink reads `CI` and `CONTINUOUS_INTEGRATION` when it is imported,
 * so the parent process is stuck with whatever it started with.
 */
function runWorkload(
  frames: number,
  overrides: Record<string, string | undefined>,
): { exitCode: number | null; stdout: string; stderr: string } {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env['CI'];
  delete env['CONTINUOUS_INTEGRATION'];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const spawned = Bun.spawnSync({
    cmd: [process.execPath, 'scripts/issue-2852-memory-ink.ts', String(frames)],
    cwd: repoRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    exitCode: spawned.exitCode,
    stdout: spawned.stdout.toString(),
    stderr: spawned.stderr.toString(),
  };
}

function series(
  rows: ReadonlyArray<[number, number, number]>,
): PostGcMetrics[] {
  return rows.map(([jsc, external, dirty]) => ({
    jscHeapBytes: jsc * MB,
    externalBytes: external * MB,
    webkitMallocDirtyBytes: dirty * MB,
  }));
}

describe('issue-3365 ink memory mode', () => {
  /**
   * Measured on the pinned `@jrichman/ink@6.4.8` over 18 turns of 3,000 frames.
   * Footprint peaks on turn 7 then settles; the verdict must accept this.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-01
   */
  it('passes on the pinned fork, whose render path plateaus', () => {
    const pinned = series([
      [107.6, 37.8, 656.6],
      [105.8, 37.8, 659.9],
      [105.8, 37.8, 658.0],
      [106.5, 37.8, 661.7],
      [106.6, 37.8, 665.3],
      [106.1, 37.8, 665.4],
      [106.3, 37.8, 666.2],
      [106.3, 37.8, 650.6],
      [106.3, 37.8, 650.0],
      [106.3, 37.7, 650.5],
    ]);

    const verdict = evaluateMultiMetricPlateau(pinned, PLATEAU_TOLERANCE);

    expect(verdict.overallWithinTolerance).toBe(true);
    for (const metric of verdict.metrics) {
      expect(metric.withinTolerance).toBe(true);
    }
  });

  /**
   * Measured on `@jrichman/ink@7.1.0`, an upgrade candidate, over the same
   * workload. Footprint climbs about 210 MB per turn to 2.15 GB by turn 10.
   * This is the regression the mode exists to catch, so the verdict must
   * reject it, and must reject it on every metric rather than one.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-02
   */
  it('fails on a candidate whose render path grows without bound', () => {
    const leaking = series([
      [94.8, 47.4, 220.2],
      [182.3, 56.3, 368.1],
      [271.5, 65.0, 471.9],
      [357.0, 73.4, 735.5],
      [444.2, 81.7, 978.6],
      [529.7, 90.6, 1228.8],
      [616.9, 99.2, 1536.0],
      [704.2, 107.8, 1740.8],
      [790.8, 116.4, 2048.0],
      [878.2, 125.0, 2048.0],
    ]);

    const verdict = evaluateMultiMetricPlateau(leaking, PLATEAU_TOLERANCE);

    expect(verdict.overallWithinTolerance).toBe(false);
    const failed = verdict.metrics
      .filter((metric) => !metric.withinTolerance)
      .map((metric) => metric.name);
    expect(failed).toContain('jscHeap');
    expect(failed).toContain('external');
    expect(failed).toContain('webkitMallocDirty');
  });

  /**
   * A JSC-heap-only verdict would have accepted a build whose native memory
   * runs away, which is why `ink` is gated on all three metrics.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-02
   */
  it('rejects native growth even when the JS heap is flat', () => {
    const nativeOnly = series([
      [106.0, 37.8, 300.0],
      [106.1, 37.8, 600.0],
      [106.0, 37.8, 900.0],
      [106.2, 37.8, 1200.0],
    ]);

    const verdict = evaluateMultiMetricPlateau(nativeOnly, PLATEAU_TOLERANCE);

    expect(verdict.overallWithinTolerance).toBe(false);
    const jsc = verdict.metrics.find((metric) => metric.name === 'jscHeap');
    expect(jsc?.withinTolerance).toBe(true);
    const dirty = verdict.metrics.find(
      (metric) => metric.name === 'webkitMallocDirty',
    );
    expect(dirty?.withinTolerance).toBe(false);
  });

  /**
   * The mode is only wired if the target accepts it, the runner accepts it, and
   * the runner routes it to the multi-metric verdict rather than the JSC-only
   * one. Asserted against the sources so a partial wiring cannot ship.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-03
   */
  it('is wired through both the target and the runner', () => {
    const target = readScript('issue-2852-memory-target.ts');
    expect(target).toContain("mode !== 'ink'");
    expect(target).toContain('createInkWorkload');

    const runner = readScript('issue-2852-memory-runner.ts');
    expect(runner).toContain("mode !== 'ink'");
    expect(runner).toContain("mode === 'reasoning' || mode === 'ink'");
  });

  /**
   * Ink throttles frame production to `maxFps ?? 30` while reconciliation stays
   * synchronous, so a tight rerender loop at the default reconciles thousands
   * of times and produces almost nothing. Measured on the pinned fork: 3,000
   * rerenders yielded **39** rendered frames.
   *
   * This is the behavioural check that the throttle is off. Asserting the
   * option literal in the source would be brittle and would not prove anything
   * this does not: if throttling returns by any means, the count collapses by
   * roughly two orders of magnitude and this fails.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-04
   */
  it('produces one rendered frame per rerender, and writes every one', () => {
    const run = runWorkload(200, { CI: undefined });

    expect(run.exitCode).toBe(0);
    const counters = JSON.parse(run.stdout) as {
      framesRendered: number;
      bytesWritten: number;
    };
    // The initial mount renders once before any rerender.
    expect(counters.framesRendered).toBe(201);
    expect(counters.bytesWritten).toBeGreaterThan(200 * 1000);
  });

  /**
   * Ink's `onRender` builds the frame and then returns early when `is-in-ci`
   * sees `CI` or `CONTINUOUS_INTEGRATION`, skipping the log-update write path.
   * Measured on this workload at 200 frames: 500,332 bytes with CI unset and 6
   * bytes with `CI=true`, while `framesRendered` reads 201 either way. A frame
   * counter alone therefore cannot see it, and without this guard the mode
   * would report a clean plateau over a run whose write path did nothing.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-04
   */
  it('refuses a run whose frames never reached the terminal', () => {
    const run = runWorkload(200, { CI: 'true' });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain('wrote no terminal output');
  });

  /**
   * Dirty WebKit Malloc does not plateau under the render workload. Six runs on
   * the pinned fork at 3,000 frames a turn over five turns, MB per run:
   *
   * ```
   * 708, 380, 255, 230, 217     0%
   * 824, 807, 330, 297, 275     0%
   * 763, 708, 339, 302, 280     0%
   * 752, 690, 650, 768, 589   +11.2%
   * 623, 265, 784, 348, 310  +195.7%
   * 781, 333, 625, 377, 464   +87.7%
   * ```
   *
   * The series has no trend; it tracks when bmalloc last scavenged relative to
   * the checkpoint. Half of those runs condemn a build that is not leaking, so
   * `ink` measures the metric and reports it without gating on it. The fourth
   * row is used here verbatim.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-01
   */
  it('reports dirty WebKit Malloc for ink without letting it fail the run', () => {
    const scavengerNoise = series([
      [124.2, 36.2, 752],
      [124.2, 36.2, 690],
      [124.2, 36.2, 650],
      [124.3, 36.2, 768],
      [124.2, 36.2, 589],
    ]);

    const gated = evaluateMultiMetricPlateau(
      scavengerNoise,
      PLATEAU_TOLERANCE,
      ['jscHeap', 'external'],
    );
    const ungated = evaluateMultiMetricPlateau(
      scavengerNoise,
      PLATEAU_TOLERANCE,
    );

    expect(gated.overallWithinTolerance).toBe(true);
    expect(ungated.overallWithinTolerance).toBe(false);

    const dirty = gated.metrics.find((m) => m.name === 'webkitMallocDirty');
    expect(dirty?.gatesVerdict).toBe(false);
    expect(dirty?.withinTolerance).toBe(false);
  });

  /**
   * A verdict gating on nothing would pass everything.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-01
   */
  it('refuses a verdict that gates on no metric at all', () => {
    expect(() =>
      evaluateMultiMetricPlateau(
        series([
          [100, 30, 100],
          [100, 30, 100],
          [100, 30, 100],
        ]),
        PLATEAU_TOLERANCE,
        [],
      ),
    ).toThrow('must gate at least one metric');
  });

  /**
   * The runner must apply the reduced gate to `ink` and the full one to
   * `reasoning`, so a leak in reasoning's native retention still fails.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-02
   */
  it('gates ink on two metrics and reasoning on all three', () => {
    const runner = readScript('issue-2852-memory-runner.ts');

    expect(runner).toContain("ink: ['jscHeap', 'external']");
    expect(runner).toContain('reasoning: PLATEAU_METRIC_NAMES');
    expect(runner).toContain('GATING_METRICS_BY_MODE[mode]');
  });

  /**
   * The workload must render the shape that actually runs by default. A tree
   * carrying `<Static>` would measure the standard-buffer layout, which the
   * default configuration never mounts.
   *
   * @plan PLAN-20260826-INKGUARD.P01
   * @requirement REQ-3365-03
   */
  it('renders the alternate-buffer shape and imports the real package', () => {
    const workload = readScript('issue-2852-memory-ink.ts');

    expect(workload).toContain("from 'ink'");
    expect(workload).toContain("overflow: 'hidden'");

    // Assert against code rather than the whole file, so prose mentioning
    // `<Static>` in the rationale does not satisfy or break this.
    const imports = /import\s+\{([^}]*)\}\s+from\s+'ink'/.exec(workload);
    expect(imports).not.toBeNull();
    expect(imports?.[1]).not.toContain('Static');
    expect(workload).not.toContain('createElement(Static');
    // One mount reused across turns; remounting per turn would reset renderer
    // state and hide the accumulation this mode detects.
    expect(workload).toContain('instance.rerender');
  });
});
