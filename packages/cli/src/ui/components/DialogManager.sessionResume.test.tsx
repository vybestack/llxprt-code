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
  SessionRecordingService,
  getProjectHash,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import { renderHook } from '../../__tests__/render.js';
import { createTurnStore } from '../stores/turn/turnStore.js';
import { useSessionBrowserHandler } from './DialogManager.js';

const SESSION_ID = 'browser-resume-session';
const CORRUPT_REASON =
  'Invalid session_start: missing or malformed required fields';

describe('session browser resume with an unreadable recording present (issue #3732)', () => {
  let root: string;
  let committed: SessionRecordingService | null;
  let committedLock: LockHandle | null;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'browser-resume-3732-'));
    committed = null;
    committedLock = null;
  });

  afterEach(async () => {
    await committed?.dispose();
    await committedLock?.release();
    await rm(root, { recursive: true, force: true });
  });

  it('leaves the skipped-recording warning visible next to the restored conversation', async () => {
    const chatsDir = join(root, 'chats');
    await mkdir(chatsDir, { recursive: true });
    const projectRoot = join(root, 'project');
    const projectHash = getProjectHash(projectRoot);
    const recording = new SessionRecordingService({
      chatsDir,
      sessionId: SESSION_ID,
      projectHash,
      workspaceDirs: [chatsDir],
      provider: 'test-provider',
      model: 'test-model',
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'restored conversation' }],
    });
    await recording.flush();
    await recording.dispose();
    const corruptPath = join(
      chatsDir,
      'session-2026-10-08T21-18-08-corrupt.jsonl',
    );
    await writeFile(
      corruptPath,
      `${JSON.stringify({
        v: 1,
        seq: 1,
        ts: '2026-10-08T21:18:08.000Z',
        type: 'session_start',
        payload: {
          sessionId: 'corrupt-browser-session',
          projectHash,
          workspaceDirs: ['/x'],
          provider: 'anthropic',
          model: 42,
          startTime: '2026-10-08T21:18:08.000Z',
        },
      })}\n`,
      'utf-8',
    );
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
      getWorkspaceContext: () => ({ getDirectories: () => [root] }),
      getAgentClient: () => ({ getHistoryService: () => undefined }),
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
          },
          recordingSwapCallbacks: {
            getCurrentRecording: () => null,
            getCurrentIntegration: () => null,
            getCurrentLockHandle: () => null,
            setRecording: (
              next: SessionRecordingService,
              _integration: unknown,
              lock: LockHandle,
            ) => {
              committed = next;
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
      `Warning: Skipped unreadable session recording ${corruptPath}: ${CORRUPT_REASON}`,
    ]);
    unmount();
  });
});
