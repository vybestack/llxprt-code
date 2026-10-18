/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { HISTORY_BACKEND_ENV } from '../services/history/historyBackendSelect.js';
import type { IContent } from '../services/history/IContent.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionLockManager } from './SessionLockManager.js';
import { createLockedSessionRecorder } from './sessionRecorderFactory.js';

const SESSION_ID = 'session-journal-integration';

function textRow(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function textOf(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

/** The service picks its store from the environment when it is constructed. */
const savedBackend = process.env[HISTORY_BACKEND_ENV];

describe('RecordingIntegration over a journal recorder', () => {
  const directory = useTempDir('recording-integration-journal-');
  let recorder: JournalRecordingService;
  let history: HistoryService;
  let integration: RecordingIntegration | undefined;
  let chatsDir: string;

  beforeEach(async () => {
    process.env[HISTORY_BACKEND_ENV] = 'journal';
    chatsDir = path.join(directory(), 'chats');
    const created = await createLockedSessionRecorder(
      {
        sessionId: SESSION_ID,
        projectHash: 'project',
        chatsDir,
        workspaceDirs: ['/work'],
        provider: 'anthropic',
        model: 'model-1',
      },
      process.env,
    );
    if (!(created instanceof JournalRecordingService)) {
      throw new Error('the factory did not build a journal recorder');
    }
    recorder = created;
    history = new HistoryService();
  });

  afterEach(async () => {
    if (savedBackend === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = savedBackend;
    await integration?.dispose().catch(() => undefined);
    await history.dispose().catch(() => undefined);
    await recorder.dispose().catch(() => undefined);
  });

  async function recorderRows(): Promise<string[]> {
    const rows: string[] = [];
    for await (const { content } of (await recorder.session()).rows()) {
      rows.push(textOf(content));
    }
    return rows;
  }

  function persistence(): SessionPersistenceService {
    return new SessionPersistenceService(
      { projectRoot: directory(), chatsDir },
      SESSION_ID,
      { maxQueueBytes: 1024 * 1024 },
    );
  }

  it('holds the rows in the recorder file once the turn boundary has flushed', async () => {
    integration = new RecordingIntegration(recorder);
    await integration.subscribeToJournal(history);

    history.add(textRow('human', 'question'));
    history.add(textRow('ai', 'answer'));
    await integration.flushAtTurnBoundary();

    expect(await recorderRows()).toStrictEqual(['question', 'answer']);
  });

  it('does not write the per-turn JSON snapshot for a journal recorder', async () => {
    const saving = persistence();
    integration = new RecordingIntegration(recorder, saving);
    await integration.subscribeToJournal(history);

    history.add(textRow('human', 'question'));
    await integration.flushAtTurnBoundary();

    const siblings = await fsp.readdir(chatsDir);
    expect(siblings.filter((name) => name.endsWith('.json'))).toStrictEqual([]);
    expect(await recorderRows()).toStrictEqual(['question']);
  });

  it('leaves no lock behind after detaching, then closing the recorder', async () => {
    integration = new RecordingIntegration(recorder);
    await integration.subscribeToJournal(history);
    history.add(textRow('human', 'question'));
    await integration.flushAtTurnBoundary();

    await integration.dispose();
    await history.dispose();
    await recorder.dispose();

    expect(recorder.getOwnedLockHandle()).toBeNull();
    const again = await SessionLockManager.acquire(chatsDir, SESSION_ID);
    expect(again).toBeDefined();
    await again.release();
  });
});
