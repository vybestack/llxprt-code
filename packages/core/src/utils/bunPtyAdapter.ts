/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun.Terminal-backed PTY adapter.
 *
 * Under Bun on POSIX, `@lydell/node-pty` silently hangs: `pty.spawn()` returns
 * a valid pid but `onData`/`onExit` never fire (oven-sh/bun#25822 — Bun's
 * `tty.ReadStream` hits EAGAIN on the non-blocking PTY master fd). This adapter
 * bridges `Bun.spawn({ terminal })` onto the `IPty` contract that
 * `shellExecutionService` and the PTY lifecycle helpers consume.
 *
 * Key API facts (Bun >= 1.3.5, POSIX only):
 * - `data` is a **constructor callback** on `TerminalOptions`, not an instance
 *   method. We fan it out to registered `onData` listeners.
 * - The **real** exit code comes from `await Subprocess.exited`, not from the
 *   Terminal's own lifecycle status.
 * - `pid` comes from `Subprocess.pid`.
 */

import type { IPty, IDisposable } from '@lydell/node-pty';
import { DebugLogger } from '../debug/DebugLogger.js';

const logger = new DebugLogger('llxprt:shell:bunPtyAdapter');

/**
 * Minimal ambient declaration for the Bun globals this adapter touches.
 * Under Node these are never referenced (the adapter is only constructed when
 * `isBunPosix()` is true), so the loose typing is safe and avoids pulling in
 * Bun's type definitions as a build dependency.
 */
interface BunTerminalHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

interface BunSubprocess {
  readonly pid: number;
  readonly exited: Promise<number | null>;
  readonly terminal: BunTerminalHandle;
  kill(signal?: string | number): void;
}

interface BunTerminalOptions {
  cols: number;
  rows: number;
  name: string;
  data(terminal: BunTerminalHandle, chunk: Uint8Array): void;
}

interface BunSpawnFn {
  (
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      terminal: BunTerminalOptions;
    },
  ): BunSubprocess;
}

interface BunGlobal {
  spawn: BunSpawnFn;
}

type DataListener = (data: string) => void;
type ExitListener = (e: { exitCode: number; signal?: number }) => void;

/**
 * Grace period after sending a signal to the subprocess before synthesizing
 * an exit event. `subprocess.exited` almost always resolves faster than this
 * (it is a microtask), so the natural exit code wins and the fallback never
 * fires. The timer exists to guarantee that `onExit` is *eventually* called
 * even if `subprocess.exited` hangs (Bun runtime edge cases).
 */
const KILL_FALLBACK_TIMEOUT_MS = 200;
const SIGNAL_EXIT_CODES: Readonly<Record<string, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGKILL: 137,
  SIGTERM: 143,
};

/**
 * The args/env shape passed to {@link createBunPty}, matching the existing
 * `PtyModule.spawn` options.
 */
interface BunPtySpawnOptions {
  cwd?: string;
  name?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string | undefined>;
  /** Accepted for node-pty compatibility; Bun.Terminal manages flow control. */
  handleFlowControl?: boolean;
}

/**
 * Internal mutable state shared between the spawn closure and the adapter.
 */
interface ExitEvent {
  exitCode: number;
  signal?: number;
}

interface BunPtyState {
  terminalHandle: BunTerminalHandle | null;
  exitDispatched: boolean;
  pendingExit: ExitEvent | null;
  killFallbackTimer: ReturnType<typeof setTimeout> | null;
  decoderFinalized: boolean;
}

interface PtyDimensions {
  cols: number;
  rows: number;
}

function isExitErrorWithCode(error: unknown): error is { exitCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'exitCode' in error &&
    typeof error.exitCode === 'number'
  );
}

function signalFromExitCode(exitCode: number): number | undefined {
  if (exitCode > 128 && exitCode <= 159) {
    return exitCode - 128;
  }
  return undefined;
}

function clampExitCode(exitCode: number): number {
  return Math.max(0, Math.min(255, Math.trunc(exitCode)));
}

function normalizeExitCode(rawExitCode: number | null): number {
  if (rawExitCode === null) {
    return 1;
  }
  if (rawExitCode < 0) {
    return clampExitCode(128 + Math.abs(rawExitCode));
  }
  return clampExitCode(rawExitCode);
}

function dispatchExit(
  exitListeners: Set<ExitListener>,
  state: BunPtyState,
  exitCode: number,
): void {
  if (state.exitDispatched) {
    return;
  }
  if (state.killFallbackTimer) {
    clearTimeout(state.killFallbackTimer);
    state.killFallbackTimer = null;
  }
  state.exitDispatched = true;
  const signal = signalFromExitCode(exitCode);
  state.pendingExit =
    signal === undefined ? { exitCode } : { exitCode, signal };
  for (const cb of exitListeners) {
    try {
      cb(state.pendingExit);
    } catch (err) {
      logger.warn(
        'Exit listener threw; continuing to notify remaining listeners.',
        err,
      );
    }
  }
  exitListeners.clear();
}

/**
 * Spawn a Bun subprocess with a Terminal and wire its data callback to the
 * provided listener set. Returns the subprocess plus the mutable state the
 * adapter needs (terminal handle, exit flag).
 */
function spawnBunTerminal(
  bun: BunGlobal,
  file: string,
  args: string[],
  cwd: string | undefined,
  env: Record<string, string> | undefined,
  cols: number,
  rows: number,
  name: string,
  dataListeners: Set<DataListener>,
  decoder: TextDecoder,
  state: BunPtyState,
): BunSubprocess {
  const spawnArgs = [file, ...args];
  const subprocess = bun.spawn(spawnArgs, {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      name,
      data(terminal: BunTerminalHandle, chunk: Uint8Array): void {
        state.terminalHandle = terminal;
        if (state.decoderFinalized) {
          return;
        }
        const text = decoder.decode(chunk, { stream: true });
        for (const cb of dataListeners) {
          try {
            cb(text);
          } catch (err) {
            logger.warn(
              'Data listener threw; continuing to notify remaining listeners.',
              err,
            );
          }
        }
      },
    },
  });
  state.terminalHandle = subprocess.terminal;
  return subprocess;
}

function normalizeEnvironment(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => {
      const [, value] = entry;
      return value !== undefined;
    }),
  );
}

function closeTerminalHandle(state: BunPtyState): void {
  try {
    state.terminalHandle?.close();
  } catch (err) {
    logger.debug('Terminal handle close failed (may already be closed).', err);
  }
  state.terminalHandle = null;
}

function signalToExitCode(signal: string | undefined): number {
  if (!signal) {
    return SIGNAL_EXIT_CODES.SIGTERM;
  }
  return SIGNAL_EXIT_CODES[signal] ?? SIGNAL_EXIT_CODES.SIGTERM;
}

function clearKillFallbackTimer(state: BunPtyState): void {
  if (state.killFallbackTimer) {
    clearTimeout(state.killFallbackTimer);
    state.killFallbackTimer = null;
  }
}

function scheduleKillFallback(
  exitListeners: Set<ExitListener>,
  dataListeners: Set<DataListener>,
  decoder: TextDecoder,
  state: BunPtyState,
  signal: string | undefined,
): void {
  if (state.exitDispatched || state.killFallbackTimer) {
    return;
  }
  const timer = setTimeout(() => {
    emitDecoderTail(decoder, dataListeners, state);
    dataListeners.clear();
    dispatchExit(exitListeners, state, signalToExitCode(signal));
  }, KILL_FALLBACK_TIMEOUT_MS);
  timer.unref();
  state.killFallbackTimer = timer;
}

function emitDecoderTail(
  decoder: TextDecoder,
  dataListeners: Set<DataListener>,
  state: BunPtyState,
): void {
  if (state.decoderFinalized) {
    return;
  }
  state.decoderFinalized = true;
  const tail = decoder.decode();
  if (!tail) {
    return;
  }
  for (const listener of dataListeners) {
    try {
      listener(tail);
    } catch (err) {
      logger.warn(
        'Decoder tail listener threw; continuing to notify remaining listeners.',
        err,
      );
    }
  }
}

function subscribeToData(
  dataListeners: Set<DataListener>,
  state: BunPtyState,
  listener: DataListener,
): IDisposable {
  if (state.decoderFinalized) {
    return {
      dispose(): void {},
    };
  }
  dataListeners.add(listener);
  return {
    dispose(): void {
      dataListeners.delete(listener);
    },
  };
}

function subscribeToExit(
  exitListeners: Set<ExitListener>,
  state: BunPtyState,
  listener: ExitListener,
): IDisposable {
  if (state.pendingExit) {
    try {
      listener(state.pendingExit);
    } catch (err) {
      logger.warn('Exit listener threw during immediate replay.', err);
    }
    return {
      dispose(): void {},
    };
  }
  exitListeners.add(listener);
  return {
    dispose(): void {
      exitListeners.delete(listener);
    },
  };
}

function resizeTerminal(
  state: BunPtyState,
  dimensions: PtyDimensions,
  columns: number,
  rowDim: number,
): void {
  if (
    !Number.isFinite(columns) ||
    !Number.isFinite(rowDim) ||
    columns <= 0 ||
    rowDim <= 0
  ) {
    return;
  }
  dimensions.cols = columns;
  dimensions.rows = rowDim;
  try {
    if (!state.terminalHandle) {
      return;
    }
    state.terminalHandle.resize(columns, rowDim);
  } catch (err) {
    logger.debug('Terminal resize failed (terminal may be closed).', err);
  }
}

function writeToTerminal(state: BunPtyState, data: string): void {
  try {
    if (!state.terminalHandle) {
      return;
    }
    state.terminalHandle.write(data);
  } catch (err) {
    logger.debug('Terminal write failed (terminal may be closed).', err);
  }
}

function killSubprocess(subprocess: BunSubprocess, signal: string): void {
  try {
    subprocess.kill(signal);
  } catch (err) {
    logger.debug(
      'Subprocess kill failed (process may already be terminated).',
      err,
    );
  }
}

function killAndScheduleFallback(
  subprocess: BunSubprocess,
  exitListeners: Set<ExitListener>,
  dataListeners: Set<DataListener>,
  decoder: TextDecoder,
  state: BunPtyState,
  signal: string,
): void {
  killSubprocess(subprocess, signal);
  scheduleKillFallback(exitListeners, dataListeners, decoder, state, signal);
}

function destroyAndScheduleFallback(
  subprocess: BunSubprocess,
  exitListeners: Set<ExitListener>,
  dataListeners: Set<DataListener>,
  decoder: TextDecoder,
  state: BunPtyState,
): void {
  closeTerminalHandle(state);
  clearKillFallbackTimer(state);
  killSubprocess(subprocess, 'SIGKILL');
  scheduleKillFallback(exitListeners, dataListeners, decoder, state, 'SIGKILL');
}

/**
 * Build the IPty adapter object from the spawned subprocess and listener sets.
 */
function buildBunPtyAdapter(
  subprocess: BunSubprocess,
  file: string,
  dimensions: PtyDimensions,
  dataListeners: Set<DataListener>,
  exitListeners: Set<ExitListener>,
  decoder: TextDecoder,
  state: BunPtyState,
): IPty & { destroy(): void } {
  return {
    pid: subprocess.pid,
    get cols(): number {
      return dimensions.cols;
    },
    get rows(): number {
      return dimensions.rows;
    },
    process: file,
    handleFlowControl: false,
    onData(listener: DataListener): IDisposable {
      return subscribeToData(dataListeners, state, listener);
    },
    onExit(listener: ExitListener): IDisposable {
      return subscribeToExit(exitListeners, state, listener);
    },
    resize(columns: number, rowDim: number): void {
      resizeTerminal(state, dimensions, columns, rowDim);
    },
    clear(): void {
      // ConPTY-only no-op; Bun.Terminal has no equivalent buffer clear.
    },
    write(data: string): void {
      writeToTerminal(state, data);
    },
    kill(signal?: string): void {
      killAndScheduleFallback(
        subprocess,
        exitListeners,
        dataListeners,
        decoder,
        state,
        signal ?? 'SIGTERM',
      );
    },
    pause(): void {
      // No direct equivalent; node-pty consumers rarely call this.
    },
    resume(): void {
      // No direct equivalent; node-pty consumers rarely call this.
    },
    destroy(): void {
      destroyAndScheduleFallback(
        subprocess,
        exitListeners,
        dataListeners,
        decoder,
        state,
      );
    },
  };
}

/**
 * Wire subprocess.exited to the exit-listener fan-out. Converts both success
 * and rejection into a normalized exit code, catching handler errors so exit
 * delivery can never hang.
 */
function wireExitHandler(
  subprocess: BunSubprocess,
  exitListeners: Set<ExitListener>,
  dataListeners: Set<DataListener>,
  decoder: TextDecoder,
  state: BunPtyState,
): void {
  void subprocess.exited
    .then((rawExitCode: number | null) => {
      try {
        emitDecoderTail(decoder, dataListeners, state);
        dataListeners.clear();
        dispatchExit(exitListeners, state, normalizeExitCode(rawExitCode));
      } catch (err) {
        logger.error(
          'Unexpected error during exit dispatch; falling back to generic failure.',
          err,
        );
        dispatchExit(exitListeners, state, 1);
      }
    })
    .catch((error: unknown) => {
      try {
        emitDecoderTail(decoder, dataListeners, state);
        dataListeners.clear();
        dispatchExit(
          exitListeners,
          state,
          isExitErrorWithCode(error) ? normalizeExitCode(error.exitCode) : 1,
        );
      } catch (err) {
        logger.error(
          'Unexpected error during exit rejection dispatch; falling back to generic failure.',
          err,
        );
        dispatchExit(exitListeners, state, 1);
      }
    });
}

/**
 * Create a Bun.Terminal-backed {@link IPty}.
 *
 * The returned object satisfies the subset of `IPty` that downstream consumers
 * use: `pid`, `onData`, `onExit`, `write`, `resize`, `kill`. The `data`
 * callback decodes PTY bytes to a UTF-8 string before fan-out, matching
 * node-pty's default string encoding.
 */
export function createBunPty(
  file: string,
  args: string[],
  options: BunPtySpawnOptions,
): IPty & { destroy(): void } {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (!bun || typeof bun.spawn !== 'function') {
    throw new Error(
      'createBunPty called outside Bun runtime; Bun.spawn is unavailable',
    );
  }

  const dataListeners = new Set<DataListener>();
  const exitListeners = new Set<ExitListener>();
  const decoder = new TextDecoder();
  const state: BunPtyState = {
    terminalHandle: null,
    exitDispatched: false,
    pendingExit: null,
    killFallbackTimer: null,
    decoderFinalized: false,
  };

  const dimensions = {
    cols: options.cols ?? 80,
    rows: options.rows ?? 24,
  };
  const name = options.name ?? 'xterm-256color';
  const env = normalizeEnvironment(options.env);

  const subprocess = spawnBunTerminal(
    bun,
    file,
    args,
    options.cwd,
    env,
    dimensions.cols,
    dimensions.rows,
    name,
    dataListeners,
    decoder,
    state,
  );

  wireExitHandler(subprocess, exitListeners, dataListeners, decoder, state);

  return buildBunPtyAdapter(
    subprocess,
    file,
    dimensions,
    dataListeners,
    exitListeners,
    decoder,
    state,
  );
}
