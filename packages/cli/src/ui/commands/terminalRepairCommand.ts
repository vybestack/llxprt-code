/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandKind, type MessageActionReturn, type SlashCommand } from './types.js';
import { applyTerminalContract } from '../utils/terminalContract.js';
import { isMouseEventsActive, enableMouseEvents } from '../utils/mouse.js';

/**
 * Command to repair terminal modes (mouse, paste, focus tracking, cursor).
 *
 * This command re-asserts the expected terminal contract, which is useful when:
 * - Mouse wheel stops scrolling in-app (scrolls terminal instead)
 * - Bracketed paste stops working
 * - Focus tracking stops working
 * - After running subprocesses that may have emitted mode-changing sequences
 * - After TMUX reattach if automatic repair didn't work
 *
 * Related issues:
 * - #847: Mouse mode drift - wheel stops scrolling, needs repair/copy mode
 * - #916: TMUX reconnect doesn't redraw UI properly
 */
export const terminalRepairCommand: SlashCommand = {
  name: 'terminal-repair',
  altNames: ['repair'],
  description: 'Repair terminal modes (mouse, paste, focus tracking) if broken',
  kind: CommandKind.BUILT_IN,

  action: async (_context, _args): Promise<MessageActionReturn> => {
    // Re-assert the terminal contract
    applyTerminalContract(process.stdout, {
      includeMouseEvents: isMouseEventsActive(),
    });

    // If mouse events were active, ensure they're properly re-enabled
    // This updates the internal state tracking as well
    if (isMouseEventsActive()) {
      enableMouseEvents();
    }

    // Emit a resize event to trigger Ink to redraw the entire UI
    // This helps recover from visual corruption after TMUX reattach
    process.stdout.emit('resize');

    return {
      type: 'message',
      messageType: 'info',
      content: 'Terminal modes repaired (mouse, paste, focus tracking, cursor).',
    };
  },
};
