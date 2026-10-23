/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseOutputLimits } from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  buildProviderDumpBody,
  dumpRequestContext,
} from '@vybestack/llxprt-code-providers';
import type { DumpMode } from '@vybestack/llxprt-code-providers';
import { Storage } from '@vybestack/llxprt-code-settings';
import * as path from 'node:path';
import type { MessageActionReturn } from './types.js';
import type { DumpcontextCommandOperations } from './dumpcontextCommand.js';

export interface DumpcontextOwnerBindings {
  readonly readMode: () => unknown;
  readonly writeMode: (mode: Exclude<DumpMode, 'now' | 'status'>) => void;
  readonly readHistory: Agent['session']['readHistorySnapshot'];
  readonly readProvider: () => {
    readonly providerName: string;
    readonly activeModel: string | undefined;
    readonly activeBaseURL: string | undefined;
    readonly buildContextDumpBody?: (
      history: IContent[],
      model?: string,
      config?: unknown,
    ) => Record<string, unknown>;
  };
  readonly readOutputSettings: () => Parameters<typeof parseOutputLimits>[0];
  readonly readRuntimeConfig: () => unknown;
}

function isGeminiFamilyProviderName(providerName: string): boolean {
  const normalized = providerName.toLowerCase().trim();
  return normalized === 'gemini' || normalized.startsWith('gemini-');
}

async function dumpNow(
  bindings: DumpcontextOwnerBindings,
): Promise<MessageActionReturn> {
  const historySource = bindings.readHistory();
  if (historySource === null) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'History is not available. Start a conversation first before dumping context.',
    };
  }
  const { messages: history, chronology } = historySource;
  const provider = bindings.readProvider();
  let body: Record<string, unknown>;
  if (provider.buildContextDumpBody !== undefined) {
    body = provider.buildContextDumpBody(
      history,
      provider.activeModel,
      bindings.readRuntimeConfig(),
    );
  } else {
    if (isGeminiFamilyProviderName(provider.providerName)) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          `Provider '${provider.providerName}' cannot build a context dump: Gemini wire ` +
          'conversion is provided by the @vybestack/llxprt-plugin-google-gemini ' +
          'runtime plugin. Install/load that plugin (it contributes the gemini ' +
          'provider) and retry.',
      };
    }
    const policy = bindings.readOutputSettings();
    body = buildProviderDumpBody({
      providerName: provider.providerName,
      history,
      policy: { ...policy },
      config: parseOutputLimits(policy),
      model: provider.activeModel,
      baseURL: provider.activeBaseURL,
    });
  }
  const result = await dumpRequestContext(
    { url: 'immediate-context-dump', method: 'DUMP', body },
    provider.providerName,
    undefined,
    chronology,
    { media: 'raw' },
  );
  return {
    type: 'message',
    messageType: 'info',
    content: `Immediate request context dumped to ${result.requestFilename}\nNo model request was sent, so no model response dump was created.\nDump directory: ${result.dumpDir}`,
  };
}

export function bindDumpcontextCommand(
  bindings: DumpcontextOwnerBindings,
): DumpcontextCommandOperations {
  return {
    dumpDirectory: path.join(Storage.getGlobalCacheDir(), 'dumps'),
    readMode: bindings.readMode,
    writeMode: bindings.writeMode,
    dumpNow: () => dumpNow(bindings),
  };
}
