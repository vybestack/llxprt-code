/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import {
  acquireRequestRows,
  stagedRequestRows,
} from '@vybestack/llxprt-code-providers/utils/requestRowsLease.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';

async function rows(source: AsyncIterable<IContent>): Promise<number> {
  let count = 0;
  for await (const _row of source) count += 1;
  return count;
}

const provider: IProvider = {
  name: 'critical-direct',
  getModels: async () => [],
  getDefaultModel: () => 'test',
  async *generateChatCompletion(
    input: GenerateChatOptions | AsyncIterable<IContent>,
  ) {
    if (!('contents' in input))
      throw new Error('Agent must use the options contract');
    if (Array.isArray(input.contents))
      throw new Error('Provider requires streamed contents');
    const lease = acquireRequestRows(input);
    let first: number;
    let second: number;
    try {
      const selection = await stagedRequestRows(lease.options.contents);
      first = await rows(selection.openReader());
      second = await rows(selection.openReader());
    } finally {
      await lease.close();
    }
    const declaredSelection = input.tools?.length === 0 ? 'empty' : 'selected';
    const selection = input.tools === undefined ? 'omitted' : declaredSelection;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: `${selection}:${first}:${second}` }],
      metadata: { finishReason: 'stop' },
    };
  },
};

describe('direct-message flat tools and replayable contents', () => {
  it('preserves explicit empty tools and supplies a fresh history pass for projection and transport', async () => {
    const settings = new SettingsService();
    const config = new Config({
      sessionId: 'critical-direct',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'test',
    });
    const history = new HistoryService();
    const providerRuntime = createProviderRuntimeContext({
      settingsService: settings,
      config,
      runtimeId: 'critical-direct',
    });
    const context = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        captureProviderInvocation(providerRuntime, name, parameters, signal),
      state: createAgentRuntimeState({
        runtimeId: 'critical-direct',
        provider: provider.name,
        model: 'test',
        sessionId: 'critical-direct',
      }),
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
      },
      provider: {
        getActiveProvider: () => provider,
        setActiveProvider: () => {},
      },
      telemetry: {
        logApiRequest: () => {},
        logApiResponse: () => {},
        logApiError: () => {},
      },
      tools: { listToolNames: () => [], getToolMetadata: () => undefined },
      providerRuntime,
    });
    const processor = new DirectMessageProcessor(
      context,
      () => provider,
      () => providerRuntime,
      {},
      history,
    );
    try {
      const response = await processor.generateDirectMessage(
        { message: 'inspect', config: { tools: [] } },
        'critical-direct',
      );
      const creates = await operationFileCreates(async () => {
        const guarded = await processor.generateDirectMessage(
          { message: 'inspect', config: { tools: [] } },
          'critical-direct-guarded',
        );
        expect(guarded.content.blocks).toStrictEqual(response.content.blocks);
      }, true);
      expect(creates).toStrictEqual({ files: [], directories: [] });
      const text = response.content.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');
      expect(text).toBe('empty:1:1');
      expect(response.finishReason).toBe('stop');
    } finally {
      await history.dispose();
      await config.dispose();
    }
  });
});
