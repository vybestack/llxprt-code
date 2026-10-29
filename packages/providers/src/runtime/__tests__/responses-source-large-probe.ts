/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { nativePrompt } from './native-responses-fixture.js';
import { canonicalizePromptValue } from '../promptEnvelopeProjections.js';

const root = process.argv[2];
const deadline = setTimeout(() => {
  throw new Error('Source serializer probe did not settle');
}, 30000);
const retaining = process.env.ISSUE854_SERIALIZER_RETAIN_ROWS === '1';
const refs: Array<WeakRef<IContent>> = [];
const retained: IContent[] = [];
let peakLive = 0;
let sampledHeapGrowth = 0;
let baseline = 0;

/**
 * JSC can leave a dead multi-megabyte string counted in heapUsed after a
 * collection round and reclaim it in the next one (observed as a ~23 MB step
 * that vanished on the following round with no live row; warming the full-size
 * path first made it more frequent, so it is not one-time initialisation).
 * Retention shows in every round, so the minimum over several rounds is the
 * heap that is actually held.
 */
const SETTLE_ROUNDS = 3;

async function settledGrowth(): Promise<number> {
  let growth = Number.POSITIVE_INFINITY;
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    growth = Math.min(growth, (await settledHeap()) - baseline);
  }
  return growth;
}

async function sample(): Promise<number> {
  sampledHeapGrowth = Math.max(sampledHeapGrowth, await settledGrowth());
  return refs.reduce(
    (count, ref) => count + Number(ref.deref() !== undefined),
    0,
  );
}

const rows: ProviderRequestRows = {
  callerOwned: true,
  count: 64,
  async readAt(index: number): Promise<IContent> {
    if (index % 16 === 0) peakLive = Math.max(peakLive, await sample());
    const row: IContent = deserialize(readFileSync(join(root, `${index}.row`)));
    refs.push(new WeakRef(row));
    if (retaining) retained[index] = row;
    return row;
  },
  async *openReader(): AsyncGenerator<IContent> {
    for (let index = 0; index < 64; index++) yield await rows.readAt(index);
  },
};

async function hashInput(
  prompt: Awaited<ReturnType<typeof nativePrompt>>,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  const append = (text: string): void => {
    hash.update(text);
    bytes += Buffer.byteLength(text);
  };
  append('[');
  let separator = '';
  for await (const item of prompt.items()) {
    append(separator);
    append(JSON.stringify(canonicalizePromptValue(item, 'input', [])));
    separator = ',';
  }
  append(']');
  return { bytes, sha256: hash.digest('hex') };
}

async function warmup(): Promise<void> {
  const owner = await nativePrompt(
    {
      callerOwned: true,
      count: 1,
      readAt: () => ({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'warmup' }],
      }),
      async *openReader() {
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'warmup' }] };
      },
    },
    {
      model: 'gpt-5.6',
      context: {
        includeReasoningInContext: false,
        mediaPdfEnabled: true,
        outputLimits: parseOutputLimits({}),
        debug: () => {},
      },
    },
  );
  await hashInput(owner);
  await owner.dispose();
  await settledHeap();
  await settledHeap();
}

await warmup();
baseline = await settledHeap();
const prompt = await nativePrompt(rows, {
  model: 'gpt-5.6',
  context: {
    includeReasoningInContext: false,
    mediaPdfEnabled: true,
    outputLimits: parseOutputLimits({}),
    debug: () => {},
  },
});
const actual = await hashInput(prompt);
await prompt.dispose();
const finalLive = await sample();
const retainedHeap = await settledGrowth();
writeFileSync(
  join(root, 'measured.json'),
  JSON.stringify({
    actual,
    peakLive,
    finalLive,
    sampledHeapGrowth,
    retainedHeap,
    retainedRows: retained.length,
  }),
);
clearTimeout(deadline);
