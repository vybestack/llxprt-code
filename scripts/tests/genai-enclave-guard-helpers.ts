/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers for the genai-enclave guard behavioral tests.
 *
 * These helpers invoke the real guard script via execFileSync (no mock
 * theater) and manage temp-fixture creation/cleanup.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, '..', '..');
export const SCRIPT = join(REPO_ROOT, 'scripts', 'check-genai-enclave.ts');
export const INVENTORY_SCRIPT = join(
  REPO_ROOT,
  'scripts',
  'genai-import-inventory.ts',
);
export const RUNTIME = process.env.BUN_EXECUTABLE ?? 'bun';

export const missingBunMessage =
  '[genai-enclave] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

let cachedBunAvailable: boolean | undefined;

export function bunAvailable(): boolean {
  if (cachedBunAvailable !== undefined) {
    return cachedBunAvailable;
  }
  try {
    execFileSync(RUNTIME, ['--version'], {
      encoding: 'utf8',
      timeout: 15_000,
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
  status: number | null;
  signal?: string;
  code?: string;
  message: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

/**
 * Run the guard script against `root` (a temp fixture root). Returns exit
 * code, stdout, stderr.
 */
export function runScript(root: string, expectedCode?: number): ScriptResult {
  const env = { ...process.env, GENAI_ENCLAVE_ROOT: root };
  return runGuard(env, 30_000, 10 * 1024 * 1024, expectedCode);
}

/**
 * Run the guard script against the real repository (no GENAI_ENCLAVE_ROOT).
 */
export function runScriptRealRepo(expectedCode?: number): ScriptResult {
  const env = { ...process.env };
  delete env.GENAI_ENCLAVE_ROOT;
  return runGuard(env, 60_000, 20 * 1024 * 1024, expectedCode);
}

/**
 * Run the genai-import-inventory script with --check against the real repo.
 * Verifies the checked-in baseline matches the current set of @google/genai
 * importers (the #2352 enforcement ratchet).
 */
export function runInventoryCheck(): ScriptResult {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(RUNTIME, [INVENTORY_SCRIPT, '--check'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (error) {
    const err = error as ExecErrorLike;
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;
  }
  return { code: exitCode, stdout, stderr };
}

function runGuard(
  env: NodeJS.ProcessEnv,
  timeout: number,
  maxBuffer: number,
  expectedCode?: number,
): ScriptResult {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    stdout = execFileSync(RUNTIME, [SCRIPT], {
      cwd: REPO_ROOT,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      maxBuffer,
    });
  } catch (error) {
    const err = error as ExecErrorLike;
    const isTimeout =
      err.status === null &&
      (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT');
    if (isTimeout) {
      throw new Error(
        `Guard script timed out after ${timeout / 1000}s (SIGTERM/ETIMEDOUT).`,
      );
    }
    if (err.code === 'ENOENT') {
      throw new Error(
        `Guard script failed with ENOENT. Runtime "${RUNTIME}" not on PATH ` +
          `or script missing: ${SCRIPT}. Original: ${err.message}`,
      );
    }
    stdout = err.stdout ? err.stdout.toString() : '';
    stderr = err.stderr ? err.stderr.toString() : '';
    exitCode = err.status ?? 1;
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
 * Cleanup errors are emitted as warnings rather than thrown.
 */
export function withFixture(
  fn: (helpers: FixtureHelpers) => ScriptResult,
): ScriptResult {
  const root = mkdtempSync(join(tmpdir(), 'genai-enclave-'));
  let result: ScriptResult;
  try {
    const write = (relPath: string, content: string): void => {
      const full = join(root, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    };
    result = fn({ root, write });
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (cleanupError) {
      const msg =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      console.warn(
        `[genai-enclave] Warning: temp cleanup failed for ${root}: ${msg}`,
      );
    }
  }
  return result;
}

// ─── Fixture content helpers ────────────────────────────────────────────────

export const GEMINI_IMPORT =
  "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n";
