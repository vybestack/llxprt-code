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
    'Toggle mouse event tracking (enables wheel scrolling, disables terminal selection and clickable links)',
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
        ? 'Mouse events enabled (wheel scrolling on, terminal selection/clickable links off).'
        : 'Mouse events disabled (terminal selection/clickable links on, wheel scrolling off).',
    };
  },
};
