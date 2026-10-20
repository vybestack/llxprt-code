/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import {
  measurementMode,
  historyDataCensus,
} from './whole-product-measurement.js';

const resultSchema = z.object({
  inputHash: z.string(),
  held: z.number(),
  ids: z.number(),
  verdict: z.object({
    pass: z.boolean(),
    checkpointDeltas: z.array(z.number()),
  }),
  dataVerdict: z
    .object({ pass: z.boolean(), checkpointDeltas: z.array(z.number()) })
    .optional(),
});

async function runControl(
  kind: string,
  retain: boolean,
  pinned: boolean,
): Promise<z.infer<typeof resultSchema>> {
  const root = resolve(
    import.meta.dir,
    '../../../../../tmp/854-notes/p4/w24/heap-io-run-e/controls',
  );
  await mkdir(root, { recursive: true });
  const env = { ...process.env };
  if (pinned) {
    env.W24_MEASUREMENT_MODE = 'pinned-code-v1';
    env.BUN_JSC_forceCodeBlockLiveness = 'true';
  }
  const child = Bun.spawn(
    [
      process.execPath,
      resolve(import.meta.dir, 'whole-product-meter-control.ts'),
      kind,
      retain ? 'retain' : 'release',
    ],
    { env, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const name = `${pinned ? 'pinned' : 'default'}-${kind}-${retain ? 'retain' : 'release'}`;
  const directory = await mkdtemp(join(root, `${name}-`));
  await writeFile(join(directory, 'result.json'), stdout);
  await writeFile(
    join(directory, 'runtime.log'),
    `pid=${child.pid} exit=${exit}
${stderr}`,
  );
  expect(exit).toBe(0);
  return resultSchema.parse(JSON.parse(stdout));
}

function assertDefaultCensus(
  kind: string,
  pinned: boolean,
  released: z.infer<typeof resultSchema>,
  retained: z.infer<typeof resultSchema>,
): void {
  if (pinned) return;
  const releasedData = released.dataVerdict;
  const retainedData = retained.dataVerdict;
  if (releasedData === undefined || retainedData === undefined)
    throw new Error('Missing default-mode census');
  expect(releasedData.pass).toBe(true);
  if (kind === 'offheap-media' || kind === 'array') return;
  expect(retainedData.pass).toBe(false);
  expect(Math.max(...retainedData.checkpointDeltas)).toBeGreaterThan(1048576);
}

describe('whole-product retention measurement contract', () => {
  for (const kind of [
    'decoded-row',
    'cloned-text',
    'offheap-media',
    'array',
    'id-map',
  ]) {
    it(`detects genuine ${kind} retention in both execution modes`, async () => {
      for (const pinned of [false, true]) {
        const released = await runControl(kind, false, pinned);
        const retained = await runControl(kind, true, pinned);
        expect(retained.inputHash).toBe(released.inputHash);
        expect(released.verdict.pass).toBe(true);
        expect(retained.verdict.pass).toBe(false);
        expect(Math.max(...retained.verdict.checkpointDeltas)).toBeGreaterThan(
          1048576,
        );
        assertDefaultCensus(kind, pinned, released, retained);
        expect(retained.held + retained.ids).toBeGreaterThan(0);
      }
    }, 120000);
  }

  it('never labels an ordinary or partially configured runtime as pinned code', () => {
    expect(measurementMode({})).toBe('default-jsc');
    expect(() =>
      measurementMode({ W24_MEASUREMENT_MODE: 'pinned-code-v1' }),
    ).toThrow('Measurement mode requires BUN_JSC_forceCodeBlockLiveness=true');
    expect(() => measurementMode({ BUN_JSC_useJIT: 'false' })).toThrow(
      'Undeclared JSC option',
    );
  });

  it('requires the complete named runtime configuration', () => {
    expect(
      measurementMode({
        W24_MEASUREMENT_MODE: 'pinned-code-v1',
        BUN_JSC_forceCodeBlockLiveness: 'true',
      }),
    ).toBe('pinned-code-v1');
  });

  it('censuses payloads and backing stores without deleting any snapshot category', () => {
    const census = historyDataCensus({
      version: 2,
      type: 'Inspector',
      nodes: [
        0, 0, 0, 0, 1, 64, 1, 0, 2, 128, 2, 0, 3, 8192, 3, 0, 4, 16384, 4, 0, 5,
        40, 5, 0,
      ],
      nodeClassNames: [
        'root',
        'Object',
        'string',
        'ArrayBuffer',
        'FunctionCodeBlock',
        'Cell Butterfly',
      ],
    });
    expect(census.dataBytes).toBe(64 + 128 + 8192 + 40);
    expect(census.totalBytes).toBe(64 + 128 + 8192 + 16384 + 40);
    expect(
      Object.values(census.types).reduce((sum, value) => sum + value.bytes, 0),
    ).toBe(census.totalBytes);
    expect(() => historyDataCensus({ nodes: [0], nodeClassNames: [] })).toThrow(
      'Incomplete Inspector node',
    );
  });
});
