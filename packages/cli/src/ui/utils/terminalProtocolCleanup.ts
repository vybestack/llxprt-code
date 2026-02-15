/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import { DISABLE_MOUSE_EVENTS } from './mouse.js';
import {
  DISABLE_BRACKETED_PASTE,
  DISABLE_FOCUS_TRACKING,
  SHOW_CURSOR,
} from './terminalSequences.js';
import { disableDetectedTerminalProtocolsSync } from './kittyProtocolDetector.js';

const DISABLE_EXTRA_MOUSE_MODES = '\x1b[?1003l\x1b[?1000l';

export const TERMINAL_PROTOCOL_RESTORE_SEQUENCES =
  DISABLE_MOUSE_EVENTS +
  DISABLE_EXTRA_MOUSE_MODES +
  DISABLE_BRACKETED_PASTE +
  DISABLE_FOCUS_TRACKING +
  SHOW_CURSOR;

/**
 * Synchronously restore terminal protocol state. Intended for exit/signal paths
 * where async stdout writes can be dropped.
 */
export function restoreTerminalProtocolsSync(): void {
  if (!process.stdout.isTTY || typeof process.stdout.fd !== 'number') {
    return;
  }

  try {
    disableDetectedTerminalProtocolsSync();
    fs.writeSync(process.stdout.fd, TERMINAL_PROTOCOL_RESTORE_SEQUENCES);
  } catch (_err) {
    // Ignore failures during shutdown; terminal may already be closed.
  }
}
