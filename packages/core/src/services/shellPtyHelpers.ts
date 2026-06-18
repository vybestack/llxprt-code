/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IPty } from '@lydell/node-pty';
import type { Terminal } from '@xterm/headless';
import {
  serializeTerminalToObject,
  type AnsiLine,
  type AnsiOutput,
} from '../utils/terminalSerializer.js';
import { DebugLogger } from '../debug/DebugLogger.js';

const shellDebug = new DebugLogger('llxprt:shell:render');

/** Active PTY bookkeeping entry stored in the service's static map. */
export interface ActivePty {
  ptyProcess: IPty;
  headlessTerminal: Terminal;
  onDataDisposable?: { dispose(): void };
  onExitDisposable?: { dispose(): void };
  onScrollDisposable?: { dispose(): void };
  terminationTimeout?: NodeJS.Timeout;
  renderTimeout?: NodeJS.Timeout | undefined;
}

/**
 * Returns true when the error is a benign race where the PTY has already
 * exited before a resize/scroll call reaches it (Unix ESRCH or Windows
 * message-based error).
 */
export function isIgnorablePtyExitError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return (
    err.code === 'ESRCH' ||
    (typeof err.message === 'string' &&
      err.message.includes('Cannot resize a pty that has already exited'))
  );
}

/**
 * Safely tears down a PTY process, preferring destroy() (which closes the
 * underlying FD/socket) when available at runtime, with a kill() fallback.
 */
export function safePtyDestroy(ptyProcess: IPty): void {
  try {
    const pty = ptyProcess as IPty & { destroy?: () => void };
    if (typeof pty.destroy === 'function') {
      pty.destroy();
    } else {
      ptyProcess.kill();
    }
  } catch {
    // PTY may already be exited; cleanup is best-effort.
  }
}

/** Dispose all listeners and timers on an {@link ActivePty} entry. */
export function cleanupPtyEntryResources(entry: ActivePty): void {
  try {
    entry.onDataDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  try {
    entry.onExitDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  try {
    entry.onScrollDisposable?.dispose();
  } catch {
    // Dispose may fail if PTY already exited.
  }
  if (entry.terminationTimeout) {
    clearTimeout(entry.terminationTimeout);
    entry.terminationTimeout = undefined;
  }
  if (entry.renderTimeout) {
    clearTimeout(entry.renderTimeout);
    entry.renderTimeout = undefined;
  }
  safePtyDestroy(entry.ptyProcess);
  try {
    if (typeof entry.headlessTerminal.dispose === 'function') {
      entry.headlessTerminal.dispose();
    }
  } catch {
    // Terminal may already be disposed.
  }
}

/** Remove a PTY entry from the map by pid and reset lastActivePtyId. */
export function cleanupPtyEntryByPid(
  pid: number,
  activePtys: Map<number, ActivePty>,
  getLastId: () => number | null,
  setLastId: (id: number | null) => void,
): void {
  const entry = activePtys.get(pid);
  if (entry) {
    cleanupPtyEntryResources(entry);
    activePtys.delete(pid);
  }
  if (getLastId() === pid) {
    setLastId(null);
  }
}

/** Extract the full text content of a headless terminal buffer. */
export function getFullBufferText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) {
      continue;
    }
    let trimRight = true;
    if (i + 1 < buffer.length) {
      const nextLine = buffer.getLine(i + 1);
      if (nextLine?.isWrapped === true) {
        trimRight = false;
      }
    }

    const lineContent = line.translateToString(trimRight);

    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += lineContent;
    } else {
      lines.push(lineContent);
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/** Serialize the headless terminal to an AnsiOutput, optionally stripping color. */
export function serializeTerminalForRender(
  terminal: Terminal,
  showColor?: boolean,
): AnsiOutput {
  if (showColor === true) {
    return serializeTerminalToObject(terminal);
  }
  const serialized = serializeTerminalToObject(terminal);
  return (Array.isArray(serialized) ? serialized : [])
    .filter((line): line is AnsiLine => Array.isArray(line))
    .map((line) =>
      line.map((token) => {
        token.fg = '';
        token.bg = '';
        return token;
      }),
    );
}

/** Find the last non-empty line index in an AnsiOutput, capped by cursorY. */
export function findLastNonEmptyLineIndex(
  newOutput: AnsiOutput,
  cursorY: number,
): number {
  let lastNonEmptyLine = -1;
  for (let i = newOutput.length - 1; i >= 0; i--) {
    const line = newOutput[i];
    if (
      Array.isArray(line) &&
      line
        .map((segment) => segment.text)
        .join('')
        .trim().length > 0
    ) {
      lastNonEmptyLine = i;
      break;
    }
  }

  if (cursorY > lastNonEmptyLine) {
    lastNonEmptyLine = cursorY;
  }

  return lastNonEmptyLine;
}

/**
 * Emit the output event if the terminal content has changed.
 *
 * The mutable output reference is threaded as a parameter so that the
 * lint type-checker does not narrow object properties across `await`.
 */
export function maybeEmitRenderedOutput(
  outputRef: { current: string | AnsiOutput | null },
  onOutputEvent: (event: { type: 'data'; chunk: AnsiOutput }) => void,
  finalOutput: AnsiOutput,
  buffer: { cursorY: number; cursorX: number },
): void {
  const finalJson = JSON.stringify(finalOutput);
  const outputJson = JSON.stringify(outputRef.current);
  if (outputJson !== finalJson) {
    const cursorLine = finalOutput[buffer.cursorY] as AnsiLine | undefined;
    const cursorLineText =
      cursorLine !== undefined
        ? cursorLine
            .map((t) => t.text)
            .join('')
            .trimEnd()
        : '(no line)';
    shellDebug.log(
      'renderFn: CHANGED cursorY=%d cursorX=%d lines=%d cursorLine=%s',
      buffer.cursorY,
      buffer.cursorX,
      finalOutput.length,
      JSON.stringify(cursorLineText),
    );
    outputRef.current = finalOutput;
    onOutputEvent({ type: 'data', chunk: finalOutput });
  } else {
    shellDebug.log(
      'renderFn: no change (cursorY=%d cursorX=%d)',
      buffer.cursorY,
      buffer.cursorX,
    );
  }
}
