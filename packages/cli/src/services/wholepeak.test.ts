/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import { JournalResolver } from '../../../core/src/recording/journalResolver.js';
import { createRowCounters } from '../../../core/src/recording/journalCounters.js';
import { streamHistoryItems } from '../ui/utils/streamHistoryItems.js';
import {
  writeMemoryFixture,
  type MemoryWorkload,
} from './__tests__/support/wholememory-fixture.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import { MemoryCommand } from './__tests__/support/wholememory-command.js';

describe('overlapping readers', () => {
  it('separates overlapping resolvers and releases cancelled consumers', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/peak-overlap-'),
    );
    await writeMemoryFixture(directory, 32, 'plain');
    const ownership = new RowOwnership();
    const counters = { ...createRowCounters().counters, ownership };
    const path = join(directory, 'session-wholememory.jsonl');
    const first = await JournalResolver.open(path, { counters });
    const second = await JournalResolver.open(path, { counters });
    const left = first.resolve()[Symbol.asyncIterator]();
    const right = second.resolve()[Symbol.asyncIterator]();
    try {
      await left.next();
      expect(ownership.snapshot().liveRows).toBe(1);
      await right.next();
      expect(ownership.snapshot().liveRows).toBe(2);
      await left.return?.();
      expect(ownership.snapshot().liveRows).toBe(1);
      await right.return?.();
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await left.return?.();
      await right.return?.();
      await first.close();
      await second.close();
    }
  });
});

describe('consumer retention control', () => {
  it('observes consumer retention after real resolver exhaustion and detects the peak', async () => {
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/verify854/p05d/peak-consumer-'),
    );
    const path = join(directory, 'rows.jsonl');
    const records = Array.from({ length: 512 }, (_, index) =>
      JSON.stringify({
        v: 2,
        seq: index + 1,
        type: 'content',
        payload: {
          content: {
            speaker: 'human',
            blocks: [{ type: 'text', text: String(index) }],
          },
        },
      }),
    );
    await writeFile(path, records.join('\n') + '\n');
    const ownership = new RowOwnership();
    const kit = createRowCounters();
    let producerLive = 0;
    const resolver = await JournalResolver.open(path, {
      counters: {
        ...kit.counters,
        ownership,
        rowDecoded: () => {
          producerLive += 1;
          kit.counters.rowDecoded();
        },
        rowReleased: () => {
          producerLive -= 1;
          kit.counters.rowReleased();
        },
      },
    });
    const retained = [];
    try {
      for await (const entry of resolver.resolve()) {
        ownership.retain(entry.content);
        retained.push(entry.content);
      }
      expect(kit.snapshot().peakDecodedRows).toBe(1);
      expect(producerLive).toBe(0);
      await writeFile(
        'tmp/verify854/p05d/peak-consumer-control.json',
        JSON.stringify(
          {
            producerLive,
            ownership: ownership.snapshot(),
            reader: kit.snapshot(),
          },
          null,
          2,
        ),
      );
      expect(ownership.snapshot().liveRows).toBe(512);
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
    } finally {
      for (const row of retained) ownership.release(row);
      await resolver.close();
    }
    expect(ownership.snapshot().acquisitions).toBeGreaterThan(512);
    expect(ownership.snapshot().liveRows).toBe(0);
  });
});

describe('projection backpressure', () => {
  it('releases projected tool groups on cancellation and keeps rows alive under backpressure', async () => {
    const ownership = new RowOwnership();
    const rows: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'a', name: 'read', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'a',
            toolName: 'read',
            result: 'hello',
          },
        ],
      },
    ];
    const iterator = streamHistoryItems(rows, undefined, ownership)[
      Symbol.asyncIterator
    ]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.type).toBe('tool_group');
    expect(ownership.snapshot().liveRows).toBe(7);
    await iterator.return?.();
    expect(ownership.snapshot().liveRows).toBe(0);
  });
});

describe('projection failure', () => {
  it('releases grouped consumer rows when the upstream stream fails', async () => {
    const ownership = new RowOwnership();
    async function* rows(): AsyncIterable<IContent> {
      yield {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'before failure' }],
      };
      throw new Error('upstream failed');
    }
    const consume = async (): Promise<void> => {
      for await (const item of streamHistoryItems(rows(), undefined, ownership))
        void item;
    };
    await expect(consume()).rejects.toThrow('upstream failed');
    expect(ownership.snapshot().peakRows).toBeGreaterThan(0);
    expect(ownership.snapshot().liveRows).toBe(0);
  });
});

describe('continuation ownership measurements', () => {
  it('measures the real command at two lengths across continuation workloads', async () => {
    const reports = [];
    for (const [workload, target] of [
      ['plain', 'latest'],
      ['plain', 'memory-checkpoint'],
      ['compressed', 'latest'],
      ['wide-metadata', 'latest'],
      ['media', 'latest'],
    ] satisfies Array<[MemoryWorkload, string]>) {
      for (const count of [512, 2048]) {
        const directory = await mkdtemp(
          join(process.cwd(), 'tmp/verify854/p05d/peak-command-'),
        );
        await writeMemoryFixture(directory, count, workload);
        const ownership = new RowOwnership();
        const command = new MemoryCommand(ownership);
        const baseline = process.memoryUsage();
        const sampledHeap = {
          samples: 0,
          heapUsed: baseline.heapUsed,
          external: baseline.external,
        };
        const timer = setInterval(() => {
          const current = process.memoryUsage();
          sampledHeap.samples += 1;
          sampledHeap.heapUsed = Math.max(
            sampledHeap.heapUsed,
            current.heapUsed,
          );
          sampledHeap.external = Math.max(
            sampledHeap.external,
            current.external,
          );
        }, 10);
        try {
          await command.run(directory, count, workload, target);
          reports.push({
            workload,
            target,
            count,
            ownership: ownership.snapshot(),
            reader: command.counters.snapshot(),
            sampledHeap,
            baseline,
            scope:
              'Explicit resolver/boot/derived-reference/persistence/projection/UI owners. Cursor page buffers and media-owner copies are not fully covered. Timer heap samples are not exact peaks.',
          });
          expect(ownership.snapshot().acquisitions).toBeGreaterThan(0);
          expect(
            ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        } finally {
          clearInterval(timer);
          await command.close();
        }
        expect(ownership.snapshot().liveRows).toBe(0);
      }
    }
    await writeFile(
      'tmp/verify854/p05d/peak-command-reports.json',
      JSON.stringify(reports, null, 2),
    );
  }, 600000);
});
