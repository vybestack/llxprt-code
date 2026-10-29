/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: the parent side of the peak-during-send probe. For one
 * route it prepares the oracle bytes (what today's code sends for the same
 * histories, outside any measurement), writes the rows of every shape and size
 * to disk, and runs the child probe once over all of them.
 */

import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WIRE_ROUTES, recordOf, sendThroughRoute } from './wireBodyCapture.js';
import type { HistoryCase } from './wireBodyHistories.js';
import {
  SEND_PEAK_SHAPES,
  sendPeakHistory,
  writeSendPeakRows,
  type SendPeakShape,
  type SendPeakSize,
} from './sendPeakShapes.js';
import {
  isSendPeakSeries,
  judgeSendPeak,
  type SendPeakBody,
  type SendPeakOracles,
  type SendPeakPlan,
  type SendPeakSeries,
  type SendPeakSource,
  type SendPeakVerdict,
  type ShapeCounts,
} from './sendPeakMeasurement.js';
import {
  SEND_TRAP_ENV,
  parseSendTrap,
  type SendTrap,
} from './sendPeakTraps.js';

const PROVIDERS_PACKAGE_DIRECTORY = join(import.meta.dir, '..', '..', '..');
const PROBE_PATH = join(import.meta.dir, 'send-peak-probe.ts');

export interface SendPeakRun {
  readonly series: SendPeakSeries;
  readonly oracles: SendPeakOracles;
  readonly verdict: SendPeakVerdict;
}

function routeById(routeId: string): (typeof WIRE_ROUTES)[number] {
  const route = WIRE_ROUTES.find((candidate) => candidate.id === routeId);
  if (route === undefined) throw new Error(`unknown wire route ${routeId}`);
  return route;
}

/** The bytes today's code sends for a history, outside any measurement. */
async function oracleBody(
  routeId: string,
  history: HistoryCase,
): Promise<SendPeakBody> {
  const record = recordOf(
    await sendThroughRoute(routeById(routeId), history, 'rows'),
  );
  return { bytes: record.length, sha256: record.sha256 };
}

export async function runSendPeakChild(
  routeId: string,
  root: string,
  trap: SendTrap | undefined,
  native = true,
): Promise<Partial<Record<string, SendPeakSeries>>> {
  const child = Bun.spawn([process.execPath, PROBE_PATH, routeId, root], {
    cwd: PROVIDERS_PACKAGE_DIRECTORY,
    env: {
      ...process.env,
      [SEND_TRAP_ENV]: trap ?? '',
      ISSUE854_SEND_NATIVE: native ? '1' : '',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (process.env.SEND_PEAK_LOG !== undefined) {
    appendFileSync(
      `${process.env.SEND_PEAK_LOG}.probe-pids.jsonl`,
      `${JSON.stringify({ pid: child.pid, parent: process.pid, routeId })}
`,
    );
  }
  const [, error, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`send peak probe failed:\n${error}`);
  const result: unknown = JSON.parse(
    readFileSync(join(root, 'measured.json'), 'utf8'),
  );
  if (typeof result !== 'object' || result === null) {
    throw new Error('send peak probe wrote an invalid measurement');
  }
  const measurementLog = process.env.SEND_PEAK_LOG;
  if (measurementLog !== undefined && measurementLog !== '') {
    appendFileSync(
      `${measurementLog}.raw.jsonl`,
      `${JSON.stringify({ routeId, native, trap: trap ?? null, result })}
`,
    );
  }
  const bad = Object.entries(result).filter(
    ([, series]) => !isSendPeakSeries(series),
  );
  if (bad.length > 0) {
    throw new Error(`send peak probe wrote invalid series: ${bad[0][0]}`);
  }
  return Object.fromEntries(
    Object.entries(result).filter((entry): entry is [string, SendPeakSeries] =>
      isSendPeakSeries(entry[1]),
    ),
  );
}

interface ShapeHistories {
  readonly small: HistoryCase;
  readonly large: HistoryCase;
}

function historiesOf(shape: SendPeakShape): ShapeHistories {
  return {
    small: sendPeakHistory(shape, 'small'),
    large: sendPeakHistory(shape, 'large'),
  };
}

function writePlan(
  root: string,
  shapes: readonly SendPeakShape[],
  histories: Record<SendPeakShape, ShapeHistories>,
  source: SendPeakSource,
  rounds: number,
  estimate: boolean,
): void {
  const counts: Record<string, ShapeCounts> = {};
  for (const shape of shapes) {
    const sizes: SendPeakSize[] = ['small', 'large'];
    for (const size of sizes) {
      writeSendPeakRows(join(root, shape, size), histories[shape][size].rows);
    }
    counts[shape] = {
      small: histories[shape].small.rows.length,
      large: histories[shape].large.rows.length,
    };
  }
  const plan: SendPeakPlan = { source, rounds, estimate, shapes: counts };
  writeFileSync(join(root, 'plan.json'), JSON.stringify(plan));
}

export interface SendPeakOptions {
  /** Shapes to measure; both by default. */
  readonly shapes?: readonly SendPeakShape[];
  /** `rows` hands the provider a replayable selection, `stream` a one-shot stream. */
  readonly source?: SendPeakSource;
  /** Measured small/large pairs per shape. */
  readonly rounds?: number;
  /**
   * Project and estimate the prompt before each send inside the measured
   * window. Only providers with `projectPromptEnvelope` can take this.
   */
  readonly estimate?: boolean;
  /**
   * Control to apply. Without it the trap named in `ISSUE854_SEND_TRAP` (if
   * any) is applied, so running a suite under a trap shows its real
   * assertions failing.
   */
  readonly trap?: SendTrap;
}

/** Appends one JSON line per run to the file named by `SEND_PEAK_LOG`, if set. */
function logRun(
  routeId: string,
  options: SendPeakOptions,
  trap: SendTrap | undefined,
  shape: SendPeakShape,
  run: SendPeakRun,
  seconds: number,
): void {
  const path = process.env.SEND_PEAK_LOG;
  if (path === undefined || path === '') return;
  appendFileSync(
    path,
    `${JSON.stringify({
      routeId,
      shape,
      source: options.source ?? 'rows',
      estimate: options.estimate ?? false,
      trap: trap ?? null,
      seconds,
      bytes: [run.oracles.small.bytes, run.oracles.large.bytes],
      contentLength: run.series.large[0].contentLength,
      accumulation: run.series.accumulation,
      verdict: run.verdict,
    })}\n`,
  );
}

/** Runs the probe for one route over the chosen shapes at both sizes. */
export async function runSendPeak(
  routeId: string,
  options: SendPeakOptions = {},
): Promise<SendPeakRuns> {
  const started = performance.now();
  const shapes = options.shapes ?? SEND_PEAK_SHAPES;
  const trap = options.trap ?? parseSendTrap(process.env[SEND_TRAP_ENV]);
  const histories = {
    'text-only': historiesOf('text-only'),
    'tool-heavy': historiesOf('tool-heavy'),
  };
  const oracles: Partial<Record<SendPeakShape, SendPeakOracles>> = {};
  for (const shape of shapes) {
    oracles[shape] = await oraclesOf(routeId, histories[shape]);
  }
  const root = mkdtempSync(join(tmpdir(), 'send-peak-'));
  try {
    writePlan(
      root,
      shapes,
      histories,
      options.source ?? 'rows',
      options.rounds ?? 3,
      options.estimate ?? false,
    );
    const measured = await runSendPeakChild(routeId, root, trap);
    const runs: Partial<Record<SendPeakShape, SendPeakRun>> = {};
    const seconds = (performance.now() - started) / 1000;
    for (const shape of shapes) {
      const run = runOf(measured, shape, oracles[shape]);
      runs[shape] = run;
      logRun(routeId, options, trap, shape, run, seconds);
    }
    return runs;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

export type SendPeakRuns = Partial<Record<SendPeakShape, SendPeakRun>>;

export function shapeRun(
  runs: SendPeakRuns,
  shape: SendPeakShape,
): SendPeakRun {
  const run = runs[shape];
  if (run === undefined) throw new Error(`${shape} was not measured`);
  return run;
}

/**
 * Starts the run on first use and shares it, so the tests of one file that
 * judge the same measurement run the child once.
 */
export function sharedSendPeak(
  routeId: string,
  options: SendPeakOptions = {},
): () => Promise<SendPeakRuns> {
  let run: Promise<SendPeakRuns> | undefined;
  return () => (run ??= runSendPeak(routeId, options));
}

async function oraclesOf(
  routeId: string,
  histories: ShapeHistories,
): Promise<SendPeakOracles> {
  return {
    small: await oracleBody(routeId, histories.small),
    large: await oracleBody(routeId, histories.large),
  };
}

function runOf(
  measured: Partial<Record<string, SendPeakSeries>>,
  shape: SendPeakShape,
  oracles: SendPeakOracles | undefined,
): SendPeakRun {
  if (oracles === undefined) throw new Error(`no oracle for ${shape}`);
  const series = measured[shape];
  if (series === undefined) throw new Error(`probe did not measure ${shape}`);
  return { series, oracles, verdict: judgeSendPeak(series, oracles) };
}
