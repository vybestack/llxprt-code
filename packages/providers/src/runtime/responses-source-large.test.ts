/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildOpenAIResponsesInput } from '../openai-responses/OpenAIResponsesInputBuilder.js';
import { projectOpenAIResponsesPromptEnvelope } from './promptEnvelopeProjections.js';

function prepare(root: string): { bytes: number; sha256: string } {
  const rows: IContent[] = Array.from({ length: 64 }, (_, index) => ({
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [
      {
        type: 'text',
        text: `${index}: 雪 😀 " \\ \n \ud800 data:application/pdf;base64,YQ== `.repeat(
          index === 24 ? 250000 : 2048,
        ),
      },
    ],
  }));
  for (const [index, row] of rows.entries())
    writeFileSync(join(root, `${index}.row`), serialize(row));
  const input = buildOpenAIResponsesInput(rows, {
    includeReasoningInContext: false,
    mediaPdfEnabled: true,
    outputLimiterConfig: { getEphemeralSettings: () => ({}) },
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
  return {
    bytes: Buffer.byteLength(segment),
    sha256: createHash('sha256').update(segment).digest('hex'),
  };
}

interface Probe {
  readonly actual: { readonly bytes: number; readonly sha256: string };
  readonly peakLive: number;
  readonly finalLive: number;
  readonly retainedHeap: number;
  readonly sampledHeapGrowth: number;
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
  return (
    'sampledHeapGrowth' in value && typeof value.sampledHeapGrowth === 'number'
  );
}

async function run(root: string, retain: boolean): Promise<Probe> {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, 'responses-source-large.test-helper.ts'),
      root,
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
  return result;
}

describe('Responses source large-row acceptance', () => {
  it('matches an old full-string oracle prepared outside the measured request and releases history', async () => {
    const root = mkdtempSync(join(tmpdir(), 'responses-large-oracle-'));
    try {
      const expected = prepare(root);
      expect(expected.bytes).toBeGreaterThan(10 * 1024 * 1024);
      const actual = await run(
        root,
        process.env.ISSUE854_SERIALIZER_RETAIN_ROWS === '1',
      );
      expect(actual.actual).toStrictEqual(expected);
      expect(actual.peakLive).toBeLessThanOrEqual(2);
      expect(actual.sampledHeapGrowth).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(actual.finalLive).toBe(0);
      expect(actual.retainedHeap).toBeLessThanOrEqual(1024 * 1024);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
  it('detects a deliberately retaining source with the same exact-byte oracle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'responses-retaining-oracle-'));
    try {
      const expected = prepare(root);
      const actual = await run(root, true);
      expect(actual.actual).toStrictEqual(expected);
      expect(actual.peakLive).toBeGreaterThan(2);
      expect(actual.finalLive).toBe(64);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60000);
});
