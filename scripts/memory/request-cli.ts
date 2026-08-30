/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Queues a sample or snapshot request to a running memprofile session.
 *
 *   npm run mem:request                  # queue a sample
 *   npm run mem:request -- --heap        # queue a heap snapshot (needs --snapshots)
 *   npm run mem:request -- --dir <run>   # target a specific run directory
 *
 * It writes a JSON request file into the run's requests/ directory; the probe's
 * poller picks it up within its poll interval. By default the command reports
 * where the request was queued. With --wait it reports durable processing, which
 * can include a policy refusal recorded in probe.log.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  REQUEST_DIR_NAME,
  isRequestDone,
  type RequestKind,
  queueRequest,
} from './request.ts';
import { isSourceMemoryEntrypoint } from './entrypoint.ts';
import { resolveActiveRunDir } from './paths.ts';

const sourceScriptDir = dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = join(sourceScriptDir, '..', '..');
const REQUEST_WAIT_TIMEOUT_MS = 30_000;
const REQUEST_WAIT_POLL_MS = 50;

export const SOURCE_REQUEST_USAGE = `Usage: npm run mem:request [--heap] [--dir <run>] [--wait]

  (default)   queue a sample request
  --heap      queue a heap snapshot request (the session must be armed with --snapshots)
  --dir <run> target a specific run directory instead of .memprofile/latest
  --wait      wait up to 30 seconds for the probe's durable completion marker`;

export const INSTALLED_REQUEST_USAGE = `Usage: llxprt memprofile request [--heap] [--dir <run>] [--wait]

  (default)   queue a sample request
  --heap      queue a heap snapshot request (the session must be armed with --memprofile-snapshots)
  --dir <run> target a specific run directory instead of the latest installed run
  --wait      wait up to 30 seconds for the probe's durable completion marker`;

export interface RequestCliRuntime {
  readonly usage: string;
  readonly memprofileRoot: string;
  readonly startCommandHint?: string;
  readonly argv?: readonly string[];
  readonly waitTimeoutMs?: number;
  readonly waitPollMs?: number;
}

export class RequestCliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCliParseError';
  }
}

export interface RequestCliOptions {
  readonly kind: RequestKind;
  readonly dir: string | undefined;
  readonly wait: boolean;
}

/**
 * Parses request CLI argv, failing fast on anything unrecognized. `--dir`
 * must be followed by a non-flag value. Exported for testing.
 */
export function parseRequestArgs(argv: readonly string[]): RequestCliOptions {
  let kind: RequestKind = 'sample';
  let dir: string | undefined;
  let wait = false;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      throw new RequestCliParseError(
        'this command takes no positional arguments (nothing to pass through)',
      );
    } else if (arg === '--heap') {
      kind = 'snapshot';
      i += 1;
    } else if (arg === '--wait') {
      wait = true;
      i += 1;
    } else if (arg === '--dir') {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new RequestCliParseError('missing value for --dir');
      }
      if (value.length === 0 || value.startsWith('-')) {
        throw new RequestCliParseError(
          `invalid value for --dir: ${value} (expected a non-flag value)`,
        );
      }
      dir = value;
      i += 2;
    } else {
      throw new RequestCliParseError(`unknown option: ${arg}`);
    }
  }
  return { kind, dir, wait };
}

async function waitForRequestCompletion(
  runDir: string,
  requestId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (isRequestDone(runDir, requestId)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
  throw new Error(
    `timed out waiting for probe completion of request ${requestId}`,
  );
}

export async function runRequestCli(runtime: RequestCliRuntime): Promise<void> {
  let options: RequestCliOptions;
  try {
    options = parseRequestArgs(runtime.argv ?? process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${runtime.usage}\n`,
    );
    process.exit(2);
  }
  const runDir = resolveActiveRunDir({
    explicit: options.dir,
    memprofileRoot: runtime.memprofileRoot,
    startCommandHint: runtime.startCommandHint,
  });
  const requestDir = join(runDir, REQUEST_DIR_NAME);
  const queued = queueRequest(options.kind, {
    requestDir,
    now: () => Date.now(),
    random: () => Math.random(),
    pid: process.pid,
  });
  process.stdout.write(
    `Queued ${options.kind} request ${queued.request.id} in ${requestDir}.\n`,
  );
  process.stdout.write(
    'The probe polls for requests; check completion and refusals in ' +
      `${join(runDir, 'probe.log')}.\n`,
  );
  if (options.wait) {
    await waitForRequestCompletion(
      runDir,
      queued.request.id,
      runtime.waitTimeoutMs ?? REQUEST_WAIT_TIMEOUT_MS,
      runtime.waitPollMs ?? REQUEST_WAIT_POLL_MS,
    );
    process.stdout.write(
      `Probe finished handling request ${queued.request.id}. Check ${join(runDir, 'probe.log')} for completion or refusal details.\n`,
    );
  }
}

export async function runRequestCliMain(
  runtime: RequestCliRuntime,
): Promise<void> {
  try {
    await runRequestCli(runtime);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

if (isSourceMemoryEntrypoint(import.meta.url)) {
  void runRequestCliMain({
    usage: SOURCE_REQUEST_USAGE,
    memprofileRoot: join(sourceRepoRoot, '.memprofile'),
  });
}
