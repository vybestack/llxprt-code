/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { appendHistoryJournal } from './attachHistoryJournal.js';
import type { IContent } from './IContent.js';

const FRONTIER = { contentIndex: 0, blockIndex: 0 } as const;

function row(text: string, metadata?: IContent['metadata']): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function bulkText(index: number): string {
  return `${index}:${'x'.repeat(200)}`;
}

let directory: string;
let recorders: SessionRecordingService[];

function recorder(id: string): SessionRecordingService {
  const created = new SessionRecordingService({
    sessionId: id,
    projectHash: 'attachment-purge-parse',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  recorders.push(created);
  return created;
}

/** A journal whose last record is a semantic purge restating all `count` rows. */
async function purgedJournal(count: number): Promise<string> {
  const source = recorder(`source-${count}`);
  for (let index = 0; index < count; index++)
    source.recordContent(row(bulkText(index)));
  source.recordSemanticMediaPurge(
    Array.from({ length: count }, (_, index) =>
      row(
        bulkText(index),
        index === 0 ? { semanticMediaPurgeFrontier: FRONTIER } : undefined,
      ),
    ),
    FRONTIER,
  );
  await source.flush();
  const filePath = source.getFilePath();
  if (filePath === null) throw new Error('Missing source journal');
  return filePath;
}

/** Characters handed to JSON.parse while attaching `count` purged rows. */
async function charactersParsedByAttach(count: number): Promise<number> {
  const filePath = await purgedJournal(count);
  const destination = recorder(`destination-${count}`);
  const nativeParse = JSON.parse;
  let characters = 0;
  const spy = spyOn(JSON, 'parse').mockImplementation(((
    ...args: Parameters<typeof JSON.parse>
  ) => {
    characters += String(args[0]).length;
    return nativeParse(...args);
  }) as typeof JSON.parse);
  try {
    const attached = await appendHistoryJournal(
      { filePath, byteOffset: (await stat(filePath)).size },
      destination,
      false,
      () => false,
    );
    expect(attached.committedRows).toBe(count);
  } finally {
    spy.mockRestore();
  }
  return characters;
}

describe('attaching a journal whose history was semantically purged', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'history-attachment-purge-'));
    recorders = [];
  });
  afterEach(async () => {
    await Promise.all(recorders.map((recording) => recording.dispose()));
    await rm(directory, { recursive: true, force: true });
  });

  it('parses a number of characters linear in the rows, not once per row over the purge record', async () => {
    const small = await charactersParsedByAttach(300);
    const large = await charactersParsedByAttach(1200);
    expect(small).toBeGreaterThan(300 * 200);
    // Four times the rows parse about four times the characters. Reading the
    // purge record once per row would make the ratio about sixteen.
    expect(large / small).toBeGreaterThan(3);
    expect(large / small).toBeLessThan(5.5);
  }, 120_000);
});
