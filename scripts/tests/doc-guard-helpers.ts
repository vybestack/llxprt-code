/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for the doc-link and doc-placement guard tests.
 *
 * Invokes the real guard script via an async child process (no mock theater)
 * and provides a single useTempDir() lifecycle helper per RULES.md so
 * beforeEach/afterEach boilerplate is never copy-pasted.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach } from 'bun:test';

const execFileAsync = promisify(execFile);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

let cachedBunAvailable: boolean | undefined;

export function bunAvailable(): boolean {
  if (cachedBunAvailable !== undefined) {
    return cachedBunAvailable;
  }
  try {
    execFileSync(RUNTIME, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: 'pipe',
    });
    cachedBunAvailable = true;
  } catch (error) {
    const err = error as { code?: string };
    const isMissingOrDenied =
      err.code === 'ENOENT' || err.code === 'EACCES' || err.code === 'ENOEXEC';
    if (!isMissingOrDenied) {
      throw error;
    }
    cachedBunAvailable = false;
  }
  return cachedBunAvailable;
}

/**
 * Detect whether tests are running under CI.
 *
 * Many CI systems set CI=true, but some use CI=1 or CI=yes. Treat CI as
 * set-and-not-false: a present, non-"false" value means CI is active.
 * An unset CI variable means local (non-CI) execution.
 */
export function isCiEnvironment(): boolean {
  const ci = process.env.CI;
  if (ci === undefined) return false;
  return ci.toLowerCase() !== 'false';
}

export interface ScriptResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface ExecErrorLike {
  readonly exitCode?: number | null;
  readonly systemCode?: string;
  readonly signal?: string;
  readonly message: string;
  readonly stdout?: string;
  readonly stderr?: string;
}

function toExecError(error: unknown): ExecErrorLike {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) };
  }
  const candidate = error as Record<string, unknown>;
  const rawCode = candidate.code;
  return {
    exitCode: typeof rawCode === 'number' ? rawCode : null,
    systemCode: typeof rawCode === 'string' ? rawCode : undefined,
    signal: typeof candidate.signal === 'string' ? candidate.signal : undefined,
    message:
      typeof candidate.message === 'string' ? candidate.message : String(error),
    stdout: typeof candidate.stdout === 'string' ? candidate.stdout : undefined,
    stderr: typeof candidate.stderr === 'string' ? candidate.stderr : undefined,
  };
}

interface GuardRunOptions {
  readonly root?: string;
  readonly scriptName: string;
  readonly expectedCode?: number;
  readonly env?: NodeJS.ProcessEnv;
}

async function runGuard(opts: GuardRunOptions): Promise<ScriptResult> {
  const scriptPath = join(REPO_ROOT, 'scripts', opts.scriptName);
  const env = { ...process.env, ...opts.env };
  if (opts.root) {
    env.DOC_GUARD_ROOT = opts.root;
  }
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(RUNTIME, [scriptPath], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    const err = toExecError(error);
    if (
      err.systemCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
      err.systemCode === 'ENOBUFS'
    ) {
      throw new Error(
        `Guard ${opts.scriptName} exceeded maxBuffer (${err.systemCode}): ${err.message}`,
      );
    }
    if (err.signal === 'SIGTERM' || err.systemCode === 'ETIMEDOUT') {
      throw new Error(`Guard ${opts.scriptName} timed out: ${err.message}`);
    }
    if (err.systemCode === 'ENOENT') {
      throw new Error(
        `Guard ${opts.scriptName} failed ENOENT: runtime or script missing. ${err.message}`,
      );
    }
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    exitCode = err.exitCode ?? 1;
  }
  if (opts.expectedCode !== undefined && exitCode !== opts.expectedCode) {
    throw new Error(
      `Guard ${opts.scriptName} exited ${exitCode}, expected ${opts.expectedCode}.` +
        (stderr ? `\nstderr:\n${stderr}` : '') +
        (stdout ? `\nstdout:\n${stdout}` : ''),
    );
  }
  return { code: exitCode, stdout, stderr };
}

export function runDocLinksGuard(
  root: string,
  expectedCode?: number,
): Promise<ScriptResult> {
  return runGuard({
    root,
    scriptName: 'check-doc-links.ts',
    expectedCode,
  });
}

export function runDocLinksGuardRealRepo(
  expectedCode?: number,
): Promise<ScriptResult> {
  return runGuard({ scriptName: 'check-doc-links.ts', expectedCode });
}

export function runDocPlacementGuard(
  root: string,
  expectedCode?: number,
): Promise<ScriptResult> {
  return runGuard({
    root,
    scriptName: 'check-doc-placement.ts',
    expectedCode,
  });
}

export function runDocPlacementGuardRealRepo(
  expectedCode?: number,
): Promise<ScriptResult> {
  return runGuard({ scriptName: 'check-doc-placement.ts', expectedCode });
}

/**
 * Per-describe-block temp-dir lifecycle helper. Wires beforeEach/afterEach
 * internally and returns a lazy accessor. Each call to useTempDir() creates
 * a SEPARATE temp directory for its describe block — no cross-contamination.
 *
 * The trick: each call gets its own closure variable, and the hooks are
 * registered within the describe scope where useTempDir() is called. Since
 * vitest hooks are scoped to the describe block they're registered in,
 * each describe block gets its own independent setup/teardown.
 *
 * Both docs/ and dev-docs/ directories are pre-created so the fail-fast
 * root checks in the guards pass.
 */
export function useTempDir(): {
  root: () => string;
  write(relPath: string, content: string): void;
} {
  // Each invocation gets its own root variable — no sharing across
  // describe blocks even when useTempDir is called multiple times.
  const ref: { root: string } = { root: '' };
  beforeEach(() => {
    ref.root = mkdtempSync(join(tmpdir(), 'doc-guard-'));
    // Pre-create the expected root directories so the guards' fail-fast
    // checks pass. Individual tests create files within them.
    mkdirSync(join(ref.root, 'docs'), { recursive: true });
    mkdirSync(join(ref.root, 'dev-docs'), { recursive: true });
  });
  afterEach(() => {
    if (ref.root) {
      rmSync(ref.root, { recursive: true, force: true });
      ref.root = '';
    }
  });
  return {
    root: () => ref.root,
    write(relPath: string, content: string): void {
      if (!ref.root) {
        throw new Error('useTempDir write() called outside of a test');
      }
      const full = join(ref.root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    },
  };
}

export const repoRoot = REPO_ROOT;
export const scriptDir = SCRIPT_DIR;
