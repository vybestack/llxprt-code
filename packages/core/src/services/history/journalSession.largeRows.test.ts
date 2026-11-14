import { testJournalOptions } from '../../journal/__tests__/support/namedWriterOwner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, it } from 'bun:test';
import { freshFrameHeap } from '../../journal/__tests__/support/fresh-frame-heap.js';
import { recordMemoryGate } from '../../journal/__tests__/support/memory-gate-evidence.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { MIB } from '../../journal/__tests__/support/streamedBody.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';

/** Largest settled lifecycle overhead in the 256-byte / 1 MiB calibration, 2026-11-13. */
const FIXED_OVERHEAD_BYTES = 292_798;
/** After conversion only the 64-character SHA-256 digest may survive. */
const RETAINED_BOUND = FIXED_OVERHEAD_BYTES + 2 * 64;
/** A row this big read into the control must show in the same measurement. */
const CONTROL_FLOOR_FRACTION = 0.5;

const PIECE_BYTES = MIB;

/** 1 MiB of ASCII that differs per piece, so a row of any size is not one repeated string. */
function piece(index: number): string {
  return (
    `${index.toString(36).padStart(6, '0')}`.repeat(PIECE_BYTES / 6) +
    'x'.repeat(PIECE_BYTES % 6)
  );
}

function rowText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += PIECE_BYTES, index++) {
    pieces.push(piece(index).slice(0, Math.min(PIECE_BYTES, bytes - at)));
  }
  return pieces.join('');
}

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Builds the row inside this frame so that nothing of it outlives the call but the digest. */
async function appendRow(
  session: JournalSession,
  bytes: number,
): Promise<string> {
  const text = rowText(bytes);
  const content: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
  };
  await session.append([content]);
  return digestOf(text);
}

async function readDigest(session: JournalSession): Promise<{
  digest: string;
  length: number;
}> {
  let found: { digest: string; length: number } | undefined;
  for await (const { content } of session.rows()) {
    const block = content.blocks[0];
    if (block.type !== 'text') throw new Error('expected a text block');
    found = { digest: digestOf(block.text), length: block.text.length };
  }
  if (found === undefined) throw new Error('the journal holds no row');
  return found;
}

const SIZES = [256 / MIB, 1, 2.5];

describe('rows of 1 and 2.5 MiB through the journal session (defect 5)', () => {
  const directory = useTempDir('journal-large-session-');

  beforeAll(async () => {
    const warmDirectory = await fsp.mkdtemp(
      path.join(tmpdir(), 'session-warm-'),
    );
    try {
      const file = path.join(warmDirectory, 'warm.llxj');
      const session = await JournalSession.create(file, testJournalOptions());
      await appendRow(session, 1024);
      await session.close();
      const reopened = await JournalSession.open(file, testJournalOptions());
      await readDigest(reopened);
      await reopened.close();
    } finally {
      await fsp.rm(warmDirectory, { recursive: true, force: true });
    }
  });

  for (const mebibytes of SIZES) {
    it(`writes, reopens and reads a ${mebibytes} MiB row, and holds none of it afterwards`, async () => {
      const file = path.join(directory(), `row-${mebibytes}.llxj`);
      const bytes = mebibytes * MIB;
      const baseline = await freshFrameHeap();
      const session = await JournalSession.create(file, testJournalOptions());

      const written = await appendRow(session, bytes);
      const afterWrite = await freshFrameHeap();
      await session.close();
      const fileBytes = (await fsp.stat(file)).size;

      const reopened = await JournalSession.open(file, testJournalOptions());
      const read = await readDigest(reopened);
      const afterRead = await freshFrameHeap();
      await reopened.close();

      recordMemoryGate('session', {
        bytes,
        write: afterWrite - baseline,
        read: afterRead - baseline,
      });
      expect(fileBytes).toBeGreaterThan(bytes);
      expect(read.length).toBe(bytes);
      expect(read.digest).toBe(written);
      expect(afterWrite - baseline).toBeLessThan(RETAINED_BOUND);
      expect(afterRead - baseline).toBeLessThan(RETAINED_BOUND);
    });
  }

  it('control: a writer side that keeps the row it was given shows the row in the same measurement', async () => {
    const session = await JournalSession.create(
      path.join(directory(), 'control-write.llxj'),
      testJournalOptions(),
    );
    const bytes = 2.5 * MIB;
    const baseline = await freshFrameHeap();

    const kept: IContent[] = [];
    const text = rowText(bytes);
    kept.push({ speaker: 'human', blocks: [{ type: 'text', text }] });
    await session.append(kept);
    const withRow = await freshFrameHeap();
    await session.close();

    expect(kept).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(bytes * CONTROL_FLOOR_FRACTION);
    recordMemoryGate('session-control', {
      bytes,
      retained: withRow - baseline,
    });
    expect(withRow - baseline).toBeGreaterThan(3 * RETAINED_BOUND);
    expect(withRow - baseline).toBeGreaterThan(2 * MIB);
  });

  it('control: a reader that keeps the row it read shows the row in the same measurement', async () => {
    const file = path.join(directory(), 'control.llxj');
    const bytes = 2.5 * MIB;
    const session = await JournalSession.create(file, testJournalOptions());
    await appendRow(session, bytes);
    await session.close();
    const baseline = await freshFrameHeap();

    const reopened = await JournalSession.open(file, testJournalOptions());
    const kept: IContent[] = [];
    for await (const { content } of reopened.rows()) kept.push(content);
    const withRow = await freshFrameHeap();
    await reopened.close();

    expect(kept).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(bytes * CONTROL_FLOOR_FRACTION);
    recordMemoryGate('session-control', {
      bytes,
      retained: withRow - baseline,
    });
    expect(withRow - baseline).toBeGreaterThan(3 * RETAINED_BOUND);
    expect(withRow - baseline).toBeGreaterThan(2 * MIB);
  });
});
