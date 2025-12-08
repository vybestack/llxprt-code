/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import * as os from 'node:os';
import * as path from 'node:path';

type DumpMode = 'now' | 'status' | 'on' | 'error' | 'off';

const validModes: DumpMode[] = ['now', 'status', 'on', 'error', 'off'];

function isValidMode(mode: string): mode is DumpMode {
  return validModes.includes(mode as DumpMode);
}

export const dumpcontextCommand: SlashCommand = {
  name: 'dumpcontext',
  description:
    'Control context dumping: now, status, on, error, off (default: status)',
  kind: CommandKind.BUILT_IN,
  completion: async (_context, partialArg) => {
    const lowerArg = partialArg.toLowerCase();
    return validModes.filter((mode) => mode.startsWith(lowerArg));
  },
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    try {
      const runtime = getRuntimeApi();
      const mode = args?.trim().toLowerCase() || 'status';

      if (!isValidMode(mode)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid mode '${mode}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }

      const dumpDir = path.join(os.homedir(), '.llxprt', 'dumps');

      // Handle status command
      if (mode === 'status') {
        const currentMode =
          (runtime.getEphemeralSetting('dumpcontext') as string) || 'off';
        return {
          type: 'message',
          messageType: 'info',
          content: `Context dumping: ${currentMode}\n\nDump directory: ${dumpDir}\n\nAvailable modes:\n- now: Dump context on next request only\n- on: Dump context before every request\n- error: Dump context only on errors\n- off: Disable context dumping\n- status: Show current status (default)`,
        };
      }

      // Handle mode changes
      runtime.setEphemeralSetting('dumpcontext', mode);

      const messages: Record<DumpMode, string> = {
        now: `Context will be dumped on next request.\nDump directory: ${dumpDir}`,
        on: `Context dumping enabled for all requests.\nDumps will be saved to: ${dumpDir}`,
        error: `Context dumping enabled for errors only.\nDumps will be saved to: ${dumpDir}`,
        off: 'Context dumping disabled.',
        status: '', // Already handled above
      };

      return {
        type: 'message',
        messageType: 'info',
        content: messages[mode],
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to manage dumpcontext: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
