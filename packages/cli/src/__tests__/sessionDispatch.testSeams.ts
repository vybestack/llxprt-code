/**
 * @plan PLAN-20260629-ISSUE2285.P11
 * @requirement REQ-006
 *
 * Shared safe-seam helpers for session-dispatch characterization tests.
 *
 * These helpers replace EXTERNAL effects (process.exit, process.stderr/stdout
 * writes, process.on/off listener registration, coreEvents output routing) so
 * the REAL session-dispatch code can run without terminating the test runner
 * or polluting test output. They are test infrastructure — NOT mocks of the
 * module under test. Every helper here exists so an assertion can verify an
 * OBSERVABLE EFFECT of the real dispatch code (what was written, which handler
 * fired, which branch ran), never merely that a seam was invoked.
 */

import { vi } from 'vitest';

/**
 * Sentinel thrown by the safe process.exit seam so the test runner is never
 * terminated. Carries the exit code so assertions can verify the real code's
 * intended exit behavior.
 */
export class ExitCalledError extends Error {
  readonly exitCode: number;
  constructor(code: number) {
    super(`process.exit(${code}) called`);
    this.name = 'ExitCalledError';
    this.exitCode = code;
  }
}

/**
 * Installs a safe process.exit spy that throws {@link ExitCalledError} instead
 * of terminating the process. Returns the spy so assertions can inspect exit
 * attempts, and a helper to invoke-and-catch the sentinel.
 */
export function installSafeProcessExit() {
  const spy = vi.spyOn(process, 'exit').mockImplementation(((
    code?: string | number | null,
  ) => {
    let exitCode = 0;
    if (typeof code === 'number') {
      exitCode = code;
    } else if (code) {
      // Non-numeric code (e.g. process.exit('abc')) coerces to NaN; fall back
      // to 0 so downstream assertions never see NaN. Matches the undefined/null
      // branch above and the real process.exit semantics for invalid codes.
      const parsed = Number(code);
      exitCode = Number.isNaN(parsed) ? 0 : parsed;
    }
    throw new ExitCalledError(exitCode);
  }) as typeof process.exit);
  return spy;
}

/**
 * Installs spies on process.stderr.write and process.stdout.write that capture
 * all writes into string buffers without emitting to the real streams. Returns
 * accessors for the captured content.
 *
 * Note: the session-dispatch SIGINT handler calls process.stderr.write
 * DIRECTLY (not via the core writeToStderr bypass), so this spy captures its
 * output. The core writeToStdout/writeToStderr helpers capture bound refs at
 * module-load time and bypass these spies; for those paths, tests use the
 * coreEvents listener-based capture instead.
 */
export function installCapturedStdio() {
  const stderrChunks: string[] = [];
  const stdoutChunks: string[] = [];

  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: unknown) => {
      stderrChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
  const stdoutSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: unknown) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });

  return {
    stderrSpy,
    stdoutSpy,
    get stderrContent() {
      return stderrChunks.join('');
    },
    get stdoutContent() {
      return stdoutChunks.join('');
    },
    clear() {
      stderrChunks.length = 0;
      stdoutChunks.length = 0;
    },
  };
}

/**
 * Captures process.on/process.off listener registrations by event name so tests
 * can invoke captured handlers directly and verify disposal removes them.
 *
 * This is the established pattern from nonInteractiveSigint.test.ts: the real
 * handler-installation code calls process.on('SIGINT', handler), which the spy
 * intercepts and stores; the test then invokes the stored handler to verify
 * its observable effect.
 */
export function installListenerCapture() {
  const listeners = new Map<
    string | symbol,
    Array<(...args: unknown[]) => void>
  >();

  const onSpy = vi
    .spyOn(process, 'on')
    .mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        const list = listeners.get(event);
        if (list) {
          list.push(listener);
        } else {
          listeners.set(event, [listener]);
        }
        return process;
      },
    );

  const offSpy = vi
    .spyOn(process, 'off')
    .mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        const list = listeners.get(event);
        if (list) {
          const idx = list.indexOf(listener);
          if (idx >= 0) list.splice(idx, 1);
        }
        return process;
      },
    );

  return {
    onSpy,
    offSpy,
    listeners,
    getListeners(event: string | symbol) {
      return listeners.get(event) ?? [];
    },
    listenerCount(event: string | symbol) {
      return listeners.get(event)?.length ?? 0;
    },
    /**
     * Invokes the LAST-registered handler for the given event.
     *
     * If the handler throws (e.g. `ExitCalledError` from the safe process.exit
     * seam), the error propagates to the caller — wrap the call in try/catch
     * to assert on the sentinel.
     */
    invokeLast(event: string | symbol, ...args: unknown[]): unknown {
      const list = listeners.get(event);
      if (!list || list.length === 0) {
        throw new Error(`No captured listeners for event '${String(event)}'`);
      }
      return list[list.length - 1](...args);
    },
  };
}
