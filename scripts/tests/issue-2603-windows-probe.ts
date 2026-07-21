#!/usr/bin/env -S bun

/**
 * Instrumented entry-point probe for the Windows installed-command smoke
 * (issue #2603).
 *
 * The launcher under test invokes `bun.exe <index.ts> %*`. Replacing the
 * installed package's index.ts with this probe (in a TEMP fixture only — the
 * replica tarball itself is never mutated) makes the probe the child that
 * bun.exe executes.
 *
 * Request protocol (passed as regular args, forwarded by %*):
 *   LLXPRT_PROBE=<json>  where <json> is { stdin?, stderr?, exit?, long?, injectionPath? }.
 * The JSON is matched as a single argv token so quoting/Unicode/fidelity is
 * preserved verbatim.
 */

import { readFileSync, writeFileSync } from 'node:fs';

interface ProbeRequest {
  stdin?: boolean;
  stderr?: string;
  exit?: number;
  long?: boolean;
  injectionPath?: string;
}

function parseRequest(): {
  request: ProbeRequest;
  raw: string;
  malformed: boolean;
} {
  const request: ProbeRequest = {};
  let raw = '';
  let malformed = false;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('LLXPRT_PROBE=')) {
      raw = arg.slice('LLXPRT_PROBE='.length);
      try {
        const parsed = JSON.parse(raw) as ProbeRequest;
        Object.assign(request, parsed);
      } catch {
        // Malformed request payload: preserve the raw value for diagnostics
        // rather than silently dropping it, so the caller can see what went
        // wrong.
        malformed = true;
      }
    }
  }
  return { request, raw, malformed };
}

function readStdinSync(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Writes the payload and waits for stdout to drain so the parent process
 * captures the complete JSON before any process.exit. Without this, buffered
 * stdout on Windows pipes can be truncated when the process exits.
 */
async function emitAndFlush(payload: Record<string, unknown>): Promise<void> {
  process.stdout.write(JSON.stringify(payload));
  await drainStdout();
}

/**
 * Resolves once the stdout stream has flushed its buffered writes. On streams
 * without a draining event (already drained), resolves immediately.
 */
function drainStdout(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.writableEnded) {
      resolve();
      return;
    }
    process.stdout.write('', () => resolve());
  });
}

async function main(): Promise<void> {
  const { request, raw, malformed } = parseRequest();

  const payload: Record<string, unknown> = {
    argv: process.argv,
    execPath: process.execPath,
    bunVersion:
      typeof process.versions.bun === 'string' ? process.versions.bun : '',
  };

  // Preserve malformed raw diagnostics so the caller can see the unparseable
  // payload instead of an opaque "no JSON object" error.
  if (malformed) {
    payload.malformed = true;
    payload.raw = raw;
  }

  payload.stdin = request.stdin ? readStdinSync() : '';

  if (request.stderr !== undefined) {
    process.stderr.write(request.stderr);
  }

  if (request.injectionPath) {
    try {
      writeFileSync(request.injectionPath, 'INJECTED');
      payload.injectionCreated = true;
    } catch {
      payload.injectionCreated = false;
    }
  }

  if (request.long) {
    await emitAndFlush(payload);
    process.stdout.write('\n__LLXPRT_PROBE_LONG_RUNNING__\n');
    await drainStdout();
    const handler = (): void => {
      // Drain before exiting so the parent captures the full payload. Without
      // this, process.exit can truncate buffered stdout on Windows pipes.
      // Remove the listeners after settling so the process does not hold
      // lingering handlers that would interfere with a clean exit.
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      void drainStdout().then(() => process.exit(0));
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
    await new Promise<void>(() => {
      // never resolves; resolved by signal handler above
    });
    return;
  }

  await emitAndFlush(payload);
  if (typeof request.exit === 'number') {
    await drainStdout();
    process.exit(request.exit);
  }
}

void main();
