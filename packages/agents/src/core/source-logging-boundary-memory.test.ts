/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { heapSize } from 'bun:jsc';
import { promises as fs } from 'node:fs';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { prepareProviderContentSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import { SemanticMediaPurgeBoundaryIdentity } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { sourceHeap } from './__tests__/support/streamprocessor-source-measurements.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';

const root = sourceRootSetup();
function fixture(index: number, boundaryId: object, large: boolean): IContent {
  const text =
    `${index}:` +
    '雪'.repeat(large && index === 63 ? 6 * 1024 * 1024 : 128 * 1024);
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { semanticMediaPurgeBoundary: { boundaryId, blockIndex: 0 } },
  };
}
function census(references: Array<WeakRef<IContent>>): number {
  return references.filter((ref) => ref.deref() !== undefined).length;
}
function observeWrites(
  retained: string[],
  samples: Array<{ growth: number; live: number; chars: number }>,
  references: Array<WeakRef<IContent>>,
) {
  const open = fs.open.bind(fs);
  const state = {
    chunks: 0,
    chars: 0,
    maximumChunkChars: 0,
    baseline: 0,
    activeRowBytes: 0,
  };
  const patch = spyOn(fs, 'open').mockImplementation(async (...args) => {
    const file = await open(...args);
    const write = file.writeFile.bind(file);
    file.writeFile = async (data, options) => {
      if (typeof data === 'string') {
        state.chunks++;
        state.chars += data.length;
        state.maximumChunkChars = Math.max(
          state.maximumChunkChars,
          data.length,
        );
        if (process.env.ISSUE854_BOUNDARY_MEMORY_TRAP === 'chunks')
          retained.push(data);
        if (data.length > 1024 && state.chunks % 257 === 0) {
          const heap = await sourceHeap();
          samples.push({
            growth: heap - state.baseline - state.activeRowBytes,
            live: census(references),
            chars: state.chars,
          });
        }
      }
      await write(data, options);
    };
    return file;
  });
  return { state, restore: () => patch.mockRestore() };
}
function verifyMemory(facts: {
  sampleCount: number;
  liveOriginals: number;
  liveReadRows: number;
  delta: number;
  writer: { maximumChunkChars: number };
  artifact: { row_count: number };
  samples: Array<{ live: number; growth: number }>;
}): void {
  expect(facts.artifact.row_count).toBe(64);
  expect(facts.sampleCount).toBeGreaterThan(0);
  expect(facts.writer.maximumChunkChars).toBeLessThanOrEqual(24576);
  expect(facts.liveOriginals).toBe(0);
  expect(facts.liveReadRows).toBe(0);
  expect(facts.delta).toBeLessThan(1_048_576);
  for (const sample of facts.samples) {
    expect(sample.live).toBeLessThanOrEqual(1);
    expect(sample.growth).toBeLessThan(1_048_576);
    expect(sample.growth).toBeLessThan(2_097_152);
  }
}
async function measured(large: boolean): Promise<void> {
  const originals: Array<WeakRef<IContent>> = [];
  const readRows: Array<WeakRef<IContent>> = [];
  const retainedRows: IContent[] = [];
  const retainedChunks: string[] = [];
  const samples: Array<{ growth: number; live: number; chars: number }> = [];
  const boundaryId = new SemanticMediaPurgeBoundaryIdentity({
    contentIndex: 0,
    blockIndex: 0,
  });
  const baseline = await sourceHeap();
  const owner = await prepareProviderContentSnapshot(
    {
      async *[Symbol.asyncIterator]() {
        for (let index = 0; index < 64; index++) {
          const row = fixture(index, boundaryId, large);
          originals.push(new WeakRef(row));
          if (process.env.ISSUE854_BOUNDARY_MEMORY_TRAP === 'rows')
            retainedRows.push(row);
          yield row;
        }
      },
    },
    [],
    new DebugLogger('boundary-memory'),
    { root: root() },
  );
  const observer = observeWrites(retainedChunks, samples, readRows);
  observer.state.baseline = baseline;
  try {
    const artifact = await stageTurnRequestArtifact(root(), {
      async *[Symbol.asyncIterator]() {
        for await (const row of owner.openReader()) {
          readRows.push(new WeakRef(row));
          if (process.env.ISSUE854_BOUNDARY_MEMORY_TRAP === 'rows')
            retainedRows.push(row);
          observer.state.activeRowBytes = row.blocks.reduce(
            (bytes, block) =>
              bytes + (block.type === 'text' ? block.text.length * 2 : 0),
            0,
          );
          yield row;
        }
      },
    });
    owner.close();
    observer.restore();
    const settled = await sourceHeap();
    const facts = {
      large,
      baseline,
      settled,
      delta: settled - baseline,
      liveOriginals: census(originals),
      liveReadRows: census(readRows),
      retainedRows: retainedRows.length,
      retainedChunks: retainedChunks.length,
      retainedChars: retainedChunks.reduce(
        (sum, chunk) => sum + chunk.length,
        0,
      ),
      sampleCount: samples.length,
      maximumTransient: Math.max(...samples.map((sample) => sample.growth)),
      samples,
      writer: observer.state,
      artifact,
      heap: heapSize(),
    };
    verifyMemory(facts);
  } finally {
    observer.restore();
    owner.close();
  }
}
describe('real normalized boundary writer memory contracts', () => {
  it.each([false, true])(
    'keeps row-local identity and actual file chunks bounded, large=%s',
    async (large) => {
      const warm = await stageTurnRequestArtifact(
        root(),
        (async function* () {
          yield fixture(0, Object.freeze({}), false);
        })(),
      );
      expect(warm.row_count).toBe(1);
      await measured(large);
    },
    120000,
  );
});
