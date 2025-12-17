/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandKind,
  type MessageActionReturn,
  type SlashCommand,
} from './types.js';
import { isMouseEventsActive, setMouseEventsActive } from '../utils/mouse.js';

type MouseCommandMode = 'on' | 'off' | 'toggle';

function parseMouseCommandMode(args: string): MouseCommandMode | null {
  const normalized = args.trim().toLowerCase();
  if (!normalized || normalized === 'toggle') return 'toggle';
  if (normalized === 'on' || normalized === 'enable') return 'on';
  if (normalized === 'off' || normalized === 'disable') return 'off';
  return null;
}

export const mouseCommand: SlashCommand = {
  name: 'mouse',
  description:
    'Toggle mouse event tracking (enables in-app wheel scrolling; may interfere with terminal selection/copy)',
  kind: CommandKind.BUILT_IN,

  action: async (_context, args): Promise<MessageActionReturn> => {
    const mode = parseMouseCommandMode(args);
    if (!mode) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /mouse [on|off|toggle]',
      };
    }

    const currentlyActive = isMouseEventsActive();
    const nextActive =
      mode === 'toggle' ? !currentlyActive : mode === 'on' ? true : false;

    setMouseEventsActive(nextActive);

    return {
      type: 'message',
      messageType: 'info',
      content: nextActive
        ? 'Mouse events enabled (in-app wheel scrolling on; terminal selection/copy may be limited).'
        : 'Mouse events disabled (terminal selection/copy on; in-app wheel scrolling off).',
    };
  },
};
