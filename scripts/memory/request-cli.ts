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
 * poller picks it up within its poll interval. This command reports where the
 * request was queued and where to inspect the probe log — it does NOT claim the
 * request has already been processed.
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { REQUEST_DIR_NAME, type RequestKind, queueRequest } from './request.ts';
import { resolveActiveRunDir } from './paths.ts';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, '..', '..');

const USAGE = `Usage: npm run mem:request [--heap] [--dir <run>]

  (default)   queue a sample request
  --heap      queue a heap snapshot request (the session must be armed with --snapshots)
  --dir <run> target a specific run directory instead of .memprofile/latest`;

export class RequestCliParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCliParseError';
  }
}

export interface RequestCliOptions {
  readonly kind: RequestKind;
  readonly dir: string | undefined;
}

/**
 * Parses request CLI argv, failing fast on anything unrecognized. `--dir`
 * must be followed by a non-flag value. Exported for testing.
 */
export function parseRequestArgs(argv: readonly string[]): RequestCliOptions {
  let kind: RequestKind = 'sample';
  let dir: string | undefined;
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
  return { kind, dir };
}

function main(): void {
  let options: RequestCliOptions;
  try {
    options = parseRequestArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}\n`,
    );
    process.exit(2);
  }
  // Reject dead runs (exited probe, failed start, stale/malformed lease)
  // instead of queueing a request that nothing will ever process.
  const runDir = resolveActiveRunDir({
    explicit: options.dir,
    memprofileRoot: join(repoRoot, '.memprofile'),
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
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}
