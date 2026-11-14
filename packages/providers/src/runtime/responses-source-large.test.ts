/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { get_encoding } from '@dqbd/tiktoken';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';

/** UTF-16 source text plus one escaped native output item. */
const ROW_ENCODING_FACTOR = 4;

function prepare(
  root: string,
  repeats = 512,
): {
  body: { bytes: number; sha256: string };
  largestRowBytes: number;
} {
  const rows: IContent[] = Array.from({ length: 64 }, (_, index) => ({
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text: `${index}: 雪 😀 " \\ \n \ud800 data:application/pdf;base64,YQ== `.repeat(
          repeats,
        ),
      },
    ],
  }));
  for (const [index, row] of rows.entries())
    writeFileSync(join(root, `${index}.row`), serialize(row));
  const input = buildOpenAIResponsesInput(rows, {
    includeReasoningInContext: false,
    mediaPdfEnabled: true,
    outputLimits: parseOutputLimits({}),
    debug: () => {},
  });
  const projection = projectOpenAIResponsesPromptEnvelope({
    model: 'gpt-5.6',
    input,
  });
  const oracle: unknown = projection.finalizedProjection;
  if (
    typeof oracle !== 'object' ||
    oracle === null ||
    !('promptSegments' in oracle)
  )
    throw new Error('Invalid old oracle');
  if (
    !Array.isArray(oracle.promptSegments) ||
    typeof oracle.promptSegments[0] !== 'string'
  )
    throw new Error('Missing old oracle segment');
  const segment = oracle.promptSegments[0];
  const tokenizer = get_encoding('o200k_base');
  let promptTokens = 0;
  try {
    promptTokens = tokenizer.encode(segment).length;
    expect(promptTokens + 1024).toBeLessThanOrEqual(1_000_000);
  } finally {
    tokenizer.free();
  }
  const evidence = process.env.MEMORY_GATE_LOG;
  if (evidence !== undefined) {
    appendFileSync(
      evidence,
      JSON.stringify({
        gate: 'source-fixture',
        repeats,
        promptTokens,
        bytes: Buffer.byteLength(segment),
        largestRowBytes: Math.max(
          ...rows.map((row) => Buffer.byteLength(JSON.stringify(row))),
        ),
      }) + '\n',
    );
  }
  const largestRowBytes = Math.max(
    ...rows.map((row) => Buffer.byteLength(JSON.stringify(row))),
  );
  return {
    body: {
      bytes: Buffer.byteLength(segment),
      sha256: createHash('sha256').update(segment).digest('hex'),
    },
    largestRowBytes,
  };
}

interface Probe {
  readonly actual: { readonly bytes: number; readonly sha256: string };
  readonly peakLive: number;
  readonly finalLive: number;
  readonly retainedHeap: number;
  readonly sampledHeapGrowth: number;
  readonly fixedOverhead: number;
}
function probe(value: unknown): value is Probe {
  if (typeof value !== 'object' || value === null || !('actual' in value))
    return false;
  const actual = value.actual;
  if (
    typeof actual !== 'object' ||
    actual === null ||
    !('bytes' in actual) ||
    !('sha256' in actual)
  )
    return false;
  if (typeof actual.bytes !== 'number' || typeof actual.sha256 !== 'string')
    return false;
  if (!('peakLive' in value) || typeof value.peakLive !== 'number')
    return false;
  if (!('finalLive' in value) || typeof value.finalLive !== 'number')
    return false;
  if (!('retainedHeap' in value) || typeof value.retainedHeap !== 'number')
    return false;
  if (!('fixedOverhead' in value) || typeof value.fixedOverhead !== 'number')
    return false;
  return (
    'sampledHeapGrowth' in value && typeof value.sampledHeapGrowth === 'number'
  );
}

async function run(root: string, retain: boolean): Promise<Probe> {
  const calibration = join(root, 'calibration');
  mkdirSync(calibration);
  prepare(calibration, 1);
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, '__tests__', 'responses-source-large-probe.ts'),
      root,
      calibration,
    ],
    {
      env: {
        ...process.env,
        ISSUE854_SERIALIZER_RETAIN_ROWS: retain ? '1' : '0',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  await new Response(child.stdout).text();
  const error = await new Response(child.stderr).text();
  if ((await child.exited) !== 0) throw new Error(error);
  const result: unknown = JSON.parse(
    readFileSync(join(root, 'measured.json'), 'utf8'),
  );
  if (!probe(result)) throw new Error('Invalid residency evidence');
  const evidence = process.env.MEMORY_GATE_LOG;
  if (evidence !== undefined)
    appendFileSync(
      evidence,
      JSON.stringify({ gate: 'source-measured', retain, ...result }) + '\n',
    );
  return result;
}

describe('Responses source large-row acceptance', () => {
  it('matches an old full-string oracle prepared outside the measured request and releases history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'responses-large-oracle-'));
    try {
      const expected = prepare(root);
      expect(expected.body.bytes).toBeGreaterThan(1024 * 1024);
      const actual = await run(
        root,
        process.env.ISSUE854_SERIALIZER_RETAIN_ROWS === '1',
      );
      const allowanceBytes =
        actual.fixedOverhead + ROW_ENCODING_FACTOR * expected.largestRowBytes;
      expect(actual.actual).toStrictEqual(expected.body);
      expect(actual.peakLive).toBeLessThanOrEqual(2);
      expect(expected.body.bytes).toBeGreaterThanOrEqual(4 * allowanceBytes);
      expect(actual.sampledHeapGrowth).toBeLessThanOrEqual(allowanceBytes);
      expect(actual.finalLive).toBe(0);
      expect(actual.retainedHeap).toBeLessThanOrEqual(allowanceBytes);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
  it('detects a deliberately retaining source with the same exact-byte oracle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'responses-retaining-oracle-'));
    try {
      const expected = prepare(root);
      const actual = await run(root, true);
      const allowanceBytes =
        actual.fixedOverhead + ROW_ENCODING_FACTOR * expected.largestRowBytes;
      expect(actual.actual).toStrictEqual(expected.body);
      expect(actual.peakLive).toBeGreaterThan(2);
      expect(actual.sampledHeapGrowth).toBeGreaterThan(3 * allowanceBytes);
      expect(actual.retainedHeap).toBeGreaterThan(3 * allowanceBytes);
      expect(actual.finalLive).toBe(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
