/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { serializeResponsesPromptEnvelope } from './responses-source-serializer.js';
import { estimateGpt56PromptFromSources } from '../tokenizers/gpt56-source-prompt-estimator.js';
const root = process.argv[2];
const retaining = process.env.ISSUE854_MEDIA_RETAIN_ROWS === '1';
const retained: IContent[] = [];
const refs: Array<WeakRef<IContent>> = [];
const context = {
  includeReasoningInContext: false,
  mediaPdfEnabled: true,
  outputLimiterConfig: { getEphemeralSettings: () => ({}) },
  debug: (): void => {},
};
function row(index: number): IContent {
  const data = Buffer.alloc(1024, index % 256);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(data);
  data.writeUInt32BE(32 + (index % 32), 16);
  data.writeUInt32BE(33, 20);
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `image ${index}` },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: data.toString('base64'),
      },
    ],
  };
}
async function collect(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Bun.sleep(1);
    Bun.gc(true);
  }
}
async function* contents(
  count: number,
  measured: boolean,
): AsyncIterable<IContent> {
  for (let i = 0; i < count; i++) {
    const value = row(i);
    if (measured) {
      refs.push(new WeakRef(value));
      if (retaining) retained.push(value);
    }
    yield value;
  }
}
mkdirSync(join(root, 'workspace'), { recursive: true });
const activeOwner: Array<{
  phase: string;
  memory: ReturnType<typeof process.memoryUsage>;
}> = [];
async function estimate(
  count: number,
  measured: boolean,
): Promise<{
  count: number;
  imageCount: number;
  ownerGone: boolean;
  digest: string;
}> {
  const prompt = await serializeResponsesPromptEnvelope({
    model: 'gpt-5.6',
    context,
    contents: contents(count, measured),
  });
  try {
    const owner = prompt.toEstimatorProjection();
    const digest = createHash('sha256')
      .update(JSON.stringify(owner))
      .digest('hex');
    if (measured) {
      await collect();
      activeOwner.push({
        phase: 'sealed-before-estimate',
        memory: process.memoryUsage(),
      });
    }
    const result = await estimateGpt56PromptFromSources(
      {
        activeProvider: 'openai-responses',
        canonicalModel: 'gpt-5.6',
        protocol: 'openai-responses',
        wireMethod: 'responses/v1',
        finalizedProjection: owner,
        projectionRevision: 4,
        legacyEstimate: () => Promise.reject(new Error('No fallback')),
      },
      { workspaceDirectory: join(root, 'workspace') },
    );
    if (measured) {
      await collect();
      activeOwner.push({
        phase: 'sealed-after-estimate',
        memory: process.memoryUsage(),
      });
    }
    await prompt.dispose();
    return {
      count: result.count,
      imageCount: prompt.imageCount,
      ownerGone: !existsSync(prompt.imageCostsSource.path),
      digest,
    };
  } finally {
    await prompt.dispose();
  }
}
await estimate(1, false);
await collect();
const baseline = process.memoryUsage();
let peakHeap = baseline.heapUsed;
let peakRss = baseline.rss;
let peakExternal = baseline.external;
const timer = setInterval(() => {
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, memory.heapUsed);
  peakRss = Math.max(peakRss, memory.rss);
  peakExternal = Math.max(peakExternal, memory.external);
}, 25);
const result = await estimate(4096, true);
clearInterval(timer);
await collect();
const final = process.memoryUsage();
const live = refs.reduce((n, ref) => n + Number(ref.deref() !== undefined), 0);
const evidence = {
  ...result,
  activeOwner,
  retaining,
  retainedRows: retained.length,
  live,
  baseline,
  final,
  peakHeapGrowth: peakHeap - baseline.heapUsed,
  peakRssGrowth: peakRss - baseline.rss,
  peakExternalGrowth: peakExternal - baseline.external,
  retainedHeapGrowth: final.heapUsed - baseline.heapUsed,
  scratch: readdirSync(join(root, 'workspace')),
};
writeFileSync(join(root, 'memory.json'), JSON.stringify(evidence, null, 2));
if (
  live !== 0 ||
  evidence.retainedHeapGrowth > 1024 * 1024 ||
  !result.ownerGone ||
  evidence.scratch.length !== 0
)
  process.exitCode = 1;
