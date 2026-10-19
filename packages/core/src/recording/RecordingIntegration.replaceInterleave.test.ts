/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * #854: a replace transaction is only readable when nothing but its own rows
 * and its commit follow its begin. These tests write interleaved records
 * through the real recorder and the real attach path, then re-read the file.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { replaySession } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import type {
  CommitWatermark,
  SessionEventType,
  SessionRecordingServiceConfig,
} from './types.js';

const PROJECT_HASH = 'project-hash-replace-interleave';

let tempDir: string;
let chatsDir: string;

function makeConfig(): SessionRecordingServiceConfig {
  return {
    sessionId: 'replace-interleave-session-0001',
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/workspace/project'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function text(value: string, speaker: IContent['speaker'] = 'human'): IContent {
  return { speaker, blocks: [{ type: 'text', text: value }] };
}

function texts(history: readonly IContent[]): string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'text' ? block.text : [],
    ),
  );
}

async function replayTexts(recording: SessionRecordingService): Promise<{
  readonly ok: boolean;
  readonly error?: string;
  readonly texts: string[];
}> {
  await recording.flush();
  const file = recording.getFilePath();
  expect(file).not.toBeNull();
  const result = await replaySession(file ?? '', PROJECT_HASH);
  if (!result.ok) return { ok: false, error: result.error, texts: [] };
  return { ok: true, texts: texts(result.history) };
}

/** Appends a foreign record the first time a tagged replacement row is committed. */
class InterleavingRecording extends SessionRecordingService {
  interleave: (() => void) | undefined;

  override commit(
    type: SessionEventType,
    payload: unknown,
  ): Promise<CommitWatermark> {
    const tagged =
      type === 'content' &&
      typeof payload === 'object' &&
      payload !== null &&
      'tx' in payload;
    if (tagged && this.interleave !== undefined) {
      const run = this.interleave;
      this.interleave = undefined;
      run();
    }
    return super.commit(type, payload);
  }
}

describe('replace transaction interleaving', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'replace-interleave-'));
    chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('recorder replace transaction writers', () => {
    it('refuses a replacement row after another history record abandoned its transaction', async () => {
      const recording = new SessionRecordingService(makeConfig());
      try {
        await recording.commit('content', { content: text('old') });
        await recording.commit('replace_begin', { txId: 'tx-1' });
        await recording.commit('content', {
          content: text('new-0'),
          tx: 'tx-1',
        });
        recording.recordContent(text('interleaved'));

        await expect(
          recording.commit('content', { content: text('new-1'), tx: 'tx-1' }),
        ).rejects.toThrow('tx-1');
        await expect(
          recording.commit('replace_commit', { txId: 'tx-1', rowCount: 1 }),
        ).rejects.toThrow('tx-1');

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['old', 'interleaved']);
      } finally {
        await recording.dispose();
      }
    });

    it('refuses a second begin while a transaction is open', async () => {
      const recording = new SessionRecordingService(makeConfig());
      try {
        await recording.commit('content', { content: text('old') });
        await recording.commit('replace_begin', { txId: 'tx-1' });
        await recording.commit('content', {
          content: text('new-0'),
          tx: 'tx-1',
        });

        await expect(
          recording.commit('replace_begin', { txId: 'tx-2' }),
        ).rejects.toThrow('tx-1');
        await recording.commit('replace_commit', { txId: 'tx-1', rowCount: 1 });

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['new-0']);
      } finally {
        await recording.dispose();
      }
    });

    it('refuses a commit that names a transaction other than the open one', async () => {
      const recording = new SessionRecordingService(makeConfig());
      try {
        await recording.commit('content', { content: text('old') });
        await recording.commit('replace_begin', { txId: 'tx-1' });
        await recording.commit('content', {
          content: text('new-0'),
          tx: 'tx-1',
        });

        await expect(
          recording.commit('replace_commit', { txId: 'tx-2', rowCount: 1 }),
        ).rejects.toThrow('tx-2');
        await recording.commit('replace_commit', { txId: 'tx-1', rowCount: 1 });

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['new-0']);
      } finally {
        await recording.dispose();
      }
    });

    it('refuses a commit without a begin', async () => {
      const recording = new SessionRecordingService(makeConfig());
      try {
        await recording.commit('content', { content: text('old') });
        await expect(
          recording.commit('replace_commit', { txId: 'tx-9', rowCount: 0 }),
        ).rejects.toThrow('tx-9');

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['old']);
      } finally {
        await recording.dispose();
      }
    });

    it('refuses a replacement row for a transaction that was never begun', async () => {
      const recording = new SessionRecordingService(makeConfig());
      try {
        await recording.commit('content', { content: text('old') });
        await expect(
          recording.commit('content', { content: text('stray'), tx: 'tx-9' }),
        ).rejects.toThrow('tx-9');

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['old']);
      } finally {
        await recording.dispose();
      }
    });

    it('keeps the file readable when a foreign write lands inside a history attachment', async () => {
      const recording = new InterleavingRecording(makeConfig());
      const integration = new RecordingIntegration(recording);
      const first = new HistoryService({ backend: 'old' });
      const second = new HistoryService({ backend: 'old' });
      try {
        await integration.subscribeToJournal(first);
        first.add(text('first-user'));
        first.add(text('first-ai', 'ai'));
        await integration.flushAtTurnBoundary();

        second.add(text('second-user'));
        second.add(text('second-ai', 'ai'));
        recording.interleave = () => recording.recordContent(text('foreign'));

        await expect(integration.subscribeToJournal(second)).rejects.toThrow(
          'Replace transaction conflict',
        );

        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
      } finally {
        await integration.dispose().catch(() => undefined);
        await recording.dispose();
        await first.dispose();
        await second.dispose();
      }
    });
  });

  describe('RecordingIntegration.subscribeToJournal handover', () => {
    it('finishes detaching the previous history before the next one attaches', async () => {
      const recording = new SessionRecordingService(makeConfig());
      const integration = new RecordingIntegration(recording);
      const events: string[] = [];

      class ObservedHistory extends HistoryService {
        constructor(private readonly name: string) {
          super({ backend: 'old' });
        }

        override async detachJournal(
          target: SessionRecordingService,
        ): Promise<void> {
          events.push(`${this.name}:detach-start`);
          await super.detachJournal(target);
          events.push(`${this.name}:detach-end`);
        }

        override attachJournal(
          target: SessionRecordingService,
          replace?: boolean,
          onAttached?: () => void,
          origin?: object,
        ): Promise<void> {
          events.push(`${this.name}:attach-start`);
          return super.attachJournal(target, replace, onAttached, origin);
        }
      }

      const first = new ObservedHistory('first');
      const second = new ObservedHistory('second');
      try {
        await integration.subscribeToJournal(first);
        first.add(text('first-user'));
        await integration.flushAtTurnBoundary();
        second.add(text('second-user'));

        await integration.subscribeToJournal(second);

        expect(events.indexOf('first:detach-end')).toBeGreaterThanOrEqual(0);
        expect(events.indexOf('first:detach-end')).toBeLessThan(
          events.lastIndexOf('second:attach-start'),
        );
        const replayed = await replayTexts(recording);
        expect(replayed.error).toBeUndefined();
        expect(replayed.texts).toStrictEqual(['second-user']);
      } finally {
        await integration.dispose().catch(() => undefined);
        await recording.dispose();
        await first.dispose();
        await second.dispose();
      }
    });
  });
});
