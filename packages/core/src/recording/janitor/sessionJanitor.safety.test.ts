/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Adversarial safety tests for the session janitor (Items 1, 4, 8).
 *
 * Tests prove:
 * - The global temp root is NEVER removed (Item 1: no global-root removal).
 * - Post-scan file replacement is caught by revalidation and data is retained
 *   (Item 4).
 * - A symlinked archive directory is not followed during a full sweep
 *   (Item 1).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  runSessionCleanup,
  setScanToMutationHookForTest,
  setRmdirFaultForTest,
} from './sessionJanitor.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { SessionRecordingService } from '../SessionRecordingService.js';
import type { SessionRecordingServiceConfig } from '../types.js';
import { ARCHIVE_DIR_NAME } from './sessionScanner.js';

/**
 * File-level hook reset so process-global test seams never leak into
 * subsequent test files, regardless of which describe block ran last.
 */
afterEach(() => {
  setScanToMutationHookForTest(null);
  setRmdirFaultForTest(null);
});

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'janitor-safety-'));
}

function validHash64(): string {
  return crypto.randomUUID().replace(/-/g, '').repeat(2).slice(0, 64);
}

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: 'session-' + crypto.randomUUID(),
    projectHash: validHash64(),
    chatsDir,
    workspaceDirs: [chatsDir],
    provider: 'test',
    model: 'test',
  };
}

async function createSession(
  chatsDir: string,
  opts: {
    ageMs?: number;
    content?: string;
    sessionId?: string;
  } = {},
): Promise<{ filePath: string; sessionId: string }> {
  await fs.mkdir(chatsDir, { recursive: true });
  const sessionId = opts.sessionId ?? 'session-' + crypto.randomUUID();
  const config: SessionRecordingServiceConfig = {
    ...makeConfig(chatsDir),
    sessionId,
  };
  const svc = new SessionRecordingService(config);
  try {
    svc.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: opts.content ?? 'test message' }],
    });
    await svc.flush();
  } finally {
    await svc.dispose();
  }
  const filePath = svc.getFilePath();
  if (!filePath) throw new Error('No file path');
  if (opts.ageMs !== undefined) {
    const oldTime = new Date(Date.now() - opts.ageMs);
    await fs.utimes(filePath, oldTime, oldTime);
  }
  return { filePath, sessionId };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe('runSessionCleanup — global temp root is never removed (Item 1)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not rmdir the global temp root after cleanup', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await createSession(chatsDir, { ageMs: 2 * 24 * 60 * 60 * 1000 });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The global temp root must survive cleanup.
    expect(await fileExists(tempDir)).toBe(true);
  });
});

describe('runSessionCleanup — symlinked archive directory (Item 1)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not write into or follow a symlinked archive directory during sweep', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });

    // Create a target directory outside the tree.
    const outsideDir = path.join(tempDir, 'outside-archive-target');
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'secret');

    // Replace chats/archive with a symlink to the outside dir.
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.symlink(outsideDir, archiveDir, 'dir');

    // Create an old session that will be over-budget.
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The outside secret file must survive — no archive was written through
    // the symlink.
    expect(await fileExists(path.join(outsideDir, 'secret.txt'))).toBe(true);
    // No .gz files should have been created in the outside dir.
    const outsideEntries = await fs.readdir(outsideDir);
    expect(outsideEntries.some((f) => f.endsWith('.gz'))).toBe(false);
  });
});

describe('runSessionCleanup — post-scan file replacement (Item 4)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('retains data when a session file is replaced with a symlink between scan and mutation', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath } = await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Replace the file with a symlink to an outside file right before cleanup.
    const outsideTarget = path.join(tempDir, 'outside-target.jsonl');
    await fs.writeFile(
      outsideTarget,
      '{"type":"session_start","payload":{"sessionId":"evil"}}\n',
    );
    await fs.unlink(filePath);
    await fs.symlink(outsideTarget, filePath);

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The symlinked file must survive — revalidation caught the replacement.
    expect(await fileExists(filePath)).toBe(true);
    expect(await fileExists(outsideTarget)).toBe(true);
    // No archives should have been created from the symlink.
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    let archiveEntries: string[] = [];
    if (await fileExists(archiveDir)) {
      archiveEntries = await fs.readdir(archiveDir);
    }
    expect(archiveEntries.some((f) => f.endsWith('.gz'))).toBe(false);
  });
});

describe('runSessionCleanup — exact temp grammar cleanup (Item 8)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('does not remove non-session temp files during cleanup', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    await fs.mkdir(archiveDir, { recursive: true });

    // Create a file that does NOT match the temp grammar.
    const innocentFile = path.join(archiveDir, 'random.bak');
    await fs.writeFile(innocentFile, 'data');
    const oldTime = new Date(Date.now() - 120 * 1000);
    await fs.utimes(innocentFile, oldTime, oldTime);

    // Also create a valid session (not over budget so no archival happens).
    await createSession(chatsDir, { ageMs: 2 * 24 * 60 * 60 * 1000 });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 4096 });
    await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Innocent file must survive.
    expect(await fileExists(innocentFile)).toBe(true);
  });
});

/**
 * Mutation-time inode revalidation (Item 4, finding 29).
 *
 * The previous test replaced the file BEFORE scanning, so the scanner never
 * saw the original file — header checks alone could save it.  This test uses
 * a narrow test-only lifecycle hook to replace the file AFTER scanGlobalSessions
 * returns but BEFORE reclamation, with another regular file using the SAME
 * canonical session ID.  Only inode (dev/ino) revalidation can catch this.
 */
describe('runSessionCleanup — mutation-time inode revalidation (Item 4, finding 29)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('retains a replaced regular file (same session ID) between scan and mutation', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    const { filePath, sessionId } = await createSession(chatsDir, {
      ageMs: 5 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Install the lifecycle hook: after scan, replace the file with a NEW
    // regular file using the SAME session ID and a valid header.  Header
    // checks alone cannot detect this — only dev/ino revalidation can.
    setScanToMutationHookForTest(async () => {
      const replacementContent =
        JSON.stringify({
          v: 1,
          seq: 0,
          ts: new Date().toISOString(),
          type: 'session_start',
          payload: { sessionId, startTime: new Date().toISOString() },
        }) +
        '\n' +
        '{"type":"user","payload":{"speaker":"human","blocks":[{"type":"text","text":"replacement"}]}}\n';

      await fs.unlink(filePath);
      await fs.writeFile(filePath, replacementContent, 'utf-8');
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // The replacement file must survive — inode revalidation caught the swap.
    expect(await fileExists(filePath)).toBe(true);
    // No archive should have been created.
    const archiveDir = path.join(chatsDir, ARCHIVE_DIR_NAME);
    let archiveEntries: string[] = [];
    if (await fileExists(archiveDir)) {
      archiveEntries = await fs.readdir(archiveDir);
    }
    expect(archiveEntries.some((f) => f.endsWith('.gz'))).toBe(false);
    // The replacement was NOT archived or deleted.
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
  });
});

/**
 * Diagnostic wiring tests (Item 4, finding 34/35).
 *
 * Prove that non-benign per-directory failures (temp + empty-dir cleanup)
 * are counted in `failed` instead of being silently swallowed.  Uses a
 * narrow rmdir fault seam since chmod cannot reliably induce platform errors.
 */
describe('runSessionCleanup — diagnostic error counting (Item 4)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('counts non-benign rmdir failures in the failed counter', async () => {
    const hash = validHash64();
    const chatsDir = path.join(tempDir, hash, 'chats');
    await createSession(chatsDir, {
      ageMs: 2 * 24 * 60 * 60 * 1000,
      content: 'A'.repeat(50_000),
    });

    // Inject a fault that makes rmdir fail with a non-benign error.
    setRmdirFaultForTest(async (_dirPath: string) => {
      const err = new Error('EIO') as NodeJS.ErrnoException;
      err.code = 'EIO';
      throw err;
    });

    const config = resolveRetentionConfig({ maxTotalSizeMB: 0.001 });
    const result = await runSessionCleanup({
      globalTempDir: tempDir,
      config,
    });

    // Non-benign cleanup failures must be counted.
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});
