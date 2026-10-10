/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageType, type Message } from '../types.js';

/** Shown after the restore: restoring history would erase warnings added before it. */
export function addResumeWarnings(
  addMessage: (message: Message) => void,
  warnings: readonly string[],
): void {
  for (const warning of warnings) {
    addMessage({
      type: MessageType.INFO,
      content: `Warning: ${warning}`,
      timestamp: new Date(),
    });
  }
}
