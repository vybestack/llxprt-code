/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { executeGitHubOp } from '../github-broker.js';
import { BrokerErrorException } from '../github-broker-errors.js';

/**
 * Child process for github-broker-issue4001.test.ts (issue #4001).
 *
 * It reproduces the incident: the process's own working directory is removed
 * out from under it, then the real executeGitHubOp runs. This must happen in
 * a child so the test runner's cwd stays valid.
 *
 * argv[2] is a JSON request: { op, params, workingDirectory?, cwdState? }.
 * `cwdState` is "deleted" (default) or "inaccessible": the cwd is kept but
 * made unreadable (mode 0o000), which `process.cwd()` still reports.
 * `tmpdirState: "inaccessible"` points TMPDIR at a directory with mode 0o000.
 * Prints one JSON line: { cwdReadable, outcome } where outcome is either
 * { ok: true, result } or { ok: false, code, message }.
 */

const requestSchema = z.object({
  op: z.string(),
  params: z.record(z.unknown()),
  workingDirectory: z.string().optional(),
  cwdState: z.enum(['deleted', 'inaccessible']).optional(),
  tmpdirState: z.literal('inaccessible').optional(),
});

function parseRequest(raw: string | undefined): z.infer<typeof requestSchema> {
  if (raw === undefined) throw new Error('missing request argument');
  return requestSchema.parse(JSON.parse(raw));
}

/** Reports whether process.cwd() still works. */
function cwdReadable(): boolean {
  try {
    process.cwd();
    return true;
  } catch {
    return false;
  }
}

/** Removes the process cwd; returns whether process.cwd() still works. */
function removeOwnCwd(): boolean {
  const doomed = mkdtempSync(join(tmpdir(), 'gh4001-doomed-'));
  process.chdir(doomed);
  rmSync(doomed, { recursive: true });
  return cwdReadable();
}

/**
 * Enters a fresh directory and removes all permissions from it. Returns the
 * directory so the caller can restore it before exiting.
 */
function lockOwnCwd(): string {
  const locked = mkdtempSync(join(tmpdir(), 'gh4001-locked-'));
  process.chdir(locked);
  chmodSync(locked, 0o000);
  return locked;
}

/** Makes os.tmpdir() resolve to a directory nobody can enter. */
function lockTmpdir(): string {
  const locked = mkdtempSync(join(tmpdir(), 'gh4001-locked-tmp-'));
  chmodSync(locked, 0o000);
  process.env.TMPDIR = locked;
  return locked;
}

function removeLocked(locked: string): void {
  chmodSync(locked, 0o700);
  rmSync(locked, { recursive: true, force: true });
}

async function main(): Promise<void> {
  const request = parseRequest(process.argv[2]);
  const scratchRoot = tmpdir();
  const locked = request.cwdState === 'inaccessible' ? lockOwnCwd() : undefined;
  const readable = locked === undefined ? removeOwnCwd() : cwdReadable();
  const lockedTmp =
    request.tmpdirState === 'inaccessible' ? lockTmpdir() : undefined;
  const signal = new AbortController().signal;
  try {
    const result = await executeGitHubOp(
      request.op,
      request.params,
      signal,
      request.workingDirectory === undefined
        ? undefined
        : { workingDirectory: request.workingDirectory },
    );
    process.stdout.write(
      `${JSON.stringify({ cwdReadable: readable, outcome: { ok: true, result } })}\n`,
    );
  } catch (error) {
    const outcome =
      error instanceof BrokerErrorException
        ? {
            ok: false,
            code: error.brokerError.code,
            message: error.brokerError.message,
          }
        : { ok: false, code: 'UNSTRUCTURED', message: String(error) };
    process.stdout.write(
      `${JSON.stringify({ cwdReadable: readable, outcome })}\n`,
    );
  } finally {
    // Restore permissions last so the scratch directories can be removed.
    if (lockedTmp !== undefined) removeLocked(lockedTmp);
    if (locked !== undefined) {
      process.chdir(scratchRoot);
      removeLocked(locked);
    }
  }
}

await main();
