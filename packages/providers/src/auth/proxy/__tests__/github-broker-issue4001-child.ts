/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from 'node:fs';
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
 * argv[2] is a JSON request: { op, params, workingDirectory? }. Prints one
 * JSON line: { cwdReadable, outcome } where outcome is either
 * { ok: true, result } or { ok: false, code, message }.
 */

const requestSchema = z.object({
  op: z.string(),
  params: z.record(z.unknown()),
  workingDirectory: z.string().optional(),
});

function parseRequest(raw: string | undefined): z.infer<typeof requestSchema> {
  if (raw === undefined) throw new Error('missing request argument');
  return requestSchema.parse(JSON.parse(raw));
}

/** Removes the process cwd; returns whether process.cwd() still works. */
function removeOwnCwd(): boolean {
  const doomed = mkdtempSync(join(tmpdir(), 'gh4001-doomed-'));
  process.chdir(doomed);
  rmSync(doomed, { recursive: true });
  try {
    process.cwd();
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const request = parseRequest(process.argv[2]);
  const cwdReadable = removeOwnCwd();
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
      `${JSON.stringify({ cwdReadable, outcome: { ok: true, result } })}\n`,
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
    process.stdout.write(`${JSON.stringify({ cwdReadable, outcome })}\n`);
  }
}

await main();
