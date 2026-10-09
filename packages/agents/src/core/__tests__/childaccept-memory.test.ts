/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
  type PairedDelta,
  type RetainedMeasurement,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { localTransport } from './childaccept-transport.js';

const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..', '..');

interface Measurement extends RetainedMeasurement {
  count: number;
  probes: { sampled: number; surviving: number; leaked: number };
  bodyLeases: number;
  historyRows: number;
  transportCalls: number;
}

function isMeasurement(value: unknown): value is Measurement {
  if (typeof value !== 'object' || value === null || !('probes' in value))
    return false;
  const probe = value.probes;
  return (
    [
      'count',
      'retainedBytes',
      'retainedExtraBytes',
      'bodyLeases',
      'historyRows',
      'transportCalls',
    ].every((key) => typeof Reflect.get(value, key) === 'number') &&
    typeof probe === 'object' &&
    probe !== null &&
    ['sampled', 'surviving', 'leaked'].every(
      (key) => typeof Reflect.get(probe, key) === 'number',
    )
  );
}

async function fixturePayloads(directory: string): Promise<void> {
  const stream = createWriteStream(join(directory, 'payloads.jsonl'));
  for (let row = 0; row < 2048; row += 1) {
    const label = `unique-row-${String(row).padStart(6, '0')}:`;
    const payload = label + label.repeat(1800).slice(0, 32768 - label.length);
    if (!stream.write(`${payload}\n`)) await once(stream, 'drain');
  }
  stream.end();
  await once(stream, 'finish');
}

async function measure(
  root: string,
  count: number,
  workload: string,
  mode = 'normal',
): Promise<Measurement> {
  const directory = await mkdtemp(join(root, 'run-'));
  await fixturePayloads(directory);
  const transport = await localTransport(directory);
  const args = [
    join(repoRoot, 'scripts/tests/childaccept-memory-child.ts'),
    directory,
    String(count),
    workload,
    mode,
    transport.baseUrl,
  ];
  await writeFile(
    join(directory, 'command.json'),
    JSON.stringify([process.execPath, ...args]),
  );
  const stdout = createWriteStream(join(directory, 'stdout.log'));
  const stderr = createWriteStream(join(directory, 'stderr.log'));
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, LLXPRT_CONFIG_HOME: join(directory, 'config') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  try {
    const [exit] = await once(child, 'exit');
    await writeFile(join(directory, 'exit'), String(exit));
    if (exit !== 0) throw new Error(`Measurement failed: ${directory}`);
    const parsed: unknown = JSON.parse(
      await readFile(join(directory, 'report.json'), 'utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null)
      throw new Error('Missing report');
    const report = { ...parsed, transportCalls: transport.count() - 4 };
    if (!isMeasurement(report)) throw new Error(`Invalid report: ${directory}`);
    await writeFile(
      join(directory, 'report.json'),
      JSON.stringify(report, null, 2),
    );
    return report;
  } finally {
    await transport.close();
  }
}

function semanticGates(
  report: Measurement,
  count: number,
  workload: string,
): boolean {
  const probes = report.probes;
  if (probes.sampled !== 64) return false;
  if (probes.surviving !== 0) return false;
  if (probes.leaked !== 0) return false;
  if (report.count !== count) return false;
  const expectedHistoryRows = workload === 'compressed' ? 129 : count;
  return (
    report.bodyLeases === 0 &&
    report.transportCalls === 1 &&
    report.historyRows === expectedHistoryRows
  );
}

/** Fixed N = 6 per workload for the prospective protocol amendment. */
const PAIRED_RUNS = 6;

interface Control {
  mode: string;
  order: string[];
  deltas: PairedDelta[];
  median: PairedDelta;
  bound: PairedDelta;
  pass: boolean;
  reports: Measurement[];
}

/** One workload block: N small/large fresh-process pairs plus trap controls. */
async function pairedBlock(
  root: string,
  workload: string,
): Promise<{
  workload: string;
  order: string[];
  deltas: PairedDelta[];
  median: PairedDelta;
  bound: PairedDelta;
  pass: boolean;
  gates: boolean[];
  controls: Control[];
}> {
  const deltas: PairedDelta[] = [];
  const order: string[] = [];
  const gates: boolean[] = [];
  for (let iteration = 0; iteration < PAIRED_RUNS; iteration += 1) {
    // Order balance: odd iterations small-first, even iterations large-first.
    const firstIsSmall = iteration % 2 === 1;
    const firstCount = firstIsSmall ? 512 : 2048;
    const secondCount = firstIsSmall ? 2048 : 512;
    const first = await measure(root, firstCount, workload);
    const second = await measure(root, secondCount, workload);
    const small = firstIsSmall ? first : second;
    const large = firstIsSmall ? second : first;
    deltas.push({
      heap: large.retainedBytes - small.retainedBytes,
      external: large.retainedExtraBytes - small.retainedExtraBytes,
    });
    order.push(firstIsSmall ? 'small-first' : 'large-first');
    gates.push(
      semanticGates(first, firstCount, workload) &&
        semanticGates(second, secondCount, workload),
    );
    await appendFile(
      join(root, 'progress.jsonl'),
      `${JSON.stringify({ workload, iteration, order: order[iteration], delta: deltas[iteration], gate: gates[iteration] })}\n`,
    );
  }
  const estimate = pairedEstimate(deltas);
  const controls: Control[] = [];
  for (const mode of ['array', 'closure']) {
    controls.push(await trapControl(root, workload, mode));
  }
  return {
    workload,
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
  workload: string,
  mode: string,
): Promise<Control> {
  const trapDeltas: PairedDelta[] = [];
  const trapOrder: string[] = [];
  const reports: Measurement[] = [];
  for (let iteration = 0; iteration < PAIRED_RUNS; iteration += 1) {
    const firstIsSmall = iteration % 2 === 1;
    const first = await measure(
      root,
      firstIsSmall ? 512 : 2048,
      workload,
      mode,
    );
    const second = await measure(
      root,
      firstIsSmall ? 2048 : 512,
      workload,
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
      `${JSON.stringify({ workload, trap: mode, iteration, order: trapOrder[iteration], delta: trapDeltas[iteration] })}\n`,
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

describe('child facade retained memory', () => {
  it('bounds settled real-child growth under the paired estimator and refuses traps', async () => {
    const parent = join(repoRoot, 'tmp/verify854/p05d');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, 'childaccept-heap-'));
    const results = [];
    for (const workload of ['plain', 'compressed']) {
      const block = await pairedBlock(root, workload);
      results.push(block);
      await writeFile(
        join(root, 'verdicts.json'),
        JSON.stringify(results, null, 2),
      );
    }
    for (const result of results) {
      expect(result.gates).toStrictEqual(Array(6).fill(true));
      expect(result.pass).toBe(true);
      for (const control of result.controls) {
        expect(control.deltas).toHaveLength(PAIRED_RUNS);
        expect(control.reports).toHaveLength(PAIRED_RUNS * 2);
        for (const report of control.reports) {
          expect([512, 2048]).toContain(report.count);
          expect(report.probes.sampled).toBe(64);
          expect(report.probes.surviving).toBe(64);
          expect(report.probes.leaked).toBeGreaterThan(0);
          expect(report.bodyLeases).toBe(0);
          expect(report.transportCalls).toBe(1);
          expect(report.historyRows).toBe(
            result.workload === 'compressed' ? 129 : report.count,
          );
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
  }, 7200000);
});
