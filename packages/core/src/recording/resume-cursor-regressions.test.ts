/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { beforeEach, afterEach, expect, it, describe } from 'bun:test';
import { mkdtemp, rm, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { resumeSession, type ResumeResult } from './resumeSession.js';
import { ResumeCursorBoot } from './resumeCursorBoot.js';
import { JournalResolver } from './journalResolver.js';
import { replaySession } from './ReplayEngine.js';
import { scanResumeMetadata } from './resumeMetadata.js';
import { createRowCounters } from './journalCounters.js';
import type { IContent } from '../services/history/IContent.js';

let root: string;

let writer: SessionRecordingService;

let result: ResumeResult | undefined;

async function boot(): Promise<ResumeResult> {
  const resumed = await resumeSession({
    continueRef: writer.getSessionId(),
    projectHash: 'project',
    chatsDir: root,
    currentProvider: 'test',
    currentModel: 'model',
    workspaceDirs: [],
  });
  if (!resumed.ok) throw new Error(resumed.error);
  result = resumed;
  return resumed;
}

async function rows(source: AsyncIterable<IContent>): Promise<IContent[]> {
  const collected: IContent[] = [];
  for await (const row of source) collected.push(row);
  return collected;
}

describe('resume cursor regressions', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'resume-regression-'));
    writer = new SessionRecordingService({
      sessionId: crypto.randomUUID(),
      projectHash: 'project',
      chatsDir: root,
      provider: 'test',
      model: 'model',
      workspaceDirs: [],
    });
    writer.recordContent({
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'retained' }],
      metadata: { responsesStored: true },
    });
    await writer.flush();
  });
  afterEach(async () => {
    await result?.recording.dispose();
    await writer.dispose();
    await rm(root, { recursive: true, force: true });
  });
  it(
    'strips response markers only from resume rows and freezes the selected prefix',
    verifyStripsResponseMarkersOnlyFromResumeRowsAndFreezesTheSelectedPrefix,
  );
  it(
    'closes the cursor when consumption is cancelled and recording is disposed',
    verifyClosesTheCursorWhenConsumptionIsCancelledAndRecordingIsDisposed,
  );
  it(
    'does not read appended metadata beyond the supplied byte limit',
    verifyDoesNotReadAppendedMetadataBeyondTheSuppliedByteLimit,
  );
  it(
    'preserves metadata and malformed metadata warnings without decoding rows',
    verifyPreservesMetadataAndMalformedMetadataWarningsWithoutDecodingRows,
  );
  it(
    'rejects an out-of-file byte watermark',
    verifyRejectsAnOutOfFileByteWatermark,
  );

  it(
    'rejects malformed media during row consumption and closes the boot',
    verifyRejectsMalformedMediaDuringRowConsumptionAndClosesTheBoot,
  );
});

async function verifyStripsResponseMarkersOnlyFromResumeRowsAndFreezesTheSelectedPrefix(): Promise<void> {
  const resumed = await boot();
  resumed.recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'later' }],
  });
  await resumed.recording.flush();
  const restored = await rows(resumed.boot.streamRows());
  expect(restored).toHaveLength(1);
  expect(restored[0].metadata?.responsesStored).toBeUndefined();
  const resolver = await JournalResolver.open(resumed.boot.filePath);
  try {
    for await (const entry of resolver.resolve()) {
      expect(entry.content.metadata?.responsesStored).toBe(true);
      break;
    }
  } finally {
    await resolver.close();
  }
  expect((await replaySession(resumed.boot.filePath, 'project')).ok).toBe(true);
}

async function verifyClosesTheCursorWhenConsumptionIsCancelledAndRecordingIsDisposed(): Promise<void> {
  const resumed = await boot();
  for await (const row of resumed.boot.streamRows()) {
    expect(row.blocks[0]).toStrictEqual({ type: 'text', text: 'retained' });
    break;
  }
  await expect(resumed.boot.cursor.pageBack(1)).rejects.toThrow('closed');
  await resumed.recording.dispose();
}

async function verifyDoesNotReadAppendedMetadataBeyondTheSuppliedByteLimit(): Promise<void> {
  const file = writer.getFilePath();
  if (!file) throw new Error('missing journal');
  const bytes = await readFile(file);
  await appendFile(
    file,
    JSON.stringify({
      v: 99,
      seq: 3,
      type: 'session_metadata',
      payload: { title: 'outside' },
    }) + '\n',
  );
  const kit = createRowCounters();
  const scan = await scanResumeMetadata(
    file,
    'project',
    bytes.length,
    kit.counters,
  );
  expect(scan.replay.ok).toBe(true);
  expect(scan.watermark).toBe(bytes.length);
  expect(kit.snapshot().recordsDecoded).toBe(2);
  expect(kit.snapshot().rowsDecoded).toBe(0);
}

async function verifyPreservesMetadataAndMalformedMetadataWarningsWithoutDecodingRows(): Promise<void> {
  writer.recordProviderSwitch('other', 'new-model');
  writer.recordDirectoriesChanged(['/changed']);
  await writer.flush();
  const file = writer.getFilePath();
  if (!file) throw new Error('missing journal');
  await appendFile(
    file,
    JSON.stringify({
      v: 1,
      seq: 5,
      type: 'session_metadata',
      payload: { title: 42 },
    }) + '\n',
  );
  const oracle = await replaySession(file, 'project');
  const kit = createRowCounters();
  const scan = await scanResumeMetadata(
    file,
    'project',
    (await readFile(file)).length,
    kit.counters,
  );
  if (!oracle.ok || !scan.replay.ok) throw new Error('metadata scan failed');
  expect(scan.replay.metadata).toStrictEqual(oracle.metadata);
  expect(scan.replay.warnings).toStrictEqual(oracle.warnings);
  expect(kit.snapshot().rowsDecoded).toBe(0);
}

async function verifyRejectsAnOutOfFileByteWatermark(): Promise<void> {
  const file = writer.getFilePath();
  if (!file) throw new Error('missing journal');
  await expect(
    ResumeCursorBoot.open(file, 2, (await readFile(file)).length + 1),
  ).rejects.toThrow('watermark');
}

async function verifyRejectsMalformedMediaDuringRowConsumptionAndClosesTheBoot(): Promise<void> {
  const file = writer.getFilePath();
  if (!file) throw new Error('missing journal');
  await appendFile(
    file,
    JSON.stringify({
      v: 1,
      seq: 3,
      type: 'content',
      payload: {
        content: {
          speaker: 'human',
          blocks: [
            { type: 'media', encoding: 'reference', contentId: 'missing' },
          ],
        },
      },
    }) + '\n',
  );
  const resumed = await boot();
  await expect(rows(resumed.boot.streamRows())).rejects.toThrow(
    'Media reference validation failed',
  );
  await expect(resumed.boot.cursor.pageBack(1)).rejects.toThrow('closed');
}
