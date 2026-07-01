/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CoreEvent,
  coreEvents,
  JsonFormatter,
  parseAndFormatApiError,
  type ConsoleLogPayload,
  type OutputPayload,
  writeToStderr,
  writeToStdout,
} from '@vybestack/llxprt-code-core';
import { appendFileSync } from 'fs';
import { join } from 'path';
import { AppEvent, appEvents } from './utils/events.js';

const UNKNOWN_API_ERROR_MESSAGE = 'An unknown error occurred';

export function formatNonInteractiveError(error: unknown): string {
  const formatted = parseAndFormatApiError(error);
  if (!formatted.includes(UNKNOWN_API_ERROR_MESSAGE)) {
    return formatted;
  }

  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (error !== null && typeof error === 'object') {
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function installNonInteractiveSigintHandler(
  onSigint: () => Promise<void> | void = () => {
    process.exit(130);
  },
): () => void {
  let exited = false;
  const handler = () => {
    if (exited) {
      return;
    }
    exited = true;
    process.stderr.write('\nCancelled.\n');
    void Promise.resolve(onSigint()).finally(() => {
      process.exit(130);
    });
  };
  process.on('SIGINT', handler);
  return () => {
    process.off('SIGINT', handler);
  };
}

function writeUnhandledRejectionToStderr(errorMessage: string): void {
  if (
    typeof appEvents.listenerCount !== 'function' ||
    appEvents.listenerCount(AppEvent.LogError) === 0
  ) {
    writeToStderr(`${errorMessage}\n`);
  }
}

/**
 * Installs a process-wide `unhandledRejection` listener that logs the error and
 * opens the debug console on the first rejection.
 */
export function setupUnhandledRejectionHandler(): () => void {
  let unhandledRejectionOccurred = false;
  const handler = (reason: unknown) => {
    const formattedReason = formatNonInteractiveError(reason);
    if (unhandledRejectionOccurred) {
      appendInteractiveUiDebug(
        `subsequent-unhandled-rejection ${formattedReason}`,
      );
      writeUnhandledRejectionToStderr(
        `Subsequent unhandled promise rejection: ${formattedReason}`,
      );
      return;
    }
    unhandledRejectionOccurred = true;
    const stackTrace =
      reason instanceof Error &&
      reason.stack &&
      !formattedReason.includes(reason.stack)
        ? `
Stack trace:
${reason.stack}`
        : '';
    appendInteractiveUiDebug(`unhandled-rejection ${formattedReason}`);
    const errorMessage = `=========================================
This is an unexpected error. Please file a bug report using the /bug tool.
CRITICAL: Unhandled Promise Rejection!
=========================================
Reason: ${formattedReason}${stackTrace}`;
    writeUnhandledRejectionToStderr(errorMessage);
    appEvents.emit(AppEvent.LogError, errorMessage);
    appEvents.emit(AppEvent.OpenDebugConsole);
  };
  process.on('unhandledRejection', handler);
  return () => {
    process.off('unhandledRejection', handler);
  };
}

export function appendInteractiveUiDebug(message: string): void {
  const artifactDir = process.env.LLXPRT_TMUX_ARTIFACT_DIR;
  if (!artifactDir) return;
  try {
    appendFileSync(join(artifactDir, 'cli-debug.log'), `${message}\n`);
  } catch {
    // Ignore diagnostics failures; they should not affect CLI startup.
  }
}

export function initializeOutputListenersAndFlush() {
  if (coreEvents.listenerCount(CoreEvent.Output) === 0) {
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      if (payload.isStderr) {
        writeToStderr(payload.chunk, payload.encoding);
      } else {
        writeToStdout(payload.chunk, payload.encoding);
      }
    });
  }

  if (coreEvents.listenerCount(CoreEvent.ConsoleLog) === 0) {
    coreEvents.on(CoreEvent.ConsoleLog, (payload: ConsoleLogPayload) => {
      if (payload.type === 'error' || payload.type === 'warn') {
        writeToStderr(payload.content);
      } else {
        writeToStdout(payload.content);
      }
    });
  }

  coreEvents.drainBacklogs();
}

export function reportJsonError(error: unknown): void {
  const formatter = new JsonFormatter();
  const normalizedError =
    error instanceof Error ? error : new Error(String(error));
  writeToStderr(`${formatter.formatError(normalizedError, 1)}\n`);
}
