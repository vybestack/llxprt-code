/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { deserialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';

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

async function collect(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Bun.sleep(1);
    Bun.gc(true);
  }
}

async function sample(): Promise<number> {
  await collect();
  sampledHeapGrowth = Math.max(
    sampledHeapGrowth,
    process.memoryUsage().heapUsed - baseline,
  );
  return refs.reduce(
    (count, ref) => count + Number(ref.deref() !== undefined),
    0,
  );
}

async function* contents(): AsyncIterable<IContent> {
  for (let index = 0; index < 64; index++) {
    if (index % 16 === 0) peakLive = Math.max(peakLive, await sample());
    const row: IContent = deserialize(readFileSync(join(root, `${index}.row`)));
    refs.push(new WeakRef(row));
    if (retaining) retained.push(row);
    yield row;
  }
}

function hashFile(path: string): { bytes: number; sha256: string } {
  const fd = openSync(path, 'r');
  const chunk = Buffer.alloc(65536);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (count === 0) break;
      hash.update(chunk.subarray(0, count));
      bytes += count;
    }
  } finally {
    closeSync(fd);
  }
  return { bytes, sha256: hash.digest('hex') };
}

async function warmup(): Promise<void> {
  async function* small(): AsyncIterable<IContent> {
    yield { speaker: 'human', blocks: [{ type: 'text', text: 'warmup' }] };
  }
  const owner = await serializeResponsesPromptEnvelope({
    model: 'gpt-5.6',
    contents: small(),
    context: {
      includeReasoningInContext: false,
      mediaPdfEnabled: true,
      outputLimiterConfig: { getEphemeralSettings: () => ({}) },
      debug: () => {},
    },
  });
  await owner.dispose();
  await collect();
  await collect();
}

await warmup();
await collect();
baseline = process.memoryUsage().heapUsed;
const prompt = await serializeResponsesPromptEnvelope({
  model: 'gpt-5.6',
  contents: contents(),
  context: {
    includeReasoningInContext: false,
    mediaPdfEnabled: true,
    outputLimiterConfig: { getEphemeralSettings: () => ({}) },
    debug: () => {},
  },
});
const actual = hashFile(prompt.projection.promptSegments[0].source.path);
await prompt.dispose();
const finalLive = await sample();
await collect();
const retainedHeap = process.memoryUsage().heapUsed - baseline;
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
