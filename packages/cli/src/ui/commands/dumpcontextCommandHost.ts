/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  parseOutputLimits,
  type HistoryDumpSnapshot,
} from '@vybestack/llxprt-code-core';
import {
  buildProviderDumpBodyStream,
  dumpRequestContextStream,
  type DumpMode,
  type IProvider,
} from '@vybestack/llxprt-code-providers';
import { Storage } from '@vybestack/llxprt-code-settings';
import * as path from 'node:path';
import type { MessageActionReturn } from './types.js';
import type { DumpcontextCommandOperations } from './dumpcontextCommand.js';

export interface DumpcontextOwnerBindings {
  readonly readMode: () => unknown;
  readonly writeMode: (mode: Exclude<DumpMode, 'now' | 'status'>) => void;
  readonly readHistory: () => Promise<HistoryDumpSnapshot | null>;
  readonly readProvider: () => {
    readonly providerName: string;
    readonly activeModel: string | undefined;
    readonly activeBaseURL: string | undefined;
    readonly contextDumpVersion?: number;
    readonly buildContextDumpBody?: IProvider['buildContextDumpBody'];
  };
  readonly readOutputSettings: () => Parameters<typeof parseOutputLimits>[0];
}

function isGeminiFamilyProviderName(providerName: string): boolean {
  const normalized = providerName.toLowerCase().trim();
  return normalized === 'gemini' || normalized.startsWith('gemini-');
}

async function dumpNow(
  bindings: DumpcontextOwnerBindings,
  signal: AbortSignal,
): Promise<MessageActionReturn> {
  signal.throwIfAborted();
  const history = await bindings.readHistory();
  if (history === null) {
    return {
      type: 'message',
      messageType: 'error',
      content:
        'History is not available. Start a conversation first before dumping context.',
    };
  }
  try {
    const provider = bindings.readProvider();
    const policy = bindings.readOutputSettings();
    const limits = parseOutputLimits(policy);
    if (
      provider.buildContextDumpBody !== undefined &&
      provider.contextDumpVersion !== 2
    ) {
      throw new Error(
        `Provider '${provider.providerName}' uses an unsupported eager context dump hook. Upgrade the plugin to contextDumpVersion 2 with async bounded conversion.`,
      );
    }
    if (
      provider.buildContextDumpBody === undefined &&
      isGeminiFamilyProviderName(provider.providerName)
    ) {
      throw new Error(
        `Provider '${provider.providerName}' cannot build a context dump: install/load the @vybestack/llxprt-plugin-google-gemini runtime plugin and retry.`,
      );
    }
    const body =
      provider.buildContextDumpBody === undefined
        ? buildProviderDumpBodyStream({
            providerName: provider.providerName,
            history,
            policy: { ...policy },
            config: limits,
            model: provider.activeModel,
            baseURL: provider.activeBaseURL,
          })
        : await provider.buildContextDumpBody(
            history,
            provider.activeModel,
            limits,
          );
    const result = await dumpRequestContextStream(
      { url: 'immediate-context-dump', method: 'DUMP', body },
      provider.providerName,
      undefined,
      history.chronology(),
      { media: 'raw', signal },
    );
    return {
      type: 'message',
      messageType: 'info',
      content: `Immediate request context dumped to ${result.requestFilename}\nNo model request was sent, so no model response dump was created.\nDump directory: ${result.dumpDir}`,
    };
  } catch (error) {
    signal.throwIfAborted();
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to dump context: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await history.close();
  }
}

export function bindDumpcontextCommand(
  bindings: DumpcontextOwnerBindings,
): DumpcontextCommandOperations {
  return {
    dumpDirectory: path.join(Storage.getGlobalCacheDir(), 'dumps'),
    readMode: bindings.readMode,
    writeMode: bindings.writeMode,
    dumpNow: (signal) => dumpNow(bindings, signal),
  };
}
