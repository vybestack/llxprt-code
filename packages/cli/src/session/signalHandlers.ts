import { appEvents, AppEvent } from '../utils/events.js';
import { appendInteractiveUiDebug } from './debugLog.js';
import { runExitCleanup } from '../utils/cleanup.js';

export type NonInteractiveSigintExit = (code: number) => never;

function defaultSigintExit(code: number): never {
  process.exit(code);
}

export function installNonInteractiveSigintHandler(
  exitProcess: NonInteractiveSigintExit = defaultSigintExit,
): () => void {
  let exiting = false;
  const handler = () => {
    if (exiting) {
      return;
    }
    exiting = true;
    process.stderr.write('\nCancelled.\n');
    void runExitCleanup().finally(() => {
      exitProcess(130);
    });
  };
  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}

// Module-level flag ensures the "debug console opened" singleton state
// persists across install/dispose cycles within the same process, matching
// the production behavior where the handler is installed once per CLI process
// and the debug console should open at most once. If this module were ever
// reused in a non-CLI context where handlers are disposed and re-installed,
// the flag would need to be reset in the disposer to allow re-opening.
let debugConsoleOpened = false;

/**
 * Resets the module-level singleton state for the unhandled-rejection handler.
 * Intended for test isolation so each test suite starts with a fresh
 * "debug console not yet opened" state.
 */
export function __resetUnhandledRejectionStateForTesting(): void {
  debugConsoleOpened = false;
}

/**
 * Safely coerce an unknown rejection reason to a display string without ever
 * throwing from inside the unhandledRejection listener. Raw `${reason}` /
 * `String(reason)` interpolation would call `reason.toString()`, which throws
 * for objects whose toString throws (or Proxy get-traps) and yields
 * `[object Object]` for plain objects — both unacceptable inside the
 * last-line-of-defense rejection handler.
 *
 * Errors keep their message (the stack is surfaced separately by the caller).
 * Strings pass through verbatim. Plain objects are JSON-stringified with a
 * circular-reference-safe replacer; if that throws, fall back to a guarded
 * String() coercion. Every branch is wrapped so a throwing toString can never
 * propagate out of the listener.
 */
function formatRejectionReason(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  if (typeof reason === 'string') {
    return reason;
  }
  try {
    return JSON.stringify(reason, createCircularSafeReplacer(), 2);
  } catch {
    try {
      return String(reason);
    } catch {
      return '[unserializable rejection reason]';
    }
  }
}

function emitLogError(message: string, error?: Error): void {
  try {
    appEvents.emit(AppEvent.LogError, message, error);
  } catch (emitError) {
    appendInteractiveUiDebug(
      `unhandled-rejection event emit failed ${formatRejectionReason(emitError)}`,
    );
  }
}

function emitOpenDebugConsole(): void {
  try {
    appEvents.emit(AppEvent.OpenDebugConsole);
  } catch (emitError) {
    appendInteractiveUiDebug(
      `open-debug-console event emit failed ${formatRejectionReason(emitError)}`,
    );
  }
}

function createCircularSafeReplacer() {
  const ancestors: object[] = [];
  return function (this: unknown, _key: string, value: unknown) {
    if (typeof value !== 'object' || value === null) {
      return value;
    }

    while (ancestors.length > 0 && ancestors.at(-1) !== this) {
      ancestors.pop();
    }

    if (ancestors.includes(value)) {
      return '[Circular]';
    }

    ancestors.push(value);
    return value;
  };
}

/**
 * Installs a process-wide `unhandledRejection` listener that logs the error
 * and opens the debug console on the first rejection.
 *
 * Returns a disposer that removes the installed listener. The listener is a
 * process-lifetime singleton: `setupProcessLifecycle` installs it once per CLI
 * process and never disposes it (the process exits shortly after). The
 * disposer exists primarily so tests can avoid leaking listeners across cases
 * (each test invocation installs and tears down its own listener).
 */
export function setupUnhandledRejectionHandler(): () => void {
  const handler = (reason: unknown) => {
    const reasonStr = formatRejectionReason(reason);
    appendInteractiveUiDebug(`unhandled-rejection ${reasonStr}`);
    const errorMessage = `=========================================
This is an unexpected error. Please file a bug report using the /bug tool.
CRITICAL: Unhandled Promise Rejection!
=========================================
Reason: ${reasonStr}${
      reason instanceof Error && reason.stack
        ? `
Stack trace:
${reason.stack}`
        : ''
    }`;
    emitLogError(errorMessage, reason instanceof Error ? reason : undefined);
    if (!debugConsoleOpened) {
      debugConsoleOpened = true;
      emitOpenDebugConsole();
    }
  };
  process.on('unhandledRejection', handler);
  return () => {
    process.off('unhandledRejection', handler);
  };
}
