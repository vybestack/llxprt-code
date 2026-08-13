/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { getHistoryServiceFromConfig as getHistoryService } from './historyServiceAccess.js';
import type { CommandArgumentSchema } from './schema/types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import type { DumpMode } from '@vybestack/llxprt-code-providers';
import {
  buildProviderDumpBody,
  dumpRequestContext,
} from '@vybestack/llxprt-code-providers';
import type { IContent } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-settings';
import * as path from 'node:path';

type ProviderManagerWithActive = {
  getActiveProviderName?: () => string | undefined;
  getActiveProvider?: () => {
    getCurrentModel?: () => string | undefined;
    baseURL?: string;
  };
};

const historyUnavailableMessage =
  'History is not available. Start a conversation first before dumping context.';

const validModes: DumpMode[] = ['now', 'status', 'on', 'error', 'off'];

function isValidMode(mode: string): mode is DumpMode {
  return validModes.includes(mode as DumpMode);
}


function getProviderDumpMetadata(
  config: NonNullable<CommandContext['services']['config']>,
): {
  providerName: string;
  activeModel: string | undefined;
  activeBaseURL: string | undefined;
} {
  const providerManager = config.getProviderManager() as
    | ProviderManagerWithActive
    | undefined;
  if (!providerManager) {
    return {
      providerName: 'backend',
      activeModel: undefined,
      activeBaseURL: undefined,
    };
  }
  const activeProvider = providerManager.getActiveProvider?.();
  return {
    providerName: providerManager.getActiveProviderName?.() ?? 'backend',
    activeModel: activeProvider?.getCurrentModel?.(),
    activeBaseURL: activeProvider?.baseURL,
  };
}

async function dumpImmediateContext(
  context: CommandContext,
): Promise<MessageActionReturn> {
  const config = context.services.config;
  const historyService = getHistoryService(config);
  if (!config || !historyService) {
    return {
      type: 'message',
      messageType: 'error',
      content: historyUnavailableMessage,
    };
  }
  const history = historyService.getAll() as IContent[];
  const { providerName, activeModel, activeBaseURL } =
    getProviderDumpMetadata(config);
  const request = {
    url: 'immediate-context-dump',
    method: 'DUMP',
    body: buildProviderDumpBody({
      providerName,
      history,
      settings: context.services.settings,
      config,
      model: activeModel,
      baseURL: activeBaseURL,
    }),
  };
  // Chronology is written alongside the request, never inside request.body:
  // the body must stay byte-for-byte what the provider would receive (#1721).
  const result = await dumpRequestContext(
    request,
    providerName,
    undefined,
    historyService.getChronologyTrace(),
  );
  return {
    type: 'message',
    messageType: 'info',
    content: `Immediate request context dumped to ${result.requestFilename}\nNo model request was sent, so no model response dump was created.\nDump directory: ${result.dumpDir}`,
  };
}

/**
 * Schema for /dumpcontext command argument completion
 */
const dumpcontextSchema: CommandArgumentSchema = [
  {
    kind: 'literal',
    value: 'now',
    description: 'Dump context immediately',
  },
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
    description: 'Dump context only on errors',
  },
  {
    kind: 'literal',
    value: 'off',
    description: 'Disable context dumping',
  },
];

export const dumpcontextCommand: SlashCommand = {
  name: 'dumpcontext',
  description:
    'Control context dumping: now, status, on, error, off (default: status)',
  kind: CommandKind.BUILT_IN,
  schema: dumpcontextSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    try {
      const runtime = getRuntimeApi();
      const mode = args.trim().toLowerCase() || 'status';

      if (!isValidMode(mode)) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Invalid mode '${mode}'. Valid modes are: ${validModes.join(', ')}`,
        };
      }

      const dumpDir = path.join(Storage.getGlobalCacheDir(), 'dumps');

      // Handle status command
      if (mode === 'status') {
        const rawMode = runtime.getSessionSetting('dumpcontext');
        const currentMode =
          typeof rawMode === 'string' && rawMode !== '' ? rawMode : 'off';
        return {
          type: 'message',
          messageType: 'info',
          content: `Context dumping: ${currentMode}\n\nDump directory: ${dumpDir}\n\nAvailable modes:\n- now: Dump context immediately\n- on: Dump context before every request\n- error: Dump context only on errors\n- off: Disable context dumping\n- status: Show current status (default)`,
        };
      }

      if (mode === 'now') {
        return await dumpImmediateContext(context);
      }

      // Handle mode changes — session-scoped so the value survives profile
      // application and propagates live to foreground and subagent requests.
      runtime.setSessionSetting('dumpcontext', mode);

      const messages: Record<Exclude<DumpMode, 'now'>, string> = {
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
