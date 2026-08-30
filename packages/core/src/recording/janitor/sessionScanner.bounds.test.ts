/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanGlobalSessions } from './sessionScanner.js';

function recording(sessionId: string): string {
  return `${JSON.stringify({
    v: 2,
    seq: 1,
    type: 'session_start',
    payload: { sessionId },
  })}\n`;
}

describe('session scanner finite work bounds', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-scanner-bounds-'));
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('stops at the candidate cap and reports one configured skip without an error', async () => {
    const chatsDirectory = join(tempDirectory, 'd'.repeat(64), 'chats');
    await mkdir(chatsDirectory, { recursive: true });
    for (let index = 0; index < 100; index += 1) {
      await writeFile(
        join(chatsDirectory, `session-${index}.jsonl`),
        recording(`bounded-${index}`),
      );
    }

    const result = await scanGlobalSessions(tempDirectory, undefined, {
      maxProjects: 2,
      maxFiles: 2,
      maxCandidateBytes: 1024 * 1024,
    });

    expect({
      candidates: result.candidates.length,
      errors: result.scanErrorCount,
      skipped: result.scanSkippedCount,
    }).toEqual({ candidates: 2, errors: 0, skipped: 1 });
  });

  it('stops at the aggregate byte cap and reports the configured skip without an error', async () => {
    const chatsDirectory = join(tempDirectory, 'e'.repeat(64), 'chats');
    await mkdir(chatsDirectory, { recursive: true });
    const first = recording('first');
    await writeFile(join(chatsDirectory, 'session-1.jsonl'), first);
    await writeFile(
      join(chatsDirectory, 'session-2.jsonl'),
      recording('second'),
    );

    const result = await scanGlobalSessions(tempDirectory, undefined, {
      maxProjects: 2,
      maxFiles: 4,
      maxCandidateBytes: Buffer.byteLength(first),
    });

    expect({
      candidates: result.candidates.length,
      skipped: result.scanSkippedCount,
      errors: result.scanErrorCount,
    }).toEqual({ candidates: 1, skipped: 1, errors: 0 });
  });

  it('stops after the configured project cap without traversing extra projects', async () => {
    const projectNames = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)];
    for (const [index, projectName] of projectNames.entries()) {
      const chatsDirectory = join(tempDirectory, projectName, 'chats');
      await mkdir(chatsDirectory, { recursive: true });
      await writeFile(
        join(chatsDirectory, `session-${index}.jsonl`),
        recording(`project-${index}`),
      );
    }

    const result = await scanGlobalSessions(tempDirectory, undefined, {
      maxProjects: 2,
      maxFiles: 10,
      maxCandidateBytes: 1024 * 1024,
    });

    expect({
      candidates: result.candidates.length,
      chatsDirectories: result.chatsDirs.length,
      skipped: result.scanSkippedCount,
      errors: result.scanErrorCount,
    }).toEqual({
      candidates: 2,
      chatsDirectories: 2,
      skipped: 1,
      errors: 0,
    });
  });
});
