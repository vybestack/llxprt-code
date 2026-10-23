/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: resuming from the session browser reports the recordings it
 * skipped, and that report must survive the history restore that follows.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionDiscovery,
  createSessionRecorder,
  type SessionRecordingPort,
  type RecordingIntegration,
  getProjectHash,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../__tests__/render.js';
import { seedSessionRows } from '../../__tests__/journal-recording.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { useSessionBrowserHandler } from './DialogManager.js';

const SESSION_ID = 'browser-resume-session';
function corruptReason(path: string): string {
  return `Session file ${path} ends inside its header (8 bytes)`;
}

describe('session browser resume with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let committed: SessionRecordingPort | null;
  let committedIntegration: RecordingIntegration | null;
  let committedLock: LockHandle | null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'browser-resume-3732-'));
    committed = null;
    committedIntegration = null;
    committedLock = null;
  });

  afterEach(async () => {
    await committedIntegration?.dispose();
    await committed?.dispose();
    await committedLock?.release();
    await rm(root, { recursive: true, force: true });
  });

  it('leaves the skipped-recording warning visible next to the restored conversation', async () => {
    const chatsDir = join(root, 'chats');
    await mkdir(chatsDir, { recursive: true });
    const projectRoot = join(root, 'project');
    const projectHash = getProjectHash(projectRoot);
    const recording = createSessionRecorder({
      chatsDir,
      sessionId: SESSION_ID,
      projectHash,
      workspaceDirs: [chatsDir],
      provider: 'test-provider',
      model: 'test-model',
    });
    await seedSessionRows(recording, [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'restored conversation' }],
      },
    ]);
    await recording.flush();
    await recording.dispose();
    const corruptPath = join(
      chatsDir,
      'session-2026-10-08T21-18-08-corrupt.llxj',
    );
    await writeFile(corruptPath, 'LLXJRNL\0', 'utf-8');
    const [target] = await SessionDiscovery.listContinueTargets(
      chatsDir,
      projectHash,
    );
    const turnStore = createTurnStore();
    const { commands } = turnStore;
    const config = {
      getEphemeralSetting: () => 'auto',
      getProjectTempDir: () => root,
      getProjectRoot: () => projectRoot,
      getSessionId: () => 'current-session',
      getProvider: () => 'test-provider',
      getModel: () => 'test-model',
      directories: () => [root],
      adoptSessionId: () => {},
    } as never;
    const { result, unmount } = renderHook(() =>
      useSessionBrowserHandler(
        config,
        {
          ui: {
            clear: commands.clearItems,
            addItem: commands.addItem,
            pendingItem: null,
            loadHistory: commands.loadHistory,
          },
          services: {
            agent: {
              agentClient: { getHistoryService: () => undefined },
            } as never,
            settings: { merged: { ui: {} } } as never,
          },
          recordingSwapCallbacks: {
            getCurrentRecording: () => null,
            getCurrentIntegration: () => null,
            getCurrentLockHandle: () => null,
            getCurrentMetadata: () => null,
            setRecording: (
              next: SessionRecordingPort | null,
              integration: RecordingIntegration | null,
              lock: LockHandle | null,
            ) => {
              committed = next;
              committedIntegration = integration;
              committedLock = lock;
            },
          },
        },
        commands.addItem,
        () => {},
      ),
    );

    await result.current(target);

    const visible = turnStore.store
      .getState()
      .history.map((item) => ('text' in item ? item.text : item.type));
    expect(visible).toStrictEqual([
      'restored conversation',
      `Warning: Skipped unreadable session recording ${corruptPath}: ${corruptReason(corruptPath)}`,
    ]);
    unmount();
  });
});
