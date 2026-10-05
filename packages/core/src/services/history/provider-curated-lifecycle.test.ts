/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DebugLogger } from '../../debug/index.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { streamProviderContent } from './provider-curated-stream.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { providerFixtureRow } from './provider-curated-test-helpers.js';
import type { IContent } from './IContent.js';
import { consumeCuratedExit } from './curated-stream-test-helpers.js';
import { withSuffixFixture } from './history-suffix-test-helpers.js';

const logger = new DebugLogger('test:provider-lifecycle');
async function* source(
  size: number,
  bytes = 2048,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield providerFixtureRow(index, bytes);
}
async function withRoot(
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'provider-lifecycle-'));
  try {
    await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('provider preparation cancellation', () => {
  it('observes timer cancellation while capturing input before the first yield', async () => {
    await withRoot(async (root) => {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error('capture aborted')),
        0,
      );
      const stream = streamProviderContent(source(512), [], logger, {
        root,
        signal: controller.signal,
      });
      try {
        await expect(stream.next()).rejects.toThrow('capture aborted');
        expect(readdirSync(root)).toHaveLength(0);
      } finally {
        clearTimeout(timer);
        await stream.return();
      }
    });
  });
});

describe('provider normalization cursor lifetime', () => {
  const exits: ReadonlyArray<'return' | 'throw' | 'break' | 'consumer-throw'> =
    ['return', 'throw', 'break', 'consumer-throw'];
  for (const exit of exits) {
    it(`releases scratch and its suspended output on ${exit}`, async () => {
      await withRoot(async (root) => {
        const ownership = new RowOwnership();
        const stream = streamProviderContent(source(512), [], logger, {
          root,
          ownership,
        });
        const filesBeforeOpen = readdirSync(root).length;
        expect((await stream.next()).done).toBe(false);
        expect(ownership.snapshot().liveRows).toBe(1);
        const filesWhileActive = readdirSync(root).length;
        const failures = {
          return: undefined,
          throw: 'iterator failed',
          break: undefined,
          'consumer-throw': 'consumer failed',
        };
        expect(await consumeCuratedExit(stream, exit)).toBe(failures[exit]);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect([
          filesBeforeOpen,
          filesWhileActive,
          readdirSync(root).length,
        ]).toStrictEqual([0, 1, 0]);
      });
    });
  }
});

describe('provider cursor backpressure and faults', () => {
  it('respects backpressure and aborts active and unopened cursors', async () => {
    await withRoot(async (root) => {
      const ownership = new RowOwnership();
      const controller = new AbortController();
      const stream = streamProviderContent(source(512), [], logger, {
        root,
        ownership,
        signal: controller.signal,
      });
      await stream.next();
      const acquired = ownership.snapshot().acquisitions;
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ownership.snapshot().acquisitions - acquired).toBe(0);
      controller.abort(new Error('cancelled'));
      await expect(stream.next()).rejects.toThrow('cancelled');
      expect(ownership.snapshot().liveRows).toBe(0);
      const filesAfterActiveAbort = readdirSync(root).length;
      await expect(
        streamProviderContent(source(512), [], logger, {
          root,
          signal: controller.signal,
        }).next(),
      ).rejects.toThrow('cancelled');
      expect([filesAfterActiveAbort, readdirSync(root).length]).toStrictEqual([
        0, 0,
      ]);
    });
  });

  it('propagates source faults and closes both the source and scratch', async () => {
    await withRoot(async (root) => {
      let closed = false;
      async function* broken(): AsyncGenerator<IContent, void, unknown> {
        try {
          yield providerFixtureRow(0);
          throw new Error('source failed');
        } finally {
          closed = true;
        }
      }
      await expect(
        streamProviderContent(broken(), [], logger, { root }).next(),
      ).rejects.toThrow('source failed');
      expect(closed).toBe(true);
      expect(readdirSync(root)).toHaveLength(0);
    });
  });

  it('fails when an active scratch snapshot is removed, without returning stale rows', async () => {
    await withRoot(async (root) => {
      const stream = streamProviderContent(source(512), [], logger, { root });
      await stream.next();
      rmSync(join(root, readdirSync(root)[0]), { recursive: true });
      await expect(stream.next()).rejects.toThrow(
        'Missing or invalid provider normalization row',
      );
      expect(readdirSync(root)).toHaveLength(0);
    });
  });
});

describe('provider row-local bounds and counter controls', () => {
  for (const size of [512, 8192]) {
    it(`keeps explicit output ownership bounded for ${size} rows and detects a retaining consumer`, async () => {
      const owned = new RowOwnership();
      for await (const row of streamProviderContent(source(size), [], logger, {
        ownership: owned,
      })) {
        void row;
      }
      expect(owned.snapshot().liveRows).toBe(0);
      expect(
        owned.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(true);
      const retained = new RowOwnership();
      const trap: IContent[] = [];
      for await (const row of streamProviderContent(
        source(size, size === 512 ? 128 * 1024 : 16 * 1024),
        [],
        logger,
      )) {
        retained.retain(row);
        trap.push(row);
      }
      expect(retained.snapshot().peakRows).toBeGreaterThan(440);
      expect(retained.snapshot().peakSerializedBytes).toBeGreaterThan(
        8 * 1024 * 1024,
      );
      expect(
        retained.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
      for (const row of trap) retained.release(row);
      expect(retained.snapshot().liveRows).toBe(0);
    }, 120_000);
  }
});

describe('provider large rows and pre-serialization decisions', () => {
  it('permits a valid single row larger than 8 MiB without truncation', async () => {
    await withSuffixFixture(
      1,
      async (history) => {
        const stream = history.getCuratedForProviderStream();
        const row = await stream.next();
        if (row.done === true) throw new Error('Missing large row');
        expect(JSON.stringify(row.value)).toBe(
          JSON.stringify(providerFixtureRow(0, 9 * 1024 * 1024)),
        );
        expect((await stream.next()).done).toBe(true);
      },
      9 * 1024 * 1024,
      providerFixtureRow,
    );
  });

  it('retains old duplicate-response scoring when a JSON value serializes to null', async () => {
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'score', name: 't', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'score',
            toolName: 'first',
            result: NaN,
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'score',
            toolName: 'second',
            result: 1,
          },
        ],
      },
    ];
    async function* input(): AsyncGenerator<IContent, void, unknown> {
      yield* rows;
    }
    const result: IContent[] = [];
    for await (const row of streamProviderContent(input(), [], logger))
      result.push(row);
    expect(JSON.stringify(result)).toBe(
      JSON.stringify(buildProviderContent(rows, [], logger)),
    );
  });
});
