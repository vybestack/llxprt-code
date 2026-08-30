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
 * CLI-boundary behavioral test for session cleanup (Item 9).
 *
 * Proves that the CLI entry point (`cleanupExpiredSessions`) correctly passes
 * the machine-global temp root and resolves partial/default `sessionRetention`
 * settings through the full CLI→core pipeline, using real temporary
 * filesystems — no filesystem mock theater.
 *
 * The `globalTempDirOverride` parameter (added as a narrow testability
 * boundary to `cleanupExpiredSessions`) allows injecting a real temp
 * directory so the test does not affect the machine's real global temp root.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core';
import { DEFAULT_MAX_TOTAL_SIZE_MB } from '@vybestack/llxprt-code-core/recording/janitor/index.js';
import type { Settings } from '../config/settings.js';
import { cleanupExpiredSessions } from './sessionCleanup.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cli-cleanup-boundary-'));
}

function validHash64(): string {
  return crypto.randomUUID().replace(/-/g, '').repeat(2).slice(0, 64);
}

/** Minimal Config stub providing only the methods cleanupExpiredSessions uses. */
function createMinimalConfig(
  sessionId: string,
  debugMode = false,
): {
  getSessionId: () => string;
  getDebugMode: () => boolean;
  getAgentClient: () => { getHistory: () => Promise<[]> };
} {
  return {
    getSessionId: () => sessionId,
    getDebugMode: () => debugMode,
    getAgentClient: () => ({
      getHistory: async () => [],
    }),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a real old session file under a project-hash chats directory.
 * Returns the file path, session ID, and project hash for assertions.
 */
async function createOldSession(
  tempDir: string,
  ageDays = 5,
): Promise<{ filePath: string; sessionId: string; hash: string }> {
  const hash = validHash64();
  const chatsDir = path.join(tempDir, hash, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });

  const sessionId = 'session-' + crypto.randomUUID();
  const startTime = new Date(
    Date.now() - ageDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const payload = JSON.stringify({
    v: 1,
    seq: 0,
    ts: startTime,
    type: 'session_start',
    payload: { sessionId, startTime, projectHash: hash },
  });
  const filePath = path.join(
    chatsDir,
    `session-2026-01-01T00-00-00-${sessionId.slice(0, 12)}.jsonl`,
  );
  await fs.writeFile(filePath, payload + '\n');
  const oldTime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  await fs.utimes(filePath, oldTime, oldTime);

  return { filePath, sessionId, hash };
}

describe('cleanupExpiredSessions — CLI boundary (Item 9)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('passes the global temp root and discovers sessions through the full pipeline', async () => {
    await createOldSession(tempDir);

    const config = createMinimalConfig('current-cli-session');
    const settings: Settings = {} as Settings;

    const result = await cleanupExpiredSessions(
      config as unknown as Config,
      settings,
      tempDir,
    );

    expect(result.disabled).toBe(false);
    expect(result.janitorWonLease).toBe(true);
    expect(result.scanned).toBe(1);
  });

  it('retains the 4 GiB default for a partial settings object through the CLI boundary', async () => {
    await createOldSession(tempDir);

    const config = createMinimalConfig('current-cli-session');
    // Partial settings: only maxAge is set.
    // The 4 GiB default size budget must be retained so the small session is NOT deleted.
    const settings = {
      sessionRetention: { maxAge: '30d' },
    } as unknown as Settings;

    const result = await cleanupExpiredSessions(
      config as unknown as Config,
      settings,
      tempDir,
    );

    // Default budget retained — small session survives.
    expect(result.configuredByteLimit).toBe(
      DEFAULT_MAX_TOTAL_SIZE_MB * 1024 * 1024,
    );
    expect(result.archived).toBe(0);
    expect(result.rawDeleted).toBe(0);
  });

  it('passes undefined sessionRetention (defaults) through the CLI boundary', async () => {
    const { filePath } = await createOldSession(tempDir);

    const config = createMinimalConfig('current-cli-session');
    // No sessionRetention at all — pure defaults.
    const settings = {} as Settings;

    const result = await cleanupExpiredSessions(
      config as unknown as Config,
      settings,
      tempDir,
    );

    expect(result.disabled).toBe(false);
    // Default-on, default budget, no maxAge.
    expect(result.configuredByteLimit).toBe(
      DEFAULT_MAX_TOTAL_SIZE_MB * 1024 * 1024,
    );
    // Old session under budget survives (no default maxAge).
    expect(result.rawDeleted).toBe(0);
    expect(await fileExists(filePath)).toBe(true);
  });

  it('honors enabled:false through the CLI boundary', async () => {
    const config = createMinimalConfig('current-cli-session');
    const settings = {
      sessionRetention: { enabled: false },
    } as unknown as Settings;

    const result = await cleanupExpiredSessions(
      config as unknown as Config,
      settings,
      tempDir,
    );

    expect(result.disabled).toBe(true);
    expect(result.janitorWonLease).toBe(false);
  });
});

describe('cleanupExpiredSessions — config resolution vs external fs (finding D)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('surfaces invalid retention settings clearly instead of returning configuredByteLimit 0', async () => {
    const config = createMinimalConfig('current-cli-session');
    const settings = {
      sessionRetention: { maxCount: 2.5 },
    } as unknown as Settings;

    // Invalid settings are a configuration error, not a best-effort external
    // filesystem failure. They must throw rather than be swallowed into a
    // configuredByteLimit-0 result.
    await expect(
      cleanupExpiredSessions(config as unknown as Config, settings, tempDir),
    ).rejects.toThrow(/Invalid sessionRetention/);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'preserves the resolved configured limit when the temp root is externally inaccessible',
    async () => {
      // An unreadable global temp root is an external filesystem condition that
      // is best-effort: cleanup cannot proceed, but the resolved configured
      // limit must still be reported (never zeroed out) so diagnostics stay
      // coherent (finding D).
      const restricted = path.join(tempDir, 'restricted');
      await fs.mkdir(restricted, { recursive: true });
      await fs.chmod(restricted, 0o000);
      try {
        const config = createMinimalConfig('current-cli-session');
        const settings = {
          sessionRetention: { maxTotalSizeMB: 16 },
        } as unknown as Settings;

        const result = await cleanupExpiredSessions(
          config as unknown as Config,
          settings,
          restricted,
        );

        expect(result.configuredByteLimit).toBe(16 * 1024 * 1024);
        expect(result.janitorWonLease).toBe(false);
      } finally {
        await fs.chmod(restricted, 0o700).catch(() => {});
      }
    },
  );
});
