/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';

import {
  buildFakeAgent,
  buildMinimalConfig,
  createSession,
  RecordingConnection,
} from './__tests__/zed-test-helpers.js';
import type { Session } from './zedIntegration.js';

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function requireRecordingPath(recording: SessionRecordingService): string {
  const filePath = recording.getFilePath();
  if (filePath === null) throw new Error('Recording was not materialized');
  return filePath;
}

function buildRecordingAgent(recording: SessionRecordingService): Agent {
  const { agent } = buildFakeAgent([{ type: 'done', reason: 'stop' }]);
  Object.defineProperties(agent, {
    session: {
      value: {
        getActiveRecording: () => recording,
      },
    },
    dispose: {
      value: async (): Promise<void> => recording.dispose(),
    },
  });
  return agent;
}

describe('Zed session recording ownership', () => {
  it('keeps title metadata and transcript writes on each same-label Agent recording', async () => {
    const root = mkdtempSync(join(tmpdir(), 'llxprt-zed-recording-'));
    const sessions: Session[] = [];
    const recordings = [
      new SessionRecordingService({
        sessionId: 'shared-label',
        projectHash: 'project-a',
        chatsDir: join(root, 'a'),
        workspaceDirs: [root],
        provider: 'fake',
        model: 'fake-model',
      }),
      new SessionRecordingService({
        sessionId: 'shared-label',
        projectHash: 'project-b',
        chatsDir: join(root, 'b'),
        workspaceDirs: [root],
        provider: 'fake',
        model: 'fake-model',
      }),
    ];

    try {
      recordings[0].recordContent(humanText('transcript-a'));
      recordings[1].recordContent(humanText('transcript-b'));
      await Promise.all(recordings.map((recording) => recording.flush()));

      const config = buildMinimalConfig();
      const first = createSession(
        buildRecordingAgent(recordings[0]),
        new RecordingConnection(),
        config,
      );
      const second = createSession(
        buildRecordingAgent(recordings[1]),
        new RecordingConnection(),
        config,
      );
      sessions.push(first, second);

      await first.prompt({
        sessionId: 'shared-label',
        prompt: [{ type: 'text', text: 'Title A' }],
      });
      await second.prompt({
        sessionId: 'shared-label',
        prompt: [{ type: 'text', text: 'Title B' }],
      });
      await Promise.all(recordings.map((recording) => recording.flush()));

      const firstPath = requireRecordingPath(recordings[0]);
      const secondPath = requireRecordingPath(recordings[1]);
      expect(firstPath).not.toBe(secondPath);
      expect(readFileSync(firstPath, 'utf8')).toContain('Title A');
      expect(readFileSync(firstPath, 'utf8')).not.toContain('Title B');
      expect(readFileSync(secondPath, 'utf8')).toContain('Title B');
      expect(readFileSync(secondPath, 'utf8')).not.toContain('Title A');

      await first.dispose();
      expect(recordings[0].isActive()).toBe(false);
      expect(recordings[1].isActive()).toBe(true);
      recordings[1].recordContent(humanText('after-a-disposed'));
      await recordings[1].flush();
      expect(readFileSync(secondPath, 'utf8')).toContain('after-a-disposed');
      expect(readFileSync(firstPath, 'utf8')).not.toContain('after-a-disposed');

      const hydrated = createSession(
        buildRecordingAgent(recordings[1]),
        new RecordingConnection(),
        config,
      );
      sessions.push(hydrated);
      expect(hydrated.getLifecycleInfo().title).toBe('Title B');
      await second.dispose();
    } finally {
      await Promise.allSettled(sessions.map((session) => session.dispose()));
      await Promise.allSettled(
        recordings.map((recording) => recording.dispose()),
      );
      rmSync(root, { recursive: true, force: true });
    }
  });
});
