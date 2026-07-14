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
  readonly status?: number | null;
  readonly signal?: string;
  readonly code?: string;
  readonly message: string;
  readonly stdout?: string | Buffer;
  readonly stderr?: string | Buffer;
}

function toExecError(error: unknown): ExecErrorLike {
  if (typeof error !== 'object' || error === null) {
    return { message: String(error) };
  }
  const candidate = error as Record<string, unknown>;
  return {
    status:
      typeof candidate.status === 'number' || candidate.status === null
        ? candidate.status
        : undefined,
    signal: typeof candidate.signal === 'string' ? candidate.signal : undefined,
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    message:
      typeof candidate.message === 'string' ? candidate.message : String(error),
    stdout: isOutput(candidate.stdout) ? candidate.stdout : undefined,
    stderr: isOutput(candidate.stderr) ? candidate.stderr : undefined,
  };
}

function isOutput(value: unknown): value is string | Buffer {
  return typeof value === 'string' || Buffer.isBuffer(value);
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
    const err = toExecError(error);
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
