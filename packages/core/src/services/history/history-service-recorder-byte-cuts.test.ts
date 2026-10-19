/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalCorruptionError } from '../../journal/errors.js';
import { FRAME_HEAD_BYTES } from '../../journal/frame.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { locateCommittedState } from '../../journal/trailerSearch.js';
import { TRAILER_RECORD_BYTES } from '../../journal/trailerRecord.js';
import { withBitFlipped } from '../../journal/__tests__/support/journalFixtures.js';
import { bufferReader } from '../../journal/__tests__/support/memoryIo.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { persistedMutationRows } from './__tests__/support/service-recorder-mutations.js';
import {
  atomicRig,
  atomicRow,
  diskVersion,
  fileOf,
  type AtomicRecorder,
  persistedEntries,
} from './__tests__/support/service-atomicity.js';
import type { IContent } from './IContent.js';

function replacement(text: string): IContent[] {
  return [
    atomicRow(text),
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'call-cut',
          name: 'read',
          parameters: { text },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-cut',
          toolName: 'read',
          result: { text },
        },
      ],
    },
  ];
}

async function capture(recorder: AtomicRecorder): Promise<{
  bytes: Buffer;
  rows: Awaited<ReturnType<typeof persistedMutationRows>>;
  version: number;
  entries: Awaited<ReturnType<typeof persistedEntries>>;
}> {
  return {
    entries: await persistedEntries(fileOf(recorder.recording)),
    bytes: await readFile(fileOf(recorder.recording)),
    rows: await persistedMutationRows(recorder.recording),
    version: await diskVersion(fileOf(recorder.recording)),
  };
}

async function verifyImage(
  file: string,
  image: Uint8Array,
  recorder: AtomicRecorder,
  expected: Awaited<ReturnType<typeof capture>>,
): Promise<void> {
  const memory = await locateCommittedState(
    file,
    bufferReader(image),
    image.length,
  );
  expect(memory.trailer?.commitSeq).toBe(expected.version);
  await writeFile(file, image);
  const reader = await openJournalReadOnly(file);
  try {
    expect(reader.trailer?.commitSeq).toBe(expected.version);
    expect(reader.trailer?.durableEnd).toBe(expected.bytes.length);
  } finally {
    await reader.close();
  }
  expect((await stat(file)).size).toBe(image.length);
  const owner = await JournalRecordingService.open(
    { ...recorder.config, journal: undefined },
    file,
  );
  try {
    expect(await persistedMutationRows(owner)).toStrictEqual(expected.rows);
    expect(await persistedEntries(file)).toStrictEqual(expected.entries);
    expect((await owner.session()).store.published?.commitSeq).toBe(
      expected.version,
    );
  } finally {
    await owner.dispose();
  }
  expect((await stat(file)).size).toBe(expected.bytes.length);
}

async function corruptedRead(
  recorder: AtomicRecorder,
  file: string,
): Promise<unknown> {
  return JournalRecordingService.open(
    { ...recorder.config, journal: undefined },
    file,
  )
    .then(async (opened) => {
      try {
        await persistedMutationRows(opened);
      } finally {
        await opened.dispose();
      }
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
}

describe('HistoryService persisted replacement byte boundaries', () => {
  it('opens the prior complete version at every byte cut of both service-produced replacement groups', async () => {
    const rig = await atomicRig('every-byte');
    try {
      await rig.history.addBatch(replacement('old'));
      await rig.flush();
      const primaryBefore = await capture(rig.primary);
      const mirrorBefore = await capture(rig.mirror);
      const marks = [rig.primary, rig.mirror].map(
        (recorder) => recorder.seams.events.length,
      );
      await rig.history.replaceAll(replacement('new'));
      await rig.flush();
      const cases = [
        { recorder: rig.primary, before: primaryBefore, mark: marks[0] },
        { recorder: rig.mirror, before: mirrorBefore, mark: marks[1] },
      ];
      const summaries = [];
      for (const { recorder, before, mark } of cases) {
        const after = await capture(recorder);
        const file = join(
          rig.directory,
          `${recorder.config.sessionId}-cut.llxj`,
        );
        const writes = recorder.seams.events
          .slice(mark)
          .filter((event) => event.type === 'write');
        const bytes = after.bytes.length - before.bytes.length;
        expect(bytes).toBeGreaterThan(TRAILER_RECORD_BYTES);
        expect(bytes).toBeLessThan(64 * 1024);
        expect(after.bytes.subarray(0, before.bytes.length)).toStrictEqual(
          before.bytes,
        );
        expect(writes[0]?.position).toBe(before.bytes.length);
        expect(writes[writes.length - 1]).toMatchObject({
          position: after.bytes.length - TRAILER_RECORD_BYTES,
          length: TRAILER_RECORD_BYTES,
        });
        expect(writes.reduce((sum, write) => sum + write.length, 0)).toBe(
          bytes,
        );
        expect(after.version).toBe(before.version + 1);
        let checked = 0;
        for (let cut = before.bytes.length; cut <= after.bytes.length; cut++) {
          const image = after.bytes.subarray(0, cut);
          const complete = cut === after.bytes.length;
          const expected = complete ? after : before;
          await verifyImage(file, image, recorder, expected);
          checked++;
        }
        expect(checked).toBe(bytes + 1);
        summaries.push({
          file: recorder.config.sessionId,
          firstCut: before.bytes.length,
          finalCut: after.bytes.length,
          incompleteCuts: checked - 1,
          completeCuts: 1,
          writes,
        });
      }
      await writeFile(
        join(rig.directory, 'byte-cut-results.json'),
        JSON.stringify(summaries, null, 2),
      );
    } finally {
      await rig.close();
    }
  }, 170_000);

  it('rejects corrupt committed row and tree bytes beneath an intact replacement trailer instead of falling back to prior rows', async () => {
    const rig = await atomicRig('intact-trailer-corruption');
    try {
      await rig.history.addBatch(replacement('old'));
      await rig.flush();
      await rig.history.replaceAll(replacement('new'));
      await rig.flush();
      for (const recorder of [rig.primary, rig.mirror]) {
        const session = await recorder.recording.session();
        const snapshot = await session.store.snapshot();
        let rowOffset: number;
        try {
          rowOffset = (await snapshot.entryAt(0)).recordOffset;
        } finally {
          snapshot.close();
        }
        const bytes = await readFile(fileOf(recorder.recording));
        const reader = await openJournalReadOnly(fileOf(recorder.recording));
        let root: number;
        try {
          root = reader.trailer?.rowRoot ?? 0;
        } finally {
          await reader.close();
        }
        expect(root).toBeGreaterThan(0);
        const corruptDir = join(
          rig.directory,
          `${recorder.config.sessionId}-corrupt`,
        );
        await mkdir(corruptDir);
        for (const [name, offset] of [
          ['row', rowOffset],
          ['tree', root],
        ] as const) {
          const image = Buffer.from(
            withBitFlipped(bytes, offset + FRAME_HEAD_BYTES + 1, 0),
          );
          expect(
            image.subarray(image.length - TRAILER_RECORD_BYTES),
          ).toStrictEqual(bytes.subarray(bytes.length - TRAILER_RECORD_BYTES));
          const file = join(corruptDir, `${name}.llxj`);
          await writeFile(file, image);
          const failure = await corruptedRead(recorder, file);
          expect(failure).toBeInstanceOf(JournalCorruptionError);
          expect(await readFile(file)).toStrictEqual(Buffer.from(image));
        }
      }
    } finally {
      await rig.close();
    }
  });
});
