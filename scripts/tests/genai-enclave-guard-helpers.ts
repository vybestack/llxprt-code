/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers for the genai-enclave guard behavioral tests.
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
export const SCRIPT = join(REPO_ROOT, 'scripts', 'check-genai-enclave.ts');
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
 * Run the guard script against `root` (a temp fixture root). Returns exit
 * code, stdout, stderr.
 */
export function runScript(
  root: string,
  expectedCode?: number,
): Promise<ScriptResult> {
  const env = { ...process.env, GENAI_ENCLAVE_ROOT: root };
  return runGuard(env, 30_000, 10 * 1024 * 1024, expectedCode);
}

/**
 * Run the guard script against the real repository (no GENAI_ENCLAVE_ROOT).
 */
export function runScriptRealRepo(
  expectedCode?: number,
): Promise<ScriptResult> {
  const env = { ...process.env };
  delete env.GENAI_ENCLAVE_ROOT;
  return runGuard(env, 60_000, 20 * 1024 * 1024, expectedCode);
}

export function runScriptWithMaxBuffer(
  root: string,
  maxBuffer: number,
  expectedCode?: number,
): Promise<ScriptResult> {
  const env = { ...process.env, GENAI_ENCLAVE_ROOT: root };
  return runGuard(env, 30_000, maxBuffer, expectedCode);
}

async function runGuard(
  env: NodeJS.ProcessEnv,
  timeout: number,
  maxBuffer: number,
  expectedCode?: number,
): Promise<ScriptResult> {
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    const result = await execFileAsync(RUNTIME, [SCRIPT], {
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
          `(${err.systemCode}). This is an operational harness failure, not a ` +
          `guard exit — output was truncated. Original: ${err.message}`,
      );
    }
    if (err.signal === 'SIGTERM' || err.systemCode === 'ETIMEDOUT') {
      throw new Error(
        `Guard script timed out after ${timeout / 1000}s (SIGTERM/ETIMEDOUT).`,
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
 * The exact version string the guard requires for sanctioned workspaces.
 * Imported from the source-of-truth config module to prevent drift between
 * config and tests.
 */
import { SANCTIONED_GENAI_VERSION } from '../genai-enclave/config.ts';
const SANCTIONED_VERSION = SANCTIONED_GENAI_VERSION;

/**
 * Write the three required `package.json` manifests (root, core, providers)
 * with correct `@google/genai` dependency declarations so the guard's
 * manifest enforcement (F4/F10) does not fail-closed on absent manifests.
 *
 * Positive tests that expect exit code 0 must call this before running the
 * guard, because the guard treats a missing required manifest as an
 * operational error (fail-closed).
 */
export function writeRequiredManifests(write: FixtureHelpers['write']): void {
  const manifest = {
    dependencies: { '@google/genai': SANCTIONED_VERSION },
  };
  write('package.json', JSON.stringify(manifest, null, 2) + '\n');
  write('packages/core/package.json', JSON.stringify(manifest, null, 2) + '\n');
  write(
    'packages/providers/package.json',
    JSON.stringify(manifest, null, 2) + '\n',
  );
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
  const root = mkdtempSync(join(tmpdir(), 'genai-enclave-'));
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
    // Capture the fn error without throwing inside the try so the finally
    // cleanup still runs; rethrow decisions happen after cleanup completes.
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
      `[genai-enclave] fn failed (${fnMsg}) AND temp cleanup failed for ${root}: ${cleanupMsg}`,
    );
  }
  if (cleanupError !== undefined) {
    const msg =
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError);
    throw new Error(`[genai-enclave] temp cleanup failed for ${root}: ${msg}`);
  }
  if (fnError !== undefined) {
    throw fnError;
  }
  return result!;
}

// ─── Fixture content helpers ────────────────────────────────────────────────

export const GEMINI_IMPORT =
  "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n";
