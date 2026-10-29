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
import { createSessionRecorder } from './sessionRecorderFactory.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { SessionRecordingServiceConfig } from './types.js';
import { journalRows } from './__tests__/support/journal-read-test-helpers.js';

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

async function replayTexts(
  recording: SessionRecordingPort,
): Promise<{ readonly texts: string[]; readonly error?: string }> {
  await recording.flush();
  const file = recording.getFilePath();
  if (file === null) throw new Error('Expected a recorded journal');
  return { texts: texts(await journalRows(file)) };
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

  describe('RecordingIntegration.subscribeToJournal handover', () => {
    it('finishes detaching the previous history before the next one attaches', async () => {
      const recording = createSessionRecorder(makeConfig());
      const integration = new RecordingIntegration(recording);
      const events: string[] = [];

      class ObservedHistory extends HistoryService {
        constructor(private readonly name: string) {
          super({});
        }

        override async detachJournal(
          target: SessionRecordingPort,
        ): Promise<void> {
          events.push(`${this.name}:detach-start`);
          await super.detachJournal(target);
          events.push(`${this.name}:detach-end`);
        }

        override attachJournal(
          target: SessionRecordingPort,
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
