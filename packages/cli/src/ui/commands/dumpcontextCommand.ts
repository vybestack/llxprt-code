/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageActionReturn, SlashCommand } from './types.js';
import { CommandKind } from './types.js';
import type { CommandArgumentSchema } from './schema/types.js';
import type { DumpMode } from '@vybestack/llxprt-code-providers';

const validModes: readonly DumpMode[] = ['now', 'status', 'on', 'error', 'off'];

function isValidMode(mode: string): mode is DumpMode {
  return validModes.includes(mode as DumpMode);
}

const dumpcontextSchema: CommandArgumentSchema = [
  { kind: 'literal', value: 'now', description: 'Dump context immediately' },
  {
    kind: 'literal',
    value: 'status',
    description: 'Show current dump status (default)',
  },
  {
    kind: 'literal',
    value: 'on',
    description: 'Dump context before every request',
  },
  {
    kind: 'literal',
    value: 'error',
    description: 'Dump context only for errors',
  },
  { kind: 'literal', value: 'off', description: 'Disable context dumping' },
];

export interface DumpcontextCommandOperations {
  readonly dumpDirectory: string;
  readonly readMode: () => unknown;
  readonly writeMode: (mode: Exclude<DumpMode, 'now' | 'status'>) => void;
  readonly dumpNow: () => Promise<MessageActionReturn>;
}

export function createDumpcontextCommand(
  operations: DumpcontextCommandOperations,
): SlashCommand {
  return {
    name: 'dumpcontext',
    description:
      'Control context dumping: now, status, on, error, off (default: status)',
    kind: CommandKind.BUILT_IN,
    schema: dumpcontextSchema,
    action: async (_context, args): Promise<MessageActionReturn> => {
      const mode = args.trim().toLowerCase() || 'status';
      if (!isValidMode(mode)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid mode '${mode}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }
      if (mode === 'now') return operations.dumpNow();
      if (mode === 'status') {
        const rawMode = operations.readMode();
        const currentMode =
          typeof rawMode === 'string' && rawMode !== '' ? rawMode : 'off';
        return {
          type: 'message',
          messageType: 'info',
          content: `Context dumping: ${currentMode}\n\nDump directory: ${operations.dumpDirectory}\n\nAvailable modes:\n- now: Dump context immediately\n- on: Dump context before every request\n- error: Dump context only for errors\n- off: Disable context dumping\n- status: Show current status (default)`,
        };
      }
      operations.writeMode(mode);
      const messages: Record<Exclude<DumpMode, 'now' | 'status'>, string> = {
        on: `Context dumping enabled for all requests.\nDumps will be saved to: ${operations.dumpDirectory}`,
        error: `Context dumping enabled for errors only.\nDumps will be saved to: ${operations.dumpDirectory}`,
        off: 'Context dumping disabled.',
      };
      return {
        type: 'message',
        messageType: 'info',
        content: messages[mode],
      };
    },
  };
}
