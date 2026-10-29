/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { JournalCorruptionError, RetiredJournalError } from './errors.js';
import { encodeJournalHeader, JOURNAL_FORMAT_VERSION } from './fileHeader.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { openJournalReadOnly } from './journalReader.js';
import { retiredJournalMessage } from './journalRefusal.js';
import { openJournalForOwner } from './journalWriterOpen.js';
import { TRAILER_RECORD_BYTES } from './trailerRecord.js';
import {
  buildJournal,
  buildJournalKeepingTail,
  fourRootGroup,
  standardGroup,
  testJournalSeams,
  withBitFlipped,
} from './__tests__/support/journalFixtures.js';
import { collect } from './__tests__/support/memoryIo.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('read-only open', () => {
  const tempDir = useTempDir('journal-readonly-');

  it('reads back the header and the last acked trailer', async () => {
    const { dependencies } = testJournalSeams();
    const built = await buildJournal(path.join(tempDir(), 'a.llxj'), [
      standardGroup(1),
      standardGroup(2),
    ]);

    const reader = await openJournalReadOnly(built.file, dependencies);

    expect(reader.header.syncMarker).toStrictEqual(built.syncMarker);
    expect(reader.trailer?.commitSeq).toBe(2);
    expect(reader.trailer?.durableEnd).toBe(built.acks[1].durableEnd);
    expect(reader.trailer?.groupTag).toBe(built.acks[1].groupTag);
    await reader.close();
  });

  it('leaves an uncommitted tail in place', async () => {
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'tail.llxj'),
      testJournalSeams({ failFlushAt: 1 }),
      [standardGroup(1), standardGroup(2)],
    );
    const { dependencies } = testJournalSeams();

    const reader = await openJournalReadOnly(built.file, dependencies);
    await reader.close();

    expect(reader.trailer?.commitSeq).toBe(1);
    expect((await fsp.stat(built.file)).size).toBe(built.bytes.length);
  });

  it('reads a reached record with its CRC checked while it streams', async () => {
    const built = await buildJournal(path.join(tempDir(), 'rec.llxj'), [
      standardGroup(1, { rowBodyBytes: 5000 }),
    ]);
    const { dependencies } = testJournalSeams();
    const reader = await openJournalReadOnly(built.file, dependencies);

    const head = await reader.readRecordHead(JOURNAL_HEADER_BYTES);
    const body = await collect(reader.readRecordBody(head));
    await reader.close();

    expect(head.bodyLen).toBe(5000);
    expect(body.length).toBe(5000);
  });

  it('reports a flipped body bit of a reached record as corruption with the record offset', async () => {
    const built = await buildJournal(path.join(tempDir(), 'flip.llxj'), [
      standardGroup(1, { rowBodyBytes: 5000 }),
    ]);
    const damaged = withBitFlipped(
      built.bytes,
      JOURNAL_HEADER_BYTES + 20 + 24 + 100,
      2,
    );
    await fsp.writeFile(built.file, damaged);
    const { dependencies } = testJournalSeams();
    const reader = await openJournalReadOnly(built.file, dependencies);
    const head = await reader.readRecordHead(JOURNAL_HEADER_BYTES);

    const failure = await collect(reader.readRecordBody(head)).then(
      () => undefined,
      (error: unknown) => error,
    );
    await reader.close();

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
      JOURNAL_HEADER_BYTES,
    );
  });
});

describe('refusing journals that are not current', () => {
  const tempDir = useTempDir('journal-refusal-open-');
  const wrongVersion = (): Uint8Array => {
    const bytes = encodeJournalHeader({
      fileId: new Uint8Array(16),
      syncMarker: new Uint8Array(8).fill(1),
      createdAtMs: 1,
    });
    bytes[8] = 2;
    return bytes;
  };
  const cases: ReadonlyArray<readonly [string, () => Uint8Array | string]> = [
    ['a JSONL file', () => '{"type":"session"}\n'],
    ['a file with another magic', () => new Uint8Array(100).fill(0x41)],
    ['an empty file', () => ''],
    ['a file of an older format version', wrongVersion],
  ];

  for (const [label, content] of cases) {
    it(`refuses ${label} with the one message, for the owner and for a reader, and changes nothing`, async () => {
      const file = path.join(tempDir(), 'old.jsonl');
      await fsp.writeFile(file, content());
      const before = await fsp.readFile(file);
      const { dependencies } = testJournalSeams();

      const owner = await openJournalForOwner(file, dependencies).then(
        () => undefined,
        (error: unknown) => error,
      );
      const reader = await openJournalReadOnly(file, dependencies).then(
        () => undefined,
        (error: unknown) => error,
      );

      for (const failure of [owner, reader]) {
        expect(failure).toBeInstanceOf(RetiredJournalError);
        expect(failure instanceof Error && failure.message).toBe(
          label === 'a file of an older format version'
            ? `Session file ${file} was written by an incompatible journal format version (found 2, supported ${JOURNAL_FORMAT_VERSION}) and cannot be resumed. Start a new session.`
            : retiredJournalMessage(file),
        );
      }
      expect(await fsp.readFile(file)).toStrictEqual(before);
    });
  }
});

describe('owner open', () => {
  const tempDir = useTempDir('journal-owner-');

  it('truncates an uncommitted tail to the last durable end and continues the sequence', async () => {
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'own.llxj'),
      testJournalSeams({ failFlushAt: 1 }),
      [standardGroup(1), standardGroup(2, { rowBodyBytes: 3000 })],
    );
    const seams = testJournalSeams();

    const { writer, recovery } = await openJournalForOwner(
      built.file,
      seams.dependencies,
    );

    expect(recovery.uncommittedBytes).toBe(
      built.bytes.length - built.acks[0].durableEnd,
    );
    expect(recovery.truncated).toBe(true);
    expect((await fsp.stat(built.file)).size).toBe(built.acks[0].durableEnd);
    expect(seams.events.filter((event) => event.type === 'open')).toStrictEqual(
      [{ type: 'open', flags: 'r+' }],
    );
    const ack = await writer.commitGroup(standardGroup(3));
    await writer.close();
    expect(ack.commitSeq).toBe(2);
    const reader = await openJournalReadOnly(built.file, seams.dependencies);
    expect(reader.trailer?.commitSeq).toBe(2);
    await reader.close();
  });

  it('truncates a tail behind a header with no trailer back to the header', async () => {
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'no-trailer.llxj'),
      testJournalSeams({ failFlushAt: 0 }),
      [standardGroup(1)],
    );

    const { writer, recovery } = await openJournalForOwner(
      built.file,
      testJournalSeams().dependencies,
    );
    await writer.close();

    expect(recovery.truncated).toBe(true);
    expect((await fsp.stat(built.file)).size).toBe(JOURNAL_HEADER_BYTES);
  });

  it('truncates nothing when there is no tail', async () => {
    const built = await buildJournal(path.join(tempDir(), 'clean.llxj'), [
      standardGroup(1),
    ]);
    const seams = testJournalSeams();

    const { writer, recovery } = await openJournalForOwner(
      built.file,
      seams.dependencies,
    );
    await writer.close();

    expect(recovery).toStrictEqual({ uncommittedBytes: 0, truncated: false });
    expect(
      seams.events.filter((event) => event.type === 'truncate'),
    ).toStrictEqual([]);
  });

  it('continues from the file size when the tail cannot be truncated, and readers still see the new group', async () => {
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'stuck.llxj'),
      testJournalSeams({ failFlushAt: 1 }),
      [standardGroup(1), standardGroup(2, { rowBodyBytes: 3000 })],
    );
    const seams = testJournalSeams({ failTruncate: true });

    const { writer, recovery } = await openJournalForOwner(
      built.file,
      seams.dependencies,
    );
    const ack = await writer.commitGroup(standardGroup(3));
    await writer.close();

    expect(recovery.truncated).toBe(false);
    expect(recovery.uncommittedBytes).toBeGreaterThan(0);
    expect(ack.durableEnd - TRAILER_RECORD_BYTES).toBeGreaterThanOrEqual(
      built.bytes.length,
    );
    const reader = await openJournalReadOnly(built.file, seams.dependencies);
    expect(reader.trailer?.commitSeq).toBe(2);
    expect(reader.trailer?.durableEnd).toBe(ack.durableEnd);
    await reader.close();
  });

  it('throws on a damaged root and truncates nothing, even with a tail behind the trailer', async () => {
    const built = await buildJournalKeepingTail(
      path.join(tempDir(), 'corrupt.llxj'),
      testJournalSeams({ failFlushAt: 1 }),
      [fourRootGroup(1), standardGroup(2, { rowBodyBytes: 3000 })],
    );
    const { dependencies: readDeps } = testJournalSeams();
    const intact = await openJournalReadOnly(built.file, readDeps);
    const rootOffset = intact.trailer?.metaRoot ?? 0;
    await intact.close();
    const damaged = withBitFlipped(built.bytes, rootOffset + 40, 5);
    await fsp.writeFile(built.file, damaged);
    const seams = testJournalSeams();

    const failure = await openJournalForOwner(
      built.file,
      seams.dependencies,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(JournalCorruptionError);
    expect(failure instanceof JournalCorruptionError && failure.what).toBe(
      'metaRoot',
    );
    expect(failure instanceof JournalCorruptionError && failure.offset).toBe(
      rootOffset,
    );
    expect(
      seams.events.filter((event) => event.type === 'truncate'),
    ).toStrictEqual([]);
    expect(await fsp.readFile(built.file)).toStrictEqual(Buffer.from(damaged));
  });
});
