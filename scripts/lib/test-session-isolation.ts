/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Session-scoped fake system root for Bun test processes (issue #3622).
 *
 * Bun's `os.homedir()` honors `$HOME` only when it is set at process start,
 * so a preload can never redirect it mid-run. Isolation therefore happens at
 * spawn time: the test runners build a per-run env whose `HOME`, `TMPDIR`, and
 * XDG dirs point inside a throwaway session root, and spawn every test file
 * with that env. Sibling repo checkouts share the machine temp dir, so every
 * session id must be unique across processes and time.
 *
 * Runners remove the session root after children and teardowns finish.
 * Set `LLXPRT_TEST_KEEP_SESSION_ROOT=1` to retain artifacts for debugging.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SentinelGuard } from './real-home-sentinel.js';

/** Layout handle for one test-run session root. */
export interface TestSession {
  /** `<tmpdir>/llxprt-tests/<sessionid>` */
  readonly root: string;
  /** `<root>/home/user` — the fake `$HOME` for spawned test processes. */
  readonly homeDir: string;
  /** `<root>/tmp` — the fake `$TMPDIR` for spawned test processes. */
  readonly tmpDir: string;
}

/**
 * The env keys a session env owns. Every other entry of the runner env —
 * including all pre-existing `LLXPRT_*` storage-isolation overrides — is
 * passed through untouched, so per-workspace storage isolation keeps
 * precedence over the session root.
 */
export const SESSION_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'APPDATA',
  'LOCALAPPDATA',
  'TMPDIR',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'LLXPRT_TEST_SESSION_ROOT',
  'LLXPRT_TEST_DISABLE_OS_KEYRING',
  'LLXPRT_TEST_STORAGE_ISOLATED',
] as const;

export type SessionEnvKey = (typeof SESSION_ENV_KEYS)[number];

/** pid + timestamp + random suffix: unique across concurrent checkouts. */
function createSessionId(): string {
  return `p${process.pid}-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`;
}

/**
 * Creates `<baseTmpDir>/llxprt-tests/<sessionid>/` containing `home/user`
 * (with `.config`, `.cache`, and `.local/share`) and `tmp`.
 */
export function createTestSessionRoot(baseTmpDir?: string): TestSession {
  const base = baseTmpDir ?? tmpdir();
  const prefix = join(base, 'llxprt-tests');
  mkdirSync(prefix, { recursive: true });
  const root = join(prefix, createSessionId());
  mkdirSync(root, { mode: 0o700 });
  const homeDir = join(root, 'home', 'user');
  const tmpDir = join(root, 'tmp');
  mkdirSync(join(homeDir, '.config'), { recursive: true });
  mkdirSync(join(homeDir, '.cache'), { recursive: true });
  mkdirSync(join(homeDir, '.local', 'share'), { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(join(homeDir, 'AppData', 'Roaming'), { recursive: true });
  mkdirSync(join(homeDir, 'AppData', 'Local'), { recursive: true });
  return { root, homeDir, tmpDir };
}

/**
 * Builds the env every test file is spawned with: a copy of the runner env
 * with the session keys overridden. The input env (the runner's own
 * `process.env`) is never mutated — the runner must keep its real `HOME` so
 * the real-home sentinel guard keeps watching the real user directories.
 */
export function buildSessionEnv(
  env: NodeJS.ProcessEnv,
  session: TestSession,
): NodeJS.ProcessEnv {
  const sessionEnv: NodeJS.ProcessEnv = {
    ...env,
    HOME: session.homeDir,
    USERPROFILE: session.homeDir,
    TEMP: session.tmpDir,
    TMP: session.tmpDir,
    APPDATA: join(session.homeDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(session.homeDir, 'AppData', 'Local'),
    TMPDIR: session.tmpDir,
    XDG_CONFIG_HOME: join(session.homeDir, '.config'),
    XDG_CACHE_HOME: join(session.homeDir, '.cache'),
    XDG_DATA_HOME: join(session.homeDir, '.local', 'share'),
    LLXPRT_TEST_SESSION_ROOT: session.root,
    LLXPRT_TEST_DISABLE_OS_KEYRING: '1',
  };
  // The child's storage preload owns this marker, not the session env.
  delete sessionEnv.LLXPRT_TEST_STORAGE_ISOLATED;
  return sessionEnv;
}

/** Removes session artifacts unless retention was explicitly requested. */
export function removeSessionRoot(session: TestSession): void {
  if (process.env.LLXPRT_TEST_KEEP_SESSION_ROOT === '1') return;
  try {
    rmSync(session.root, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup must not replace the test run's outcome.
  }
}

/** Finishes teardown and sentinel checks before removing the session root. */
export async function cleanupTestSession(
  session: TestSession,
  guard: SentinelGuard,
  teardown: () => Promise<number>,
  log: (message: string) => void,
): Promise<number> {
  let failures = 0;
  try {
    failures += await teardown();
  } catch (error) {
    failures++;
    log(`Global teardown failed: ${String(error)}`);
  } finally {
    try {
      guard.assertUnchanged('run teardown');
    } catch (error) {
      failures++;
      log(String(error));
    } finally {
      try {
        guard.cleanup();
      } catch (error) {
        failures++;
        log(`Test runner cleanup failed: ${String(error)}`);
      } finally {
        removeSessionRoot(session);
      }
    }
  }
  return failures;
}
