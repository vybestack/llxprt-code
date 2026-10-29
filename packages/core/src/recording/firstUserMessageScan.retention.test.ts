/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { MIB } from '../journal/__tests__/support/streamedBody.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { HistoryService } from '../services/history/HistoryService.js';

const TITLE_LENGTH = 120;
const RETAINED_BOUND = 4 * MIB;

async function recordLargeMessage(dir: string): Promise<string> {
  const recording = JournalRecordingService.create({
    sessionId: 'large-first-message',
    projectHash: 'retention',
    chatsDir: dir,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const history = new HistoryService({ recording });
  try {
    await history.addBatch([
      { speaker: 'human', blocks: [{ type: 'text', text: bigText(12 * MIB) }] },
    ]);
    await history.waitForCommit();
    await recording.flush();
    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('Missing fixture journal');
    return filePath;
  } finally {
    await history.dispose();
    await recording.dispose();
  }
}

/** Distinct pieces, so the text is a real allocation. */
function bigText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += MIB, index++) {
    pieces.push(
      index
        .toString(36)
        .padStart(6, '0')
        .repeat(MIB / 6),
    );
  }
  return pieces.join('').slice(0, bytes);
}

describe('first user message title scan retention', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'first-user-retention-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps none of the first message alive through the title it returns', async () => {
    const filePath = await recordLargeMessage(dir);
    expect((await fs.stat(filePath)).size).toBeGreaterThan(12 * MIB);

    const baseline = await settledHeap();
    const title = await SessionDiscovery.readFirstUserMessage(
      filePath,
      TITLE_LENGTH,
    );
    const afterScan = await settledHeap();

    expect(title).toHaveLength(TITLE_LENGTH);
    expect(afterScan - baseline).toBeLessThan(RETAINED_BOUND);
  });
});
