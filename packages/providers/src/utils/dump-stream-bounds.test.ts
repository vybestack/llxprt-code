/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
declare const Bun: { gc(force: boolean): void };
interface JscHeap {
  heapSize(): number;
  heapStats(): { extraMemorySize: number };
}
function isJscHeap(value: unknown): value is JscHeap {
  if (typeof value !== 'object' || value === null) return false;
  if (!('heapSize' in value) || !('heapStats' in value)) return false;
  return (
    typeof value.heapSize === 'function' &&
    typeof value.heapStats === 'function'
  );
}
function loadHeap(): JscHeap {
  const value: unknown = createRequire(import.meta.url)('bun:jsc');
  if (!isJscHeap(value)) throw new Error('Bun JSC heap sampler unavailable');
  return value;
}
const { heapSize, heapStats } = loadHeap();
import { randomBytes } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  buildProviderDumpBody,
  buildProviderDumpBodyStream,
} from './providerRequestConversion.js';
import { streamPrettyJson } from './streamPrettyJson.js';
import { pairedEstimate } from '../../../core/src/test-utils/retained-growth.js';

async function settle(): Promise<void> {
  for (let index = 0; index < 3; index++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    Bun.gc(true);
  }
}
function usage(): { heap: number; external: number } {
  return { heap: heapSize(), external: heapStats().extraMemorySize };
}
async function measure(
  count: number,
  providerName: string,
  eager: boolean,
): Promise<{
  paused: { heap: number; external: number };
  retained: { heap: number; external: number };
}> {
  await settle();
  const before = usage();
  const retainedRows: IContent[] = [];
  async function* rows(): AsyncIterable<IContent> {
    for (let index = 0; index < count; index++) {
      const row: IContent = {
        speaker: index % 2 === 0 ? 'human' : 'ai',
        blocks: [
          {
            type: 'text',
            text: `${index}:${randomBytes(6144).toString('base64')}`,
          },
        ],
      };
      if (eager) retainedRows.push(row);
      yield row;
    }
  }
  let eagerBody: unknown;
  const body = eager
    ? await (async (): Promise<unknown> => {
        for await (const row of rows()) void row;
        eagerBody = buildProviderDumpBody({
          providerName,
          history: retainedRows,
        });
        return eagerBody;
      })()
    : buildProviderDumpBodyStream({ providerName, history: { rows } });
  const iterator = streamPrettyJson(body)[Symbol.asyncIterator]();
  let found = false;
  while (!found) {
    const part = await iterator.next();
    if (part.done === true) throw new Error('No text emitted');
    found = part.value.includes('0:');
  }
  await settle();
  const paused = usage();
  await iterator.return(undefined);
  await settle();
  const after = usage();
  // Keep the negative-control body reachable through the retained sample.
  if (eager && JSON.stringify(eagerBody).length < count)
    throw new Error('Empty retention trap');
  return {
    paused: {
      heap: paused.heap - before.heap,
      external: paused.external - before.external,
    },
    retained: {
      heap: after.heap - before.heap,
      external: after.external - before.external,
    },
  };
}

describe('bounded dump suspended consumer heap', () => {
  for (const providerName of ['openai', 'anthropic', 'backend'])
    it(`${providerName} keeps 512/8192 row growth below unchanged allowances`, async () => {
      await measure(32, providerName, false);
      const paused = [];
      const retained = [];
      for (let pair = 0; pair < 5; pair++) {
        const small = await measure(512, providerName, false);
        const large = await measure(8192, providerName, false);
        paused.push({
          heap: large.paused.heap - small.paused.heap,
          external: large.paused.external - small.paused.external,
        });
        retained.push({
          heap: large.retained.heap - small.retained.heap,
          external: large.retained.external - small.retained.external,
        });
      }
      expect(pairedEstimate(paused, 8 * 1024 * 1024).pass).toBe(true);
      expect(pairedEstimate(retained, 1_048_576).pass).toBe(true);
    }, 120000);
  it('rejects a deliberately materializing converter with the same checks', async () => {
    const paused = [];
    const retained = [];
    for (let pair = 0; pair < 5; pair++) {
      const small = await measure(512, 'openai', true);
      const large = await measure(8192, 'openai', true);
      paused.push({
        heap: large.paused.heap - small.paused.heap,
        external: large.paused.external - small.paused.external,
      });
      retained.push({
        heap: large.retained.heap - small.retained.heap,
        external: large.retained.external - small.retained.external,
      });
    }
    expect(pairedEstimate(paused, 8 * 1024 * 1024).pass).toBe(false);
    expect(pairedEstimate(retained, 1_048_576).pass).toBe(false);
  }, 120000);
});
