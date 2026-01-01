/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Centralized terminal mode management.
 *
 * This module provides a single source of truth for the terminal state that
 * the application expects. It is used to:
 * 1. Assert terminal modes at startup
 * 2. Repair terminal modes after they may have drifted (subprocess output, SIGCONT, etc.)
 * 3. Provide user-accessible repair via /terminal-repair command
 *
 * Related issues:
 * - #959: Mouse handling not turned off on exit
 * - #916: TMUX reconnect doesn't redraw UI properly
 * - #847: Mouse mode drift - wheel stops scrolling
 * - #199: Garbage ANSI on startup disrupts theme selection
 */

import {
  ENABLE_BRACKETED_PASTE,
  ENABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './terminalSequences.js';
import { ENABLE_MOUSE_EVENTS } from './mouse.js';

/**
 * Combined terminal contract sequences including:
 * - Mouse tracking
 * - Bracketed paste mode
 * - Focus tracking
 * - Show cursor
 */
export const TERMINAL_CONTRACT_SEQUENCES =
  ENABLE_MOUSE_EVENTS +
  ENABLE_BRACKETED_PASTE +
  ENABLE_FOCUS_TRACKING +
  SHOW_CURSOR;

/**
 * Terminal contract sequences without mouse events.
 * Used when mouse events are disabled by user preference.
 */
export const TERMINAL_CONTRACT_SEQUENCES_NO_MOUSE =
  ENABLE_BRACKETED_PASTE + ENABLE_FOCUS_TRACKING + SHOW_CURSOR;

export interface ApplyTerminalContractOptions {
  /**
   * Whether to include mouse event sequences.
   * @default true
   */
  includeMouseEvents?: boolean;
}

/**
 * Apply the expected terminal contract by writing all necessary escape sequences.
 *
 * This function (re)asserts the terminal modes that the application depends on:
 * - Mouse tracking (X11, button events, SGR extended)
 * - Bracketed paste mode
 * - Focus tracking
 * - Cursor visibility
 *
 * Call this function:
 * - At startup (after draining any garbage ANSI from stdin)
 * - After SIGCONT (tmux reattach, fg after suspend)
 * - After SIGWINCH (terminal resize - some terminals reset modes)
 * - After running subprocesses that may emit mode-changing sequences
 * - When the user explicitly requests repair via /terminal-repair
 *
 * @param stdout The output stream to write to (defaults to process.stdout)
 * @param options Configuration options
 */
export function applyTerminalContract(
  stdout: NodeJS.WriteStream = process.stdout,
  options: ApplyTerminalContractOptions = {},
): void {
  const { includeMouseEvents = true } = options;

  const sequences = includeMouseEvents
    ? TERMINAL_CONTRACT_SEQUENCES
    : TERMINAL_CONTRACT_SEQUENCES_NO_MOUSE;

  stdout.write(sequences);
}

/**
 * Drain any pending data from the stdin buffer.
 *
 * This is useful at startup to consume any garbage ANSI sequences that may have
 * been sent by the terminal before the application started processing input.
 * This addresses issue #199 where garbage ANSI on startup disrupts theme selection.
 *
 * The function reads available data from stdin without blocking indefinitely.
 * It uses a timeout to prevent hanging if stdin has no data.
 *
 * @param stdin The input stream to drain (defaults to process.stdin)
 * @param timeoutMs Maximum time to wait for data (defaults to 50ms)
 */
export async function drainStdinBuffer(
  stdin: NodeJS.ReadableStream = process.stdin,
  timeoutMs: number = 50,
): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      stdin.removeListener('readable', onReadable);
      stdin.removeListener('end', onEnd);
      resolve();
    }, timeoutMs);

    const onReadable = () => {
      // Read and discard any available data
      while (
        (stdin as NodeJS.ReadableStream & { read(): Buffer | null }).read() !==
        null
      ) {
        // Intentionally discard the data
      }
    };

    const onEnd = () => {
      clearTimeout(timeout);
      stdin.removeListener('readable', onReadable);
      resolve();
    };

    stdin.on('readable', onReadable);
    stdin.once('end', onEnd);

    // Try an immediate read in case data is already buffered
    onReadable();
  });
}
