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
  DISABLE_EXTRA_MOUSE_MODES_SEQUENCE,
  SHOW_CURSOR,
} from './terminalSequences.js';
import { terminalCapabilityManager } from './terminalCapabilityManager.js';

export const TERMINAL_PROTOCOL_RESTORE_SEQUENCES =
  DISABLE_MOUSE_EVENTS +
  DISABLE_EXTRA_MOUSE_MODES_SEQUENCE +
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
    terminalCapabilityManager.disableKittyProtocolOnExit();
    fs.writeSync(process.stdout.fd, TERMINAL_PROTOCOL_RESTORE_SEQUENCES);
  } catch {
    // Terminal may already be closed - ignore shutdown failures
  }
}
