/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
declare const Bun: {
  spawn(
    command: string[],
    options: {
      stdout: 'pipe';
      stderr: 'pipe';
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  };
};
import { describe, expect, it } from 'bun:test';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  writeMemoryFixture,
  MEMORY_PAGE,
  type MemoryWorkload,
} from './wholememory-fixture.js';

interface Measurement {
  count: number;
  pagerDecoded: number;
  retainedBytes: number;
  retainedExtraBytes: number;
  metadataDirectoryCharacters: number;
  resident: { residentRows: number };
  readerCounters: { peakDecodedRows: number; rowsDecoded: number };
  probes: {
    decoded: number;
    sampled: number;
    surviving: number;
    leaked: number;
    mediaSampled: number;
    mediaSurviving: number;
  };
}

function numericFields(value: unknown, fields: string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const values = new Map(Object.entries(value));
  return fields.every((field) => typeof values.get(field) === 'number');
}

function isMeasurement(value: unknown): value is Measurement {
  if (typeof value !== 'object' || value === null) return false;
  if (
    !numericFields(value, [
      'count',
      'retainedBytes',
      'retainedExtraBytes',
      'metadataDirectoryCharacters',
      'pagerDecoded',
    ])
  )
    return false;
  if (
    !('resident' in value) ||
    !numericFields(value.resident, ['residentRows'])
  )
    return false;
  if (
    !('readerCounters' in value) ||
    !numericFields(value.readerCounters, ['peakDecodedRows', 'rowsDecoded'])
  )
    return false;
  return (
    'probes' in value &&
    numericFields(value.probes, [
      'decoded',
      'sampled',
      'surviving',
      'leaked',
      'mediaSampled',
      'mediaSurviving',
    ])
  );
}

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');

async function measure(
  root: string,
  count: number,
  workload: MemoryWorkload,
  target: string,
  mode = 'normal',
): Promise<Measurement> {
  const directory = await mkdtemp(join(root, `${workload}-${count}-${mode}-`));
  await writeMemoryFixture(directory, count, workload);
  await writeMemoryFixture(join(directory, 'warmup'), 2048, workload);
  const command = [
    process.execPath,
    join(import.meta.dir, 'wholememory-child.ts'),
    directory,
    String(count),
    workload,
    target,
    mode,
  ];
  await writeFile(join(directory, 'command.json'), JSON.stringify(command));
  const child = Bun.spawn(command, {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: repoRoot,
    env: { ...process.env, LLXPRT_CONFIG_HOME: join(directory, 'config') },
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(directory, 'stdout.log'), stdout);
  await writeFile(join(directory, 'stderr.log'), stderr);
  await writeFile(join(directory, 'exit'), String(exit));
  if (exit !== 0) throw new Error(`Child failed (${directory}): ${stderr}`);
  const report: unknown = JSON.parse(stdout.trim().split('\n').pop() ?? '');
  if (!isMeasurement(report)) throw new Error('Malformed child report');
  return report;
}

import {
  heapAccepted,
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
} from '@vybestack/llxprt-code-core/test-utils/retained-growth.js';

/** Paired fixture lengths both require complete decode coverage. */
function accepted(report: Measurement, workload: MemoryWorkload): boolean {
  const minDecoded = workload === 'compressed' ? 2 * (report.count + 1) : 2048;
  return [
    report.metadataDirectoryCharacters ===
      (workload === 'wide-metadata' ? 512 * 4097 : 0),
    report.resident.residentRows <= MEMORY_PAGE * 2,
    report.probes.surviving <= 16,
    report.probes.mediaSurviving <= 16,
    report.probes.sampled === 64,
    report.probes.decoded >= minDecoded,
    report.probes.leaked === 0,
    report.pagerDecoded >= minDecoded,
  ].every(Boolean);
}

describe('retained growth predicate', () => {
  it('does not let heap reclamation hide sampled data survivors', () => {
    const baseline: Measurement = {
      count: 2048,
      retainedBytes: 0,
      retainedExtraBytes: 0,
      pagerDecoded: 2048,
      metadataDirectoryCharacters: 0,
      resident: { residentRows: 16 },
      readerCounters: { peakDecodedRows: 1, rowsDecoded: 2048 },
      probes: {
        decoded: 2048,
        sampled: 64,
        surviving: 0,
        leaked: 0,
        mediaSampled: 64,
        mediaSurviving: 0,
      },
    };
    const reduction = {
      ...baseline,
      retainedBytes: -10000000,
      retainedExtraBytes: -10000000,
    };
    const workload: MemoryWorkload = 'plain';
    expect(accepted(reduction, workload)).toBe(true);
    expect(
      accepted(
        { ...reduction, probes: { ...baseline.probes, surviving: 64 } },
        workload,
      ),
    ).toBe(false);
    expect(
      accepted(
        { ...reduction, probes: { ...baseline.probes, mediaSurviving: 64 } },
        workload,
      ),
    ).toBe(false);
    const compressedSmall = {
      ...baseline,
      count: 512,
      pagerDecoded: 1026,
      probes: { ...baseline.probes, decoded: 1026 },
    };
    expect(accepted(compressedSmall, 'compressed')).toBe(true);
    expect(
      accepted({ ...compressedSmall, pagerDecoded: 1025 }, 'compressed'),
    ).toBe(false);
    expect(
      accepted(
        {
          ...compressedSmall,
          probes: { ...compressedSmall.probes, decoded: 1025 },
        },
        'compressed',
      ),
    ).toBe(false);
    expect(accepted(compressedSmall, 'plain')).toBe(false);
  });
});

describe('retained growth byte budgets', () => {
  it('accepts reductions and rejects positive growth beyond either byte budget', () => {
    const baseline = { retainedBytes: 3000000, retainedExtraBytes: 2000000 };
    expect(
      heapAccepted(
        baseline,
        { retainedBytes: 1000000, retainedExtraBytes: -1000000 },
        100,
      ),
    ).toBe(true);
    expect(
      heapAccepted(
        baseline,
        { retainedBytes: 3000100, retainedExtraBytes: 2000100 },
        100,
      ),
    ).toBe(true);
    expect(
      heapAccepted(
        baseline,
        { retainedBytes: 3000101, retainedExtraBytes: -1000000 },
        100,
      ),
    ).toBe(false);
    expect(
      heapAccepted(
        baseline,
        { retainedBytes: -1000000, retainedExtraBytes: 2000101 },
        100,
      ),
    ).toBe(false);
  });
});

/** Fixed N = 6 per workload for the prospective protocol amendment. */
const PAIRED_RUNS = 6;

interface RetentionControl {
  mode: string;
  order: string[];
  deltas: PairedDelta[];
  median: PairedDelta;
  bound: PairedDelta;
  pass: boolean;
  reports: Measurement[];
}

/** One workload block: N ordered small/large fresh-process pairs plus traps. */
async function pairedBlock(
  root: string,
  workload: MemoryWorkload,
  target: string,
): Promise<{
  workload: MemoryWorkload;
  target: string;
  order: string[];
  deltas: PairedDelta[];
  median: PairedDelta;
  bound: PairedDelta;
  pass: boolean;
  gates: boolean[];
  controls: RetentionControl[];
}> {
  const deltas: PairedDelta[] = [];
  const order: string[] = [];
  const gates: boolean[] = [];
  for (let iteration = 0; iteration < PAIRED_RUNS; iteration += 1) {
    // Order balance: odd iterations small-first, even iterations large-first.
    const firstIsSmall = iteration % 2 === 1;
    const first = await measure(
      root,
      firstIsSmall ? 512 : 2048,
      workload,
      target,
    );
    const second = await measure(
      root,
      firstIsSmall ? 2048 : 512,
      workload,
      target,
    );
    const small = firstIsSmall ? first : second;
    const large = firstIsSmall ? second : first;
    order.push(firstIsSmall ? 'small-first' : 'large-first');
    deltas.push({
      heap: large.retainedBytes - small.retainedBytes,
      external: large.retainedExtraBytes - small.retainedExtraBytes,
    });
    gates.push([first, second].every((report) => accepted(report, workload)));
    await appendFile(
      join(root, 'progress.jsonl'),
      `${JSON.stringify({ workload, target, iteration, order: order[iteration], delta: deltas[iteration], gate: gates[iteration] })}\n`,
    );
  }
  const estimate = pairedEstimate(deltas);
  const modes =
    workload === 'media'
      ? ['array', 'closure', 'media-reference']
      : ['array', 'closure'];
  const controls: RetentionControl[] = [];
  for (const mode of modes) {
    controls.push(await trapControl(root, workload, target, mode));
  }
  return {
    workload,
    target,
    order,
    deltas,
    median: estimate.median,
    bound: estimate.bound,
    pass: estimate.pass,
    gates,
    controls,
  };
}

async function trapControl(
  root: string,
  workload: MemoryWorkload,
  target: string,
  mode: string,
): Promise<RetentionControl> {
  const trapDeltas: PairedDelta[] = [];
  const trapOrder: string[] = [];
  const reports: Measurement[] = [];
  for (let iteration = 0; iteration < PAIRED_RUNS; iteration += 1) {
    const firstIsSmall = iteration % 2 === 1;
    const first = await measure(
      root,
      firstIsSmall ? 512 : 2048,
      workload,
      target,
      mode,
    );
    const second = await measure(
      root,
      firstIsSmall ? 2048 : 512,
      workload,
      target,
      mode,
    );
    reports.push(first, second);
    const small = firstIsSmall ? first : second;
    const large = firstIsSmall ? second : first;
    trapDeltas.push({
      heap: large.retainedBytes - small.retainedBytes,
      external: large.retainedExtraBytes - small.retainedExtraBytes,
    });
    trapOrder.push(firstIsSmall ? 'small-first' : 'large-first');
    await appendFile(
      join(root, 'progress.jsonl'),
      `${JSON.stringify({ workload, target, trap: mode, iteration, order: trapOrder[iteration], delta: trapDeltas[iteration] })}\n`,
    );
  }
  const trapEstimate = pairedEstimate(trapDeltas);
  return {
    mode,
    order: trapOrder,
    deltas: trapDeltas,
    median: trapEstimate.median,
    bound: trapEstimate.bound,
    pass: trapEstimate.pass,
    reports,
  };
}

describe('P05d whole-command retained memory', () => {
  it('bounds matched session-length growth under the paired estimator and refuses traps', async () => {
    const base = join(repoRoot, 'tmp/verify854/p05d');
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(join(base, 'retained-run-'));
    const results = [];
    for (const [workload, target] of [
      ['plain', 'latest'],
      ['plain', 'memory-checkpoint'],
      ['compressed', 'latest'],
      ['wide-metadata', 'latest'],
      ['media', 'latest'],
    ] satisfies Array<[MemoryWorkload, string]>) {
      const block = await pairedBlock(root, workload, target);
      results.push(block);
      await writeFile(
        join(root, 'verdicts.json'),
        JSON.stringify(results, null, 2),
      );
    }
    for (const result of results) {
      expect(result.gates).toStrictEqual(Array(6).fill(true));
      expect(result.pass).toBe(true);
      expectRetentionControls(result.controls, result.workload);
    }
  }, 14400_000);
});

function expectRetentionControls(
  controls: readonly RetentionControl[],
  workload: MemoryWorkload,
): void {
  for (const control of controls) {
    expect(control.deltas).toHaveLength(PAIRED_RUNS);
    expect(control.reports).toHaveLength(PAIRED_RUNS * 2);
    for (const report of control.reports) {
      expect([512, 2048]).toContain(report.count);
      expect(report.probes.sampled).toBe(64);
      expect(report.probes.leaked).toBeGreaterThan(
        control.mode === 'media-reference' ? 64 : 512,
      );
      expect(report.probes.surviving).toBe(
        control.mode === 'media-reference' ? 0 : 64,
      );
      expect(report.probes.mediaSampled).toBe(workload === 'media' ? 64 : 0);
      expect(report.probes.mediaSurviving).toBe(workload === 'media' ? 64 : 0);
      expect(report.metadataDirectoryCharacters).toBe(
        workload === 'wide-metadata' ? 512 * 4097 : 0,
      );
      expect(report.resident.residentRows).toBeLessThanOrEqual(MEMORY_PAGE * 2);
      const minDecoded =
        workload === 'compressed' ? 2 * (report.count + 1) : 2048;
      expect(report.probes.decoded).toBeGreaterThanOrEqual(minDecoded);
      expect(report.pagerDecoded).toBeGreaterThanOrEqual(minDecoded);
    }
    const trapEstimate = pairedEstimate(control.deltas);
    expect(
      trapEstimate.bound.heap > RETAINED_ALLOWANCE_BYTES ||
        trapEstimate.bound.external > RETAINED_ALLOWANCE_BYTES,
    ).toBe(true);
    expect(trapEstimate.pass).toBe(false);
    expect(control.pass).toBe(false);
  }
}
