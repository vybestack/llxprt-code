/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { IdTrieReader } from '../../journal/idTrieReader.js';
import { BoundedIdNodeCache } from '../../journal/idTrieCache.js';
import { encodeIdTrieNode } from '../../journal/idTrieNode.js';
import { frameLength } from '../../journal/frame.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { JournalSession } from './journalSession.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import {
  testJournalSeams,
  type Failures,
} from '../../journal/__tests__/support/journalFixtures.js';
import {
  decodeDensityCallPosition,
  encodeDensityCallPosition,
} from '../../journal/densityCallFacts.js';
import { JournalFormatError, JournalInputError } from '../../journal/errors.js';

interface IndexBytes {
  readonly liveIdTrieBytes: number;
  readonly densityPayloadBytes: number;
}
async function indexTreeBytes(
  reader: IdTrieReader,
  offset: number,
): Promise<IndexBytes> {
  if (offset === 0) return { liveIdTrieBytes: 0, densityPayloadBytes: 0 };
  const node = await reader.readNode(offset);
  let liveIdTrieBytes = frameLength(
    encodeIdTrieNode(node).kindHeader.length,
    0,
  );
  if (node.kind === 'leaf')
    return {
      liveIdTrieBytes,
      densityPayloadBytes: node.entries
        .filter((entry) => entry.value.length === 12)
        .reduce((bytes, entry) => bytes + entry.value.length, 0),
    };
  let densityPayloadBytes = 0;
  for (const child of node.children) {
    const bytes = await indexTreeBytes(reader, child);
    liveIdTrieBytes += bytes.liveIdTrieBytes;
    densityPayloadBytes += bytes.densityPayloadBytes;
  }
  return { liveIdTrieBytes, densityPayloadBytes };
}
async function liveIndexBytes(store: JournalStore): Promise<IndexBytes> {
  const read = await store.openRead();
  try {
    return await indexTreeBytes(
      new IdTrieReader(read.access, new BoundedIdNodeCache()),
      read.version?.roots.idRoot ?? 0,
    );
  } finally {
    await read.close();
  }
}

function call(path: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'before' },
      {
        type: 'tool_call',
        id: 'same',
        name: 'read_file',
        parameters: { file_path: path },
      },
      {
        type: 'tool_call',
        id: 'same',
        name: 'read_file',
        parameters: { file_path: '/wrong-second-block' },
      },
    ],
  };
}
function response(): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'same',
        toolName: 'read_file',
        result: 'value',
      },
    ],
  };
}
async function checkLookup(
  session: JournalSession,
  path: string,
  later: boolean,
): Promise<void> {
  const dump = new JournalDumpSnapshot(await session.store.snapshot());
  try {
    expect(
      (await dump.densityCalls.firstCall('same'))?.parameters,
    ).toStrictEqual({ file_path: path });
    expect(await dump.densityCalls.firstCall('absent')).toBeUndefined();
    expect(await dump.densityCalls.hasResponseAfter('same', 0)).toBe(later);
  } finally {
    await dump.close();
  }
}

describe('native compression density call lookup lifetime', () => {
  const directory = useTempDir('density-lookup-');
  it('reads the first source block from its pinned version across rewrite, pop, clone, checkpoint and compaction', async () => {
    const file = join(directory(), 'lookup.llxj');
    const session = await JournalSession.create(file);
    try {
      await session.append([
        call('/first'),
        { speaker: 'ai', blocks: [] },
        call('/later'),
        response(),
      ]);
      await session.store.commit([
        {
          kind: 'checkpoint',
          id: 'original',
          name: 'original',
          createdAtMs: 0,
        },
      ]);
      const snapshot = await session.store.snapshot();
      const dump = new JournalDumpSnapshot(snapshot);
      try {
        const first = await snapshot.entryAt(0);
        const tail = await snapshot.entryAt(3);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: first.label,
                draft: encodeContentRow(call('/replacement'), { owner: 0 }),
              },
            ],
          },
        ]);
        await session.store.commit([
          { kind: 'pop', cutLabel: tail.label, expectedRemoved: 1 },
        ]);
        await checkLookup(session, '/replacement', false);
        expect(
          (await dump.densityCalls.firstCall('same'))?.parameters,
        ).toStrictEqual({ file_path: '/first' });
        expect(await dump.densityCalls.hasResponseAfter('same', 0)).toBe(true);
        await expect(session.store.compact()).rejects.toThrow('live pin');
        const clone = await session.cloneUnlinked();
        try {
          await checkLookup(clone, '/replacement', false);
        } finally {
          await clone.close();
        }
      } finally {
        await dump.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      await checkLookup(session, '/replacement', false);
      expect(await session.store.checkpoint('original')).toBeDefined();
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(file);
    try {
      await checkLookup(reopened, '/replacement', false);
    } finally {
      await reopened.close();
    }
  });
  it('keeps a pending fact read admitted until it retires, preserves its original I/O failure and releases its pin', async () => {
    const failures: Failures = {};
    const seams = testJournalSeams(failures, 1, false);
    const session = await JournalSession.create(
      join(directory(), 'pending.llxj'),
      { journal: seams.dependencies },
    );
    try {
      await session.append([call('/first'), response()]);
      const dump = new JournalDumpSnapshot(await session.store.snapshot());
      let rejectRead: (error: Error) => void = () => {
        throw new Error('Read gate not initialized');
      };
      const gate = {
        promise: new Promise<void>((_resolve, reject) => {
          rejectRead = reject;
        }),
        hits: 0,
      };
      failures.readGate = gate;
      const failure = new Error('density lookup I/O failure');
      const query = dump.densityCalls.firstCall('same').then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      while (gate.hits === 0)
        await new Promise<void>((resolve) => setImmediate(resolve));
      let closed = false;
      const closing = dump.close().then(() => {
        closed = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closed).toBe(false);
      rejectRead(failure);
      const outcome = await query;
      expect('error' in outcome ? outcome.error : undefined).toBe(failure);
      await closing;
      expect(closed).toBe(true);
      failures.readGate = undefined;
      await expect(dump.densityCalls.firstCall('same')).rejects.toThrow(
        'Dump snapshot is closed',
      );
      expect(await session.store.compact()).toBe('swapped');
      await checkLookup(session, '/first', true);
    } finally {
      failures.readGate = undefined;
      await session.close();
    }
  });
  it('does not publish tentative lookup facts after a streamed producer fails and continues on the same writer', async () => {
    const file = join(directory(), 'producer.llxj');
    const seams = testJournalSeams();
    const session = await JournalSession.create(file, {
      journal: seams.dependencies,
    });
    try {
      await session.append([call('/first'), response()]);
      const beforeBytes = (await stat(file)).size;
      const beforeWrites = seams.events.filter(
        (event) => event.type === 'write',
      ).length;
      const failure = new Error('lookup producer failure');
      const tentative = (function* () {
        for (let index = 0; index < 512; index++)
          yield encodeContentRow(
            call(`/tentative-${index}-${'x'.repeat(1024)}`),
            { owner: 0 },
          );
        throw new JournalInputError(failure);
      })();
      await expect(
        session.store.commit([{ kind: 'replace', rows: tentative }]),
      ).rejects.toBe(failure);
      expect(
        seams.events.filter((event) => event.type === 'write').length,
      ).toBeGreaterThan(beforeWrites);
      expect((await stat(file)).size - beforeBytes).toBe(0);
      expect(session.store.published?.commitSeq).toBe(1);
      await checkLookup(session, '/first', true);
      await session.append([call('/new'), response()]);
      expect(session.store.published?.commitSeq).toBe(2);
      await checkLookup(session, '/first', true);
    } finally {
      await session.close();
    }
  });

  it('reuses structural facts without a new group or file growth on repeated lookups', async () => {
    const file = join(directory(), 'reuse.llxj');
    const session = await JournalSession.create(file);
    try {
      await session.append([call('/first'), response()]);
      const coldBytes = (await stat(file)).size;
      for (let index = 0; index < 40; index++)
        await checkLookup(session, '/first', true);
      const warmBytes = (await stat(file)).size;
      const storage = await liveIndexBytes(session.store);
      expect(storage.densityPayloadBytes).toBe(24);
      expect(storage.liveIdTrieBytes).toBeGreaterThan(
        storage.densityPayloadBytes,
      );
      expect(storage.liveIdTrieBytes).toBeLessThan(warmBytes);
      expect(session.store.published?.commitSeq).toBe(1);
      expect(warmBytes - coldBytes).toBe(0);
      process.stdout.write(
        `DENSITY_LOOKUP_STORAGE ${JSON.stringify({
          coldBytes,
          warmBytes,
          ...storage,
          rowLiveBytes: session.store.published?.aggregate.liveBytes,
          commitSeq: session.store.published?.commitSeq,
        })}\n`,
      );
    } finally {
      await session.close();
    }
  });
  it('encodes a bounded label and source block with independent bytes and rejects malformed payloads', () => {
    expect(
      Buffer.from(
        encodeDensityCallPosition({
          label: 0x0102030405060708n,
          block: 0x090a0b0c,
        }),
      ).toString('hex'),
    ).toBe('08070605040302010c0b0a09');
    expect(
      decodeDensityCallPosition(Buffer.from('887766554433221104030201', 'hex')),
    ).toStrictEqual({ label: 0x1122334455667788n, block: 0x01020304 });
    expect(() => decodeDensityCallPosition(new Uint8Array(11))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeDensityCallPosition(new Uint8Array(13))).toThrow(
      JournalFormatError,
    );
    expect(() => encodeDensityCallPosition({ label: -1n, block: 0 })).toThrow(
      JournalFormatError,
    );
    expect(() =>
      encodeDensityCallPosition({ label: 0n, block: 0x1_0000_0000 }),
    ).toThrow(JournalFormatError);
  });
});
