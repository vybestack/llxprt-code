/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3839: deleting a session by reference must report which recordings
 * discovery had to skip, exactly as listing does, without changing how the
 * reference resolves.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  deleteSession,
  deleteSessionWithDiagnostics,
} from './sessionManagement.js';

const PROJECT_HASH = 'test-project-hash-delete-diagnostics';

describe('deleteSessionWithDiagnostics (issue #3839)', () => {
  let chatsDir: string;

  beforeEach(async () => {
    chatsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'delete-diag-3839-'));
  });

  afterEach(async () => {
    await fs.rm(chatsDir, { recursive: true, force: true });
  });

  async function writeHealthySession(sessionId: string): Promise<string> {
    const recording = new SessionRecordingService({
      chatsDir,
      sessionId,
      projectHash: PROJECT_HASH,
      workspaceDirs: ['/test/workspace'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    try {
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      });
      await recording.flush();
      const filePath = recording.getFilePath();
      if (filePath === null) {
        throw new Error(`Recording for session ${sessionId} has no file path`);
      }
      return filePath;
    } finally {
      await recording.dispose();
    }
  }

  async function writeCorruptSession(sessionId: string): Promise<string> {
    const filePath = path.join(
      chatsDir,
      `session-2026-10-08T21-18-08-${sessionId.slice(0, 12)}.jsonl`,
    );
    const header = {
      v: 1,
      seq: 1,
      ts: '2026-10-08T21:18:08.000Z',
      type: 'session_start',
      payload: {
        sessionId,
        projectHash: PROJECT_HASH,
        workspaceDirs: ['/x'],
        provider: 'anthropic',
        model: 42,
        startTime: '2026-10-08T21:18:08.000Z',
      },
    };
    await fs.writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf-8');
    return filePath;
  }

  it('deletes the matching session and reports the unreadable recording discovery skipped', async () => {
    const healthyPath = await writeHealthySession('healthy-session-id');
    const corruptPath = await writeCorruptSession('corrupt-session-id');

    const outcome = await deleteSessionWithDiagnostics(
      'healthy-session-id',
      chatsDir,
      PROJECT_HASH,
    );

    expect({
      result: outcome.result,
      skippedPaths: outcome.unreadableRecordings.map((r) => r.filePath),
      healthyStillThere: await fs.access(healthyPath).then(
        () => true,
        () => false,
      ),
      corruptStillThere: await fs.access(corruptPath).then(
        () => true,
        () => false,
      ),
    }).toStrictEqual({
      result: { ok: true, deletedSessionId: 'healthy-session-id' },
      skippedPaths: [corruptPath],
      healthyStillThere: false,
      corruptStillThere: true,
    });
  });

  it('reports the unreadable recording alongside the not-found error and deletes nothing', async () => {
    const healthyPath = await writeHealthySession('healthy-session-id');
    const corruptPath = await writeCorruptSession('corrupt-session-id');

    const outcome = await deleteSessionWithDiagnostics(
      'no-such-session',
      chatsDir,
      PROJECT_HASH,
    );

    expect({
      ok: outcome.result.ok,
      skippedPaths: outcome.unreadableRecordings.map((r) => r.filePath),
      healthyStillThere: await fs.access(healthyPath).then(
        () => true,
        () => false,
      ),
    }).toStrictEqual({
      ok: false,
      skippedPaths: [corruptPath],
      healthyStillThere: true,
    });
  });

  it('reports the unreadable recording when no readable session exists at all', async () => {
    const corruptPath = await writeCorruptSession('corrupt-session-id');

    const outcome = await deleteSessionWithDiagnostics(
      '1',
      chatsDir,
      PROJECT_HASH,
    );

    expect({
      ok: outcome.result.ok,
      skippedPaths: outcome.unreadableRecordings.map((r) => r.filePath),
    }).toStrictEqual({ ok: false, skippedPaths: [corruptPath] });
  });

  it('keeps deleteSession returning the bare result so existing callers are unchanged', async () => {
    await writeHealthySession('healthy-session-id');
    await writeCorruptSession('corrupt-session-id');

    const result = await deleteSession(
      'healthy-session-id',
      chatsDir,
      PROJECT_HASH,
    );

    expect(result).toStrictEqual({
      ok: true,
      deletedSessionId: 'healthy-session-id',
    });
  });
});
