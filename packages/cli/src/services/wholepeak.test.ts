/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RowOwnership } from '../../../core/src/recording/rowOwnership.js';
import { JournalRecordingService } from '../../../core/src/recording/journalRecordingService.js';
import {
  JournalResumeBoot,
  resumePointOf,
} from '../../../core/src/recording/journalResume.js';
import type { JournalReadCounters } from '../../../core/src/recording/journalCounters.js';
import { createRowCounters } from '../../../core/src/recording/journalCounters.js';
import { streamHistoryItems } from '../ui/utils/streamHistoryItems.js';
import {
  MEMORY_PROJECT,
  writeMemoryFixture,
  wideWorkspaceDirectories,
  type MemoryWorkload,
} from './__tests__/support/wholememory-fixture.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import { MemoryCommand } from './__tests__/support/wholememory-command.js';
import {
  SESSION_KEYS,
  decodeDirectoriesFact,
} from '../../../core/src/recording/sessionMetaKeys.js';

async function observedReader(
  path: string,
  counters: JournalReadCounters,
): Promise<{ recording: JournalRecordingService; boot: JournalResumeBoot }> {
  const recording = await JournalRecordingService.open(
    {
      sessionId: 'wholememory',
      projectHash: MEMORY_PROJECT,
      chatsDir: dirname(path),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    },
    path,
  );
  return {
    recording,
    boot: new JournalResumeBoot(
      recording,
      await resumePointOf(recording),
      counters,
    ),
  };
}

describe('overlapping readers', () => {
  it('separates overlapping resolvers and releases cancelled consumers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'peak-overlap-'));
    await writeMemoryFixture(directory, 32, 'plain');
    const ownership = new RowOwnership();
    const counters = { ...createRowCounters().counters, ownership };
    const filename = (await readdir(directory)).find((name) =>
      name.endsWith('.llxj'),
    );
    if (filename === undefined)
      throw new Error('Missing native memory fixture');
    const path = join(directory, filename);
    const first = await observedReader(path, counters);
    const second = new JournalResumeBoot(
      first.recording,
      await resumePointOf(first.recording),
      counters,
    );
    const left = first.boot.streamRows()[Symbol.asyncIterator]();
    const right = second.streamRows()[Symbol.asyncIterator]();
    try {
      await left.next();
      expect(ownership.snapshot().liveRows).toBe(1);
      await right.next();
      expect(ownership.snapshot().liveRows).toBe(2);
      await left.return(undefined);
      expect(ownership.snapshot().liveRows).toBe(1);
      await right.return(undefined);
      expect(ownership.snapshot().liveRows).toBe(0);
    } finally {
      await left.return(undefined);
      await right.return(undefined);
      await first.recording.dispose();
      await second.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('consumer retention control', () => {
  it('observes consumer retention after real resolver exhaustion and detects the peak', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'peak-consumer-'));
    const recording = JournalRecordingService.create({
      sessionId: 'wholememory',
      projectHash: MEMORY_PROJECT,
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    await (
      await recording.session()
    ).append(
      Array.from(
        { length: 512 },
        (_, index): IContent => ({
          speaker: 'human',
          blocks: [{ type: 'text', text: String(index) }],
        }),
      ),
    );
    await recording.dispose();
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing native retention fixture');
    const ownership = new RowOwnership();
    const kit = createRowCounters();
    let producerLive = 0;
    const reader = await observedReader(path, {
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
    });
    const retained: IContent[] = [];
    try {
      for await (const row of reader.boot.streamRows()) {
        ownership.retain(row);
        retained.push(row);
      }
      expect(kit.snapshot().peakDecodedRows).toBe(1);
      expect(producerLive).toBe(0);
      expect(ownership.snapshot().liveRows).toBe(512);
      expect(
        ownership.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
      ).toBe(false);
    } finally {
      for (const row of retained) ownership.release(row);
      await reader.recording.dispose();
      await rm(directory, { recursive: true, force: true });
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

describe('admitted workspace metadata', () => {
  it('persists every directory accepted by workspace admission', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'peak-metadata-'));
    const recording = JournalRecordingService.create({
      sessionId: 'wholememory',
      projectHash: MEMORY_PROJECT,
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    try {
      const directories = await wideWorkspaceDirectories(directory);
      expect(directories).toHaveLength(513);
      const session = await recording.session();
      recording.recordDirectoriesChanged(directories);
      await expect(recording.flush()).resolves.toBeUndefined();
      const stored = await session.store.getState(SESSION_KEYS.directories);
      if (stored === undefined) throw new Error('Missing workspace metadata');
      expect(decodeDirectoriesFact(stored)).toStrictEqual(directories);
    } finally {
      await recording.dispose();
      await rm(directory, { recursive: true, force: true });
    }
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
        const directory = await mkdtemp(join(tmpdir(), 'peak-command-'));
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
  }, 600000);
});
