/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRowCounters } from '../../../../../core/src/recording/journalCounters.js';
import { rowIdentityKey } from '../../utils/rowIdentity.js';
import type { DisplayJournalEntry } from './journal-page-file.js';
import { ProjectedJournalCursor } from './projected-journal-cursor.js';

const LARGE = 1500;

function line(seq: number, type: string, payload: unknown): string {
  return JSON.stringify({ v: 1, seq, ts: '', type, payload }) + '\n';
}

function human(seq: number): string {
  return line(seq, 'content', {
    content: {
      speaker: 'human',
      blocks: [{ type: 'text', text: `user${seq}` }],
    },
  });
}

function keyOf(entry: DisplayJournalEntry): string {
  if (entry.kind !== 'projected' || !entry.item.rowIdentity)
    throw new Error('Expected a projected row');
  return rowIdentityKey(entry.item.rowIdentity);
}

async function withCursor(
  body: string,
  action: (
    cursor: ProjectedJournalCursor,
    file: string,
    decoded: () => number,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'projected-incremental-'));
  const file = join(directory, 'journal');
  await writeFile(file, body);
  const { counters, snapshot } = createRowCounters();
  const cursor = await ProjectedJournalCursor.open(file, {
    temporaryRoot: directory,
    counters,
  });
  try {
    await action(cursor, file, () => snapshot().recordsDecoded);
  } finally {
    await cursor.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function journal(rows: number): string {
  let body = '';
  for (let seq = 1; seq <= rows; seq += 1) body += human(seq);
  return body;
}

describe('incremental projected journal cursor', () => {
  it('extends the projection per append instead of rebuilding the journal', async () => {
    await withCursor(journal(LARGE), async (cursor, file, decoded) => {
      expect(decoded()).toBe(LARGE);
      const writesAfterOpen = cursor.metrics().pageWrites;
      const appends = 40;
      for (let index = 1; index <= appends; index += 1) {
        await appendFile(file, human(LARGE + index));
        const { entries } = await cursor.pageForward(10);
        // The re-projected tail row comes back with the new one.
        expect(entries.length).toBeLessThanOrEqual(2);
        expect(JSON.stringify(entries.at(-1))).toContain(
          `user${LARGE + index}`,
        );
      }
      // Each refresh decodes only the new record, never the prior journal.
      expect(decoded()).toBeLessThanOrEqual(LARGE + 2 * appends);
      expect(cursor.metrics().pageWrites - writesAfterOpen).toBeLessThanOrEqual(
        2 * appends,
      );
    });
  });

  it('carries the tail tool group across an append without duplicating it', async () => {
    const opener = line(2, 'content', {
      content: {
        speaker: 'ai',
        blocks: [
          { type: 'tool_call', id: 'c', name: 'read_file', parameters: {} },
        ],
      },
    });
    const response = line(3, 'content', {
      content: {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c',
            toolName: 'read_file',
            result: 'carried-result',
          },
        ],
      },
    });
    await withCursor(journal(LARGE) + opener, async (cursor, file, decoded) => {
      await cursor.pageBack(LARGE + 1);
      const before = decoded();
      await appendFile(file, response + human(LARGE + 2));
      const { entries } = await cursor.pageForward(10);
      const groups = entries.filter(
        (entry) =>
          entry.kind === 'projected' && entry.item.type === 'tool_group',
      );
      expect(groups).toHaveLength(1);
      expect(JSON.stringify(groups[0])).toContain('carried-result');
      expect(decoded() - before).toBeLessThanOrEqual(4);
    });
  });

  it('bounds per-refresh decodes while results accrete on one opener', async () => {
    const calls = 40;
    const ids = Array.from({ length: calls }, (_, index) => `call-${index}`);
    const opener = line(1, 'content', {
      content: {
        speaker: 'ai',
        blocks: ids.map((id) => ({
          type: 'tool_call',
          id,
          name: 'read_file',
          parameters: {},
        })),
      },
    });
    const result = (seq: number, id: string): string =>
      line(seq, 'content', {
        content: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: id,
              toolName: 'read_file',
              result: `result-of-${id}`,
            },
          ],
        },
      });
    await withCursor(opener, async (cursor, file, decoded) => {
      await cursor.pageBack(10);
      const perRefresh: number[] = [];
      let served: DisplayJournalEntry[] = [];
      for (const [index, id] of ids.entries()) {
        const before = decoded();
        await appendFile(file, result(index + 2, id));
        ({ entries: served } = await cursor.pageForward(10));
        perRefresh.push(decoded() - before);
      }
      // Each refresh decodes the new record, never the group's earlier results.
      expect(Math.max(...perRefresh)).toBeLessThanOrEqual(2);
      const text = JSON.stringify(served);
      for (const id of ids) expect(text).toContain(`result-of-${id}`);
    });
  });

  it('keeps eviction free of page-file reads on a large journal', async () => {
    await withCursor(journal(LARGE), async (cursor) => {
      const { entries } = await cursor.pageBack(LARGE);
      expect(entries).toHaveLength(LARGE);
      const readsBefore = cursor.metrics().pageReads;
      cursor.retainWindow(keyOf(entries[9]), keyOf(entries[0]), 'older');
      expect(cursor.metrics().pageReads).toBe(readsBefore);
      expect(cursor.atStart()).toBe(false);
      const window = await cursor.pageBack(5);
      expect(window.entries.map(keyOf)).toStrictEqual(
        entries.slice(10, 15).map(keyOf),
      );
    });
  });
});
