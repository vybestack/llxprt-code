/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { describe, expect, it, spyOn } from 'bun:test';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

function row(index: number, text = `surviving value ${index}`): IContent {
  if (index === 1)
    return {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aQ==',
        },
      ],
    };
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text }],
  };
}
async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}
function live(refs: ReadonlyArray<WeakRef<IContent>>): number {
  return refs.filter((ref) => ref.deref() !== undefined).length;
}

async function seed(history: HistoryService, size: number): Promise<void> {
  await history.detachedValues.replace(
    (async function* () {
      for (let index = 0; index < size; index++) yield row(index);
    })(),
  );
}

// A paused async publisher can leave conservative-stack roots after collection.
// Keep the same fixed bound across both cohorts, and reject a hold-all owner.
const LIVE_OUTPUT_BOUND = 4;

async function observePublication(
  history: HistoryService,
  size: number,
  retained?: IContent[],
): Promise<{ outputs: number; peak: number; final: number }> {
  const refs: Array<WeakRef<IContent>> = [];
  let samples = 0;
  let peak = 0;
  const publish = JournalHistoryStore.prototype.publishDetached;
  const observer = spyOn(
    JournalHistoryStore.prototype,
    'publishDetached',
  ).mockImplementation(function (
    this: JournalHistoryStore,
    task,
    host,
    model,
    options,
  ) {
    const transform = task.transform;
    if (transform === undefined) throw new Error('Missing purge producer');
    return publish.call(
      this,
      {
        ...task,
        transform: async (source, sink) =>
          transform(source, {
            ...sink,
            appendDerived: async (ordinal, content) => {
              refs.push(new WeakRef(content));
              retained?.push(content);
              await sink.appendDerived(ordinal, content);
              if (refs.length % 8 === 0) {
                await collectGarbage();
                samples++;
                peak = Math.max(peak, live(refs));
              }
            },
          }),
      },
      host,
      model,
      options,
    );
  });
  try {
    const session = new SemanticMediaPurgeSession({
      history,
      mode: () => 'remove',
      persist: async () => undefined,
    });
    const receipt = await operationFileCreates(async () => {
      const attempt = await session.begin(false);
      if (attempt === undefined)
        throw new Error('Missing native lifetime attempt');
      try {
        expect(
          await attempt.complete({
            status: 'success',
            usage: undefined,
            retryHandoff: false,
          }),
        ).toBe(true);
      } finally {
        await attempt.finalize();
      }
    }, true);
    expect(receipt).toStrictEqual({ directories: [], files: [] });
    await collectGarbage();
    expect(refs.length).toBe(size - 1);
    expect(samples).toBeGreaterThan(0);
    const final = live(refs);
    let index = 0;
    for await (const content of history.streamRawHistory()) {
      expect(content.blocks).toStrictEqual(
        row(index === 0 ? 0 : index + 1).blocks,
      );
      index++;
    }
    expect(index).toBe(size - 1);
    process.stdout.write(
      `PURGE_LIFETIME ${JSON.stringify({ size, outputs: refs.length, samples, peak, final })}\n`,
    );
    return { outputs: index, peak, final };
  } finally {
    observer.mockRestore();
  }
}

describe('native semantic purge output lifetimes', () => {
  for (const size of [65, 650]) {
    for (const trap of [false, true]) {
      it(`${trap ? 'rejects a retaining output owner' : 'bounds live output sink arguments at awaited backpressure'} over ${size} source rows`, async () => {
        const history = new HistoryService({});
        history.setTokenizerFactory(exactTokenizer());
        const retained: IContent[] = [];
        try {
          await seed(history, size);
          const result = await observePublication(
            history,
            size,
            trap ? retained : undefined,
          );
          expect(result.outputs).toBe(size - 1);
          expect(result.peak <= LIVE_OUTPUT_BOUND).toBe(!trap);
          expect(result.final).toBe(trap ? size - 1 : 0);
          expect(retained.length).toBe(trap ? size - 1 : 0);
        } finally {
          await history.dispose();
        }
      });
    }
  }
  it('preserves every byte of a greater-than-nine-MiB surviving value', async () => {
    const history = new HistoryService({});
    history.setTokenizerFactory(exactTokenizer());
    const text = 'x'.repeat(9 * 1024 * 1024 + 17);
    try {
      await history.detachedValues.replace([row(0, text), row(1), row(2)]);
      const session = new SemanticMediaPurgeSession({
        history,
        mode: () => 'remove',
        persist: async () => undefined,
      });
      const receipt = await operationFileCreates(async () => {
        const attempt = await session.begin(false);
        if (attempt === undefined)
          throw new Error('Missing large native purge');
        try {
          expect(
            await attempt.complete({
              status: 'success',
              usage: undefined,
              retryHandoff: false,
            }),
          ).toBe(true);
        } finally {
          await attempt.finalize();
        }
      }, true);
      expect(receipt).toStrictEqual({ directories: [], files: [] });
      const contents: Array<IContent['blocks']> = [];
      for await (const content of history.streamRawHistory())
        contents.push(content.blocks);
      expect(contents).toStrictEqual([row(0, text).blocks, row(2).blocks]);
    } finally {
      await history.dispose();
    }
  });
});
