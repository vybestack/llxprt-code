/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { beforeAll, describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { MIB } from '../../journal/__tests__/support/streamedBody.js';
import { JournalSession } from './journalSession.js';
import type { IContent } from './IContent.js';

/** Settled heap may rise this far above its start once the row has been written or read and dropped. */
const RETAINED_BOUND = 4 * MIB;
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

const SIZES = [17, 40, 200] as const;

describe('rows of 17, 40 and 200 MiB through the journal session (defect 5)', () => {
  const directory = useTempDir('journal-large-session-');

  beforeAll(async () => {
    const warmDirectory = await fsp.mkdtemp(
      path.join(tmpdir(), 'session-warm-'),
    );
    try {
      const file = path.join(warmDirectory, 'warm.llxj');
      const session = await JournalSession.create(file);
      await appendRow(session, 1024);
      await session.close();
      const reopened = await JournalSession.open(file);
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
      const baseline = await settledHeap();
      const session = await JournalSession.create(file);

      const written = await appendRow(session, bytes);
      const afterWrite = await settledHeap();
      await session.close();
      const fileBytes = (await fsp.stat(file)).size;

      const reopened = await JournalSession.open(file);
      const read = await readDigest(reopened);
      const afterRead = await settledHeap();
      await reopened.close();

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
    );
    const bytes = 40 * MIB;
    const baseline = await settledHeap();

    const kept: IContent[] = [];
    const text = rowText(bytes);
    kept.push({ speaker: 'human', blocks: [{ type: 'text', text }] });
    await session.append(kept);
    const withRow = await settledHeap();
    await session.close();

    expect(kept).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(bytes * CONTROL_FLOOR_FRACTION);
  });

  it('control: a reader that keeps the row it read shows the row in the same measurement', async () => {
    const file = path.join(directory(), 'control.llxj');
    const bytes = 40 * MIB;
    const session = await JournalSession.create(file);
    await appendRow(session, bytes);
    await session.close();
    const baseline = await settledHeap();

    const reopened = await JournalSession.open(file);
    const kept: IContent[] = [];
    for await (const { content } of reopened.rows()) kept.push(content);
    const withRow = await settledHeap();
    await reopened.close();

    expect(kept).toHaveLength(1);
    expect(withRow - baseline).toBeGreaterThan(bytes * CONTROL_FLOOR_FRACTION);
  });
});
