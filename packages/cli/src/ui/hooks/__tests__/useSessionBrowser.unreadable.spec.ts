/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3732: the session browser lists the readable sessions and names the
 * recordings it skipped, with their reason, on the CLI debug log.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { renderHook, waitFor } from '../../../__tests__/render.js';
import { useSessionBrowser } from '../useSessionBrowser.js';

const PROJECT_HASH = 'browser-unreadable-project';

describe('useSessionBrowser with an unreadable recording present (issue #3732)', () => {
  let chatsDir: string;
  const warnings: string[] = [];

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-3732-'));
    warnings.length = 0;
    vi.spyOn(debugLogger, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  it('lists the healthy session and logs the skipped file with its reason', async () => {
    const recording = new SessionRecordingService({
      sessionId: 'browser-healthy-session',
      projectHash: PROJECT_HASH,
      chatsDir,
      workspaceDirs: [chatsDir],
      provider: 'test-provider',
      model: 'test-model',
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'healthy content' }],
    });
    await recording.flush();
    await recording.dispose();
    const brokenPath = path.join(
      chatsDir,
      'session-2026-10-08T21-18-08-broken000001.jsonl',
    );
    await fs.writeFile(brokenPath, '', 'utf-8');

    const { result, unmount } = renderHook(() =>
      useSessionBrowser({
        chatsDir,
        projectHash: PROJECT_HASH,
        currentSessionId: 'current-session',
        onSelect: async () => ({ ok: false, error: 'not selected' }),
        onClose: () => {},
      }),
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect({
      listed: result.current.sessions.map((entry) => entry.sessionId),
      skippedCount: result.current.skippedCount,
      warnings,
    }).toStrictEqual({
      listed: ['browser-healthy-session'],
      skippedCount: 1,
      warnings: [
        `Session browser: skipped 1 unreadable session recording(s): ${brokenPath}: Empty file or unreadable first line`,
      ],
    });
    unmount();
  });
});
