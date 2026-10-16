/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseOutputLimits } from '@vybestack/llxprt-code-core';
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
import { getHistoryServiceFromAgent as getHistoryService } from './historyServiceAccess.js';
import type { CommandArgumentSchema } from './schema/types.js';
import {
  type DumpMode,
  buildProviderDumpBodyStream,
  dumpRequestContextStream,
} from '@vybestack/llxprt-code-providers';
import { Storage } from '@vybestack/llxprt-code-settings';
import * as path from 'node:path';

const historyUnavailableMessage =
  'History is not available. Start a conversation first before dumping context.';

const validModes: DumpMode[] = ['now', 'status', 'on', 'error', 'off'];

function isValidMode(mode: string): mode is DumpMode {
  return validModes.includes(mode as DumpMode);
}

function isGeminiFamilyProviderName(providerName: string): boolean {
  const normalized = providerName.toLowerCase().trim();
  return normalized === 'gemini' || normalized.startsWith('gemini-');
}

async function dumpImmediateContext(
  context: CommandContext,
): Promise<MessageActionReturn> {
  const config = context.services.config;
  const historyService = getHistoryService(context.services.agent);
  if (!config || !historyService) {
    return {
      type: 'message',
      messageType: 'error',
      content: historyUnavailableMessage,
    };
  }
  const policy = config.getEphemeralSettings();
  const limits = parseOutputLimits(policy);
  const {
    providerName,
    contextDumpVersion,
    buildContextDumpBody: pluginConverter,
    activeModel,
    activeBaseURL,
  } = context.runtimeApi.getProviderDumpMetadata();
  if (pluginConverter !== undefined && contextDumpVersion !== 2) {
    throw new Error(
      `Provider '${providerName}' uses an unsupported eager context dump hook. Upgrade the plugin to contextDumpVersion 2 with async bounded conversion.`,
    );
  }
  if (
    pluginConverter === undefined &&
    isGeminiFamilyProviderName(providerName)
  ) {
    throw new Error(
      `Provider '${providerName}' cannot build a context dump: install/load the @vybestack/llxprt-plugin-google-gemini runtime plugin and retry.`,
    );
  }
  const history = await historyService.openDumpSnapshot();
  try {
    // Plugin-owned providers (Gemini) build their own wire body at runtime;
    // the base package never imports plugin code.
    const body =
      pluginConverter === undefined
        ? buildProviderDumpBodyStream({
            providerName,
            history,
            policy,
            config: limits,
            model: activeModel,
            baseURL: activeBaseURL,
          })
        : await pluginConverter(history, activeModel, limits);
    const request = { url: 'immediate-context-dump', method: 'DUMP', body };
    const result = await dumpRequestContextStream(
      request,
      providerName,
      undefined,
      history.chronology(),
      { media: 'raw', signal: context.signal },
    );
    return {
      type: 'message',
      messageType: 'info',
      content: `Immediate request context dumped to ${result.requestFilename}\nNo model request was sent, so no model response dump was created.\nDump directory: ${result.dumpDir}`,
    };
  } finally {
    await history.close();
  }
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
      const runtime = context.runtimeApi;
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
