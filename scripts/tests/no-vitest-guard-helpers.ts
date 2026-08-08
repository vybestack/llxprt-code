/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers for the no-vitest guard behavioral tests (issue #2970).
 *
 * These helpers invoke the real guard script via a synchronous child process
 * (no mock theater) and manage temp-fixture creation/cleanup, mirroring the
 * fixture-tree style of scripts/tests/legacy-paths-guard-helpers.ts.
 *
 * Output capture (issue #2970): Bun's spawnSync/execFile cannot reliably
 * capture child process stdout under bun:test — the pipe/FD data is lost
 * regardless of exit code. Instead of a shell redirect (command-injection
 * risk, Windows incompatibility), the guard writes its report to a temp
 * file via the NO_VITEST_OUTPUT_FILE env var (synchronous writeFileSync,
 * committed before process.exit). The helper passes that file path, runs
 * the guard with stdio: 'ignore' (no shell, no pipes), and reads the file
 * back. This is portable, injection-free, and reliable.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
export const SCRIPT = join(REPO_ROOT, 'scripts', 'check-no-vitest.ts');
export const RUNTIME = process.env.BUN_EXECUTABLE || 'bun';

/** Root-override env var understood by scripts/check-no-vitest.ts. */
export const ROOT_ENV_VAR = 'NO_VITEST_ROOT';

/** Output-file env var understood by scripts/check-no-vitest.ts. */
const OUTPUT_FILE_ENV_VAR = 'NO_VITEST_OUTPUT_FILE';

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

let captureCounter = 0;

/**
 * Run the guard script with direct argument passing (no shell). The guard
 * writes its report to a temp file via NO_VITEST_OUTPUT_FILE (synchronous
 * writeFileSync, committed before process.exit). Returns exit code, stdout
 * (read from the output file), stderr (always empty — the guard does not
 * write to stderr).
 *
 * Spawn errors and signal kills always throw so a broken harness never looks
 * like a passing test (issue #2970 item E).
 */
function runGuardSync(
  env: NodeJS.ProcessEnv,
  timeout: number,
  expectedCode: number | undefined,
): ScriptResult {
  const id = `${process.pid}-${Date.now()}-${captureCounter++}`;
  const tmpOut = join(tmpdir(), `nvtest-out-${id}.txt`);

  let code = 0;
  let stdout = '';

  try {
    const childEnv = { ...env, [OUTPUT_FILE_ENV_VAR]: tmpOut };

    const result = spawnSync(RUNTIME, [SCRIPT], {
      cwd: REPO_ROOT,
      env: childEnv,
      encoding: 'utf8',
      timeout,
      stdio: 'ignore',
    });

    // A spawn error (ENOENT, EACCES, etc.) must always throw — never silently
    // fall through to code 1 which would look like a legitimate guard failure
    // (issue #2970 item E).
    if (result.error !== undefined) {
      const msg =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      throw new Error(`Guard script failed to spawn: ${msg}`);
    }

    // A kill by any signal must throw naming the signal so a broken harness
    // is never mistaken for a guard failure (issue #2970 item E). SIGTERM is
    // the spawnSync timeout signal.
    if (result.signal !== null && result.signal !== undefined) {
      if (result.signal === 'SIGTERM') {
        throw new Error(`Guard script timed out after ${timeout / 1000}s.`);
      }
      throw new Error(`Guard script was killed by signal ${result.signal}.`);
    }

    code = result.status ?? 1;

    // Read the guard's output from the file (written synchronously before
    // process.exit, bypassing Bun's unreliable pipe capture under bun:test).
    stdout = existsSync(tmpOut) ? readFileSync(tmpOut, 'utf8') : '';
  } finally {
    try {
      rmSync(tmpOut, { force: true });
    } catch {
      // Best-effort cleanup.
    }
  }

  if (expectedCode !== undefined && code !== expectedCode) {
    throw new Error(
      `Guard script exited with code ${code}, expected ${expectedCode}.` +
        (stdout ? `\nstdout:\n${stdout}` : ''),
    );
  }

  return { code, stdout, stderr: '' };
}

/**
 * Run the guard script against a temp fixture root.
 */
export function runScript(root: string, expectedCode?: number): ScriptResult {
  const env = { ...process.env, [ROOT_ENV_VAR]: root };
  return runGuardSync(env, 30_000, expectedCode);
}

/**
 * Run the guard script against the real repository (no root override).
 */
export function runScriptRealRepo(expectedCode?: number): ScriptResult {
  const env = { ...process.env };
  delete (env as Record<string, string | undefined>)[ROOT_ENV_VAR];
  return runGuardSync(env, 60_000, expectedCode);
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
 * AggregateError so both stay observable.
 */
export function withFixture(
  fn: (helpers: FixtureHelpers) => ScriptResult,
): ScriptResult {
  const root = mkdtempSync(join(tmpdir(), 'no-vitest-'));
  let fnError: unknown;
  let result: ScriptResult | undefined;
  let cleanupError: unknown;
  try {
    const write = (relPath: string, content: string): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    result = fn({ root, write });
  } catch (error) {
    fnError = error;
  }
  try {
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    cleanupError = error;
  }
  if (fnError !== undefined && cleanupError !== undefined) {
    const fnMsg = fnError instanceof Error ? fnError.message : String(fnError);
    const cleanupMsg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new AggregateError(
      [fnError, cleanupError],
      `[no-vitest] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
    );
  }
  if (cleanupError !== undefined) {
    const msg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new Error(`[no-vitest] temp cleanup failed for ${root}: ${msg}`);
  }
  if (fnError !== undefined) {
    throw fnError;
  }
  return result!;
}
