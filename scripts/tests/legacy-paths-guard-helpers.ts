/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers for the legacy-paths guard behavioral tests.
 *
 * These helpers invoke the real guard script via an async child process
 * (no mock theater) and manage temp-fixture creation/cleanup.
 */

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
export const SCRIPT = join(REPO_ROOT, 'scripts', 'check-legacy-paths.ts');
export const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

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

/**
 * Run the guard script against a temp fixture root. Returns exit code,
 * stdout, stderr. If `args` includes '--self-test', the script runs the
 * built-in RED/GREEN self-test instead of scanning the repo.
 */
export function runScript(
  root: string,
  expectedCode?: number,
  args: readonly string[] = [],
): Promise<ScriptResult> {
  const env = { ...process.env, LEGACY_PATHS_ROOT: root };
  return runGuard(env, 30_000, 10 * 1024 * 1024, expectedCode, args);
}

/**
 * Run the guard script against the real repository (no LEGACY_PATHS_ROOT).
 */
export function runScriptRealRepo(
  expectedCode?: number,
  args: readonly string[] = [],
): Promise<ScriptResult> {
  const env = { ...process.env };
  delete env.LEGACY_PATHS_ROOT;
  return runGuard(env, 60_000, 20 * 1024 * 1024, expectedCode, args);
}

async function runGuard(
  env: NodeJS.ProcessEnv,
  timeout: number,
  maxBuffer: number,
  expectedCode: number | undefined,
  args: readonly string[],
): Promise<ScriptResult> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(RUNTIME, [SCRIPT, ...args], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf8',
      timeout,
      maxBuffer,
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
        `Guard script exceeded maxBuffer (${maxBuffer} bytes) and was killed ` +
          `(${err.systemCode}). Original: ${err.message}`,
      );
    }
    if (err.signal === 'SIGTERM' || err.systemCode === 'ETIMEDOUT') {
      throw new Error(
        `Guard script timed out after ${timeout / 1000}s. Original: ${err.message}`,
      );
    }
    if (err.systemCode === 'ENOENT') {
      throw new Error(
        `Guard script failed with ENOENT. Runtime "${RUNTIME}" not on PATH ` +
          `or script missing: ${SCRIPT}. Original: ${err.message}`,
      );
    }
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
    exitCode = err.exitCode ?? 1;
  }
  if (expectedCode !== undefined && exitCode !== expectedCode) {
    throw new Error(
      `Guard script exited with code ${exitCode}, expected ${expectedCode}.` +
        (stderr ? `\nstderr:\n${stderr}` : '') +
        (stdout ? `\nstdout:\n${stdout}` : ''),
    );
  }
  return { code: exitCode, stdout, stderr };
}

export interface FixtureHelpers {
  readonly root: string;
  write(relPath: string, content: string): void;
}

/**
 * Create a temp fixture directory, run `fn` with write helpers, and clean up.
 *
 * Surfaces BOTH fn and cleanup failures: when fn throws AND cleanup also
 * throws, neither error is silently dropped — they are combined into an
 * AggregateError so both stay observable (issue #2606 contract: cleanup
 * failures must not be swallowed, masking real failures or leaking temp
 * dirs across CI runs). A cleanup-only failure is rethrown after the block.
 */
export async function withFixture(
  fn: (helpers: FixtureHelpers) => Promise<ScriptResult>,
): Promise<ScriptResult> {
  const root = mkdtempSync(join(tmpdir(), 'legacy-paths-'));
  let fnError: unknown;
  let result: ScriptResult | undefined;
  let cleanupError: unknown;
  try {
    const write = (relPath: string, content: string): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    result = await fn({ root, write });
  } catch (error) {
    // Capture the fn error without throwing inside the try so the cleanup
    // still runs; rethrow decisions happen after cleanup completes.
    fnError = error;
  }
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  // Combine failures so neither is silently dropped. When both fn and
  // cleanup failed, AggregateError preserves both for diagnosis.
  if (fnError !== undefined && cleanupError !== undefined) {
    const fnMsg = fnError instanceof Error ? fnError.message : String(fnError);
    const cleanupMsg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new AggregateError(
      [fnError, cleanupError],
      `[legacy-paths] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
    );
  }
  if (cleanupError !== undefined) {
    const msg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new Error(`[legacy-paths] temp cleanup failed for ${root}: ${msg}`);
  }
  if (fnError !== undefined) {
    throw fnError;
  }
  return result!;
}
