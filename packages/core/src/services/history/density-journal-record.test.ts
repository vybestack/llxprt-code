/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import {
  makeDensityResult,
  makeEntry,
  seedHistory,
} from './__tests__/density-history-test-fixtures.js';

let directory: string;
let recording: SessionRecordingService;
let history: HistoryService;

async function recordedTypes(): Promise<string[]> {
  await recording.flush();
  const path = history.journalPath();
  if (path === null) throw new Error('History has no journal');
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line).type);
}

describe('HistoryService.applyDensityResult journal record', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'density-journal-record-'));
    recording = new SessionRecordingService({
      sessionId: 'density-record',
      projectHash: 'project',
      chatsDir: directory,
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    });
    history = new HistoryService({ recording });
  });
  afterEach(async () => {
    history.dispose();
    await recording.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('writes exactly one density_mutation record and no replace transaction', async () => {
    seedHistory(history, 6);
    const before = (await recordedTypes()).length;

    await history.applyDensityResult(
      makeDensityResult([1], new Map([[3, makeEntry('human', 'dense')]])),
    );

    const written = (await recordedTypes()).slice(before);
    expect(written).toStrictEqual(['density_mutation']);
  });
});
