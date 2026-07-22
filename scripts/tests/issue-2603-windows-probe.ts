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
 *   LLXPRT_PROBE_B64=<base64url-json>
 * Encoding keeps the control payload independent from shell quoting while
 * separate probe arguments exercise exact argv fidelity.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const nativeRequire = createRequire(import.meta.url);

interface ProbeRequest {
  stdin?: boolean;
  stderr?: string;
  exit?: number;
  nativeExit?: number;
  long?: boolean;
}

/**
 * Interval for the keep-alive handle in the long-running probe mode. Extracted
 * to a named constant so the value is documented and CI-specific tuning is
 * straightforward.
 */
const KEEP_ALIVE_INTERVAL_MS = 60_000;

function parseRequest(): {
  request: ProbeRequest;
  raw: string;
  malformed: boolean;
  count: number;
} {
  const request: ProbeRequest = {};
  let raw = '';
  let malformed = false;
  let count = 0;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('LLXPRT_PROBE_B64=')) {
      count++;
      raw = Buffer.from(
        arg.slice('LLXPRT_PROBE_B64='.length),
        'base64url',
      ).toString('utf8');
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
  return { request, raw, malformed, count };
}

function readStdinSync(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Validates that a value is a finite uint32 integer, returning it as a
 * number. Used for nativeExit so a malformed payload cannot drive FFI with
 * an out-of-range status.
 */
function asUint32(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 0 || value > 0xffffffff) return null;
  return value;
}

/**
 * Terminates the current process with the full uint32 exit status via the
 * Windows ExitProcess API, loaded through Bun FFI against kernel32.dll.
 *
 * Bun's process.exit() truncates the exit code modulo 256 (it is modeled on
 * the POSIX _exit contract), so a genuine 32-bit Windows process exit status
 * like 9009 cannot be expressed through process.exit(). ExitProcess takes a
 * UINT (uint32) and sets the process exit code directly, so the launcher/OS
 * path is exercised with the exact value the host observes.
 *
 * Guarded to win32: on any other platform this throws, since ExitProcess only
 * exists in kernel32.dll. The payload must be flushed before calling so the
 * parent captures the complete JSON before the process terminates.
 */
function nativeExitWithStatus(status: number): never {
  if (process.platform !== 'win32') {
    throw new Error(
      `nativeExitWithStatus: only supported on win32 (platform=${process.platform})`,
    );
  }
  // Dynamic require keeps the non-Windows and non-native test paths free of
  // bun:ffi so this module loads under Node/vitest on macOS without the FFI
  // loader. ExitProcess only exists in kernel32.dll on Windows, so this branch
  // is unreachable off win32. bun:ffi has no ESM export; require is the only
  // way to load it under Bun.
  const { dlopen } = nativeRequire('bun:ffi') as {
    dlopen: <Fns extends Record<string, unknown>>(
      name: string,
      symbols: Fns,
    ) => {
      symbols: { ExitProcess: (status: number) => undefined };
      close: () => void;
    };
  };
  const lib = dlopen('kernel32.dll', {
    ExitProcess: { args: ['u32'], returns: 'void' },
  });
  // ExitProcess does not return; this call terminates the process.
  lib.symbols.ExitProcess(status >>> 0);
  // Unreachable, but satisfies the `never` return type for the analyzer.
  throw new Error('nativeExitWithStatus: ExitProcess did not terminate');
}

/**
 * Writes the payload and waits for stdout to drain so the parent process
 * captures the complete JSON before any process.exit. Without this, buffered
 * stdout on Windows pipes can be truncated when the process exits.
 */
/**
 * The dedicated probe line prefix emitted before the JSON payload. Using a
 * sentinel makes extraction robust against interleaved log output or warnings
 * that may appear on stdout alongside the payload.
 */
const PROBE_SENTINEL = 'LLXPRT_PROBE:';

async function emitAndFlush(payload: Record<string, unknown>): Promise<void> {
  process.stdout.write(`${PROBE_SENTINEL}${JSON.stringify(payload)}
`);
  await drainStdout();
}

/**
 * Resolves once the stdout stream has flushed its buffered writes. On streams
 * without a draining event (already drained), resolves immediately. Handles
 * stream errors (broken pipe, stream destroyed) so the promise never hangs.
 */
function drainStdout(): Promise<void> {
  return new Promise((resolve) => {
    if (process.stdout.writableEnded) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      process.stdout.removeListener('error', onError);
      resolve();
    };
    const onError = (): void => {
      if (settled) return;
      settled = true;
      // A broken pipe / destroyed stream means the parent is gone; resolve so
      // we never hang waiting for a flush that can never complete.
      resolve();
    };
    process.stdout.once('error', onError);
    process.stdout.write('', finish);
  });
}

async function main(): Promise<void> {
  const { request, raw, malformed, count } = parseRequest();

  const payload: Record<string, unknown> = {
    argv: process.argv,
    execPath: process.execPath,
    bunVersion:
      typeof process.versions.bun === 'string' ? process.versions.bun : '',
    // Report the Bun process's own PID and its parent PID so the harness can
    // walk a bounded ancestry chain back to the spawned launcher root instead
    // of relying on a racy descendants-only snapshot.
    pid: typeof process.pid === 'number' ? process.pid : null,
    ppid: typeof process.ppid === 'number' ? process.ppid : null,
  };

  // Preserve malformed raw diagnostics so the caller can see the unparseable
  // payload instead of an opaque "no JSON object" error.
  if (malformed) {
    payload.malformed = true;
    payload.raw = raw;
  }
  // Distinguish a misconfigured invocation (zero or duplicate control
  // payloads) from a genuine success. All callers send exactly one payload;
  // any other count surfaces as a distinct diagnostic field so the parent
  // process detects the misconfiguration instead of treating it as success.
  if (count !== 1) {
    payload.probeError =
      count === 0
        ? 'no LLXPRT_PROBE_B64 argument provided'
        : `${count} LLXPRT_PROBE_B64 arguments provided (expected exactly 1)`;
  }

  payload.stdin = request.stdin ? readStdinSync() : '';

  if (request.stderr !== undefined) {
    process.stderr.write(request.stderr);
  }

  if (request.long) {
    await emitAndFlush(payload);
    process.stdout.write('\n__LLXPRT_PROBE_LONG_RUNNING__\n');
    await drainStdout();
    // Keep the process alive with an actual active handle. An unresolved
    // promise alone does not keep a JS runtime alive; Bun exits once there
    // are no pending handles, which made the reported PID stale by the time
    // the harness queried it. A long interval is an active handle that keeps
    // the process resident until the signal handler clears it and exits.
    const keepAlive = setInterval(() => {
      // no-op: the handle's existence, not its work, keeps the process alive
    }, KEEP_ALIVE_INTERVAL_MS);
    // NOTE: do NOT unref() this interval — an unref'd handle does not keep the
    // process alive, which is exactly the bug we are fixing.
    const handler = (): void => {
      // Drain before exiting so the parent captures the full payload. Without
      // this, process.exit can truncate buffered stdout on Windows pipes.
      // Remove the listeners and clear the keep-alive handle after settling so
      // the process does not hold lingering handlers/active handles that would
      // interfere with a clean exit.
      process.removeListener('SIGINT', handler);
      process.removeListener('SIGTERM', handler);
      clearInterval(keepAlive);
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
  // nativeExit routes exit codes that process.exit() cannot express (it
  // truncates modulo 256) through the Windows ExitProcess API so the full
  // uint32 status is observed by the host. For 9009 specifically, this tests
  // the genuine 32-bit Windows process exit path. The payload is flushed
  // before the native exit so the parent captures the complete JSON.
  const nativeStatus = asUint32(request.nativeExit);
  if (nativeStatus !== null) {
    if (process.platform === 'win32') {
      await drainStdout();
      nativeExitWithStatus(nativeStatus);
    }
    // Non-Windows: fall back to process.exit with the truncated value so the
    // request still terminates (hosted CI is the behavioral source of truth).
    await drainStdout();
    process.exit(nativeStatus & 0xff);
  }
  if (typeof request.exit === 'number') {
    await drainStdout();
    process.exit(request.exit);
  }
}

void main().catch((err: unknown) => {
  // Ensure an unexpected rejection exits non-zero with a diagnostic so the
  // parent process sees a clear failure rather than an unhandled rejection.
  process.stderr.write(
    `LLXPRT_PROBE_FATAL: ${err instanceof Error ? err.message : String(err)}
`,
  );
  process.exit(1);
});
