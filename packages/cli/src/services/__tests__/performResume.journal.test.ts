/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RecordingIntegration,
  SessionLockManager,
  createLockedSessionRecorder,
  type IContent,
  type LockHandle,
  type SessionMetadata,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import {
  performResume,
  type RecordingSwapCallbacks,
  type ResumeContext,
} from '../performResume.js';
import { pinHistoryBackend } from './support/pinHistoryBackend.js';

const PROJECT = 'journal-project';
pinHistoryBackend('journal');

function row(text: string, speaker: IContent['speaker'] = 'human'): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

async function texts(rows: AsyncIterable<IContent>): Promise<string[]> {
  const out: string[] = [];
  for await (const item of rows) {
    const block = item.blocks[0];
    if (block.type === 'text') out.push(block.text);
  }
  return out;
}

interface Live {
  recording: SessionRecordingPort | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

describe('performResume on the journal backend with the live recorder bound', () => {
  let chatsDir: string;
  let history: HistoryService;
  let live: Live;
  let liveRecording: SessionRecordingPort;
  let sessionIds: string[];

  beforeEach(async () => {
    chatsDir = await mkdtemp(join(tmpdir(), 'perform-resume-journal-'));
    const source = JournalRecordingService.create({
      sessionId: 'source',
      projectHash: PROJECT,
      chatsDir,
      workspaceDirs: [],
      // Differs from the live model so the resume records a provider switch.
      provider: 'anthropic',
      model: 'claude-3',
    });
    await (
      await source.session()
    ).append([row('one'), row('two', 'ai'), row('three')]);
    await source.dispose();

    liveRecording = await createLockedSessionRecorder({
      sessionId: 'live',
      projectHash: PROJECT,
      chatsDir,
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'claude-4',
    });
    history = new HistoryService({ backend: 'journal' });
    const integration = new RecordingIntegration(liveRecording);
    await integration.subscribeToJournal(history);
    history.add(row('live-row'));
    await history.waitForCommit();
    live = {
      recording: liveRecording,
      integration,
      lock: liveRecording.getOwnedLockHandle(),
      metadata: null,
    };
    sessionIds = [];
  });

  afterEach(async () => {
    await history.dispose();
    await live.integration?.dispose();
    await live.recording?.dispose();
    await rm(chatsDir, { recursive: true, force: true });
  });

  function context(adoptSessionId?: (id: string) => void): ResumeContext {
    const callbacks: RecordingSwapCallbacks = {
      getCurrentRecording: () => live.recording,
      getCurrentIntegration: () => live.integration,
      getCurrentLockHandle: () => live.lock,
      getCurrentMetadata: () => live.metadata,
      setRecording: (recording, integration, lock, metadata) => {
        live = { recording, integration, lock, metadata };
      },
    };
    return {
      chatsDir,
      projectHash: PROJECT,
      currentSessionId: 'live',
      currentProvider: 'anthropic',
      currentModel: 'claude-4',
      workspaceDirs: [],
      recordingCallbacks: callbacks,
      historyService: history,
      adoptSessionId:
        adoptSessionId ??
        ((id) => {
          sessionIds.push(id);
        }),
    };
  }

  it('swaps to the resumed session, retires the live recording and keeps the resumed rows', async () => {
    const result = await performResume('source', context());
    if (!result.ok) throw new Error(result.error);

    expect(await texts(result.history)).toStrictEqual(['one', 'two', 'three']);
    expect(result.metadata.sessionId).toBe('source');
    expect(sessionIds).toStrictEqual(['source']);
    expect(live.recording?.getSessionId()).toBe('source');
    expect(liveRecording.isActive()).toBe(false);
    expect(await SessionLockManager.isLocked(chatsDir, 'live')).toBe(false);
    expect(await SessionLockManager.isLocked(chatsDir, 'source')).toBe(true);
    expect(history.journalPath()).toBe(live.recording?.getFilePath() ?? null);
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(
        rows.map((item) => (item.blocks[0] as { text: string }).text),
      ).toStrictEqual(['one', 'two', 'three']);
    });
  });

  it('keeps recording to the resumed file after the swap', async () => {
    const result = await performResume('source', context());
    if (!result.ok) throw new Error(result.error);
    history.add(row('after'));
    await history.waitForCommit();
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows).toHaveLength(4);
    });
    expect(live.integration).not.toBeNull();
  });

  it('releases the resumed lock and keeps the live session when publication fails', async () => {
    const result = await performResume(
      'source',
      context(() => {
        throw new Error('adopt failed');
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('adopt failed');
    expect(await SessionLockManager.isLocked(chatsDir, 'source')).toBe(false);
    expect(live.recording).toBe(liveRecording);
    expect(liveRecording.isActive()).toBe(true);
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(rows).toHaveLength(1);
    });
  });
});
