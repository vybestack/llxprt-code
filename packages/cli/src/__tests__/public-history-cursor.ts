import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createSessionSettingsFixture } from '../../../agents/src/api/__tests__/helpers/session-settings-fixture.js';
import { createConfigParams } from '../../../agents/src/core/chatSession-runtime-helpers.js';
import { ChatSession } from '../../../agents/src/core/chatSession.js';
import { accountingRow } from '../../../core/src/services/history/__tests__/support/token-accounting-stream-test-helpers.js';
import { createMockCommandContext } from './mockCommandContext.js';
import type { CommandContext } from '../ui/commands/types.js';

export class PublicCursorHistory extends HistoryService {
  readonly borrowed = new RowOwnership();
  readonly copies = new RowOwnership();
  beforeYield: (index: number) => Promise<void> = async () => {};
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'public raw array read forbidden',
    );
  }

  override async *streamRawHistory(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    let index = 0;
    for await (const row of super.streamRawHistory(signal)) {
      const copy = { ...row, blocks: [...row.blocks] };
      this.borrowed.retain(row);
      this.copies.retain(copy);
      try {
        await this.beforeYield(index++);
        signal?.throwIfAborted();
        yield copy;
      } finally {
        this.copies.release(copy);
        this.borrowed.release(row);
      }
    }
  }
}

export function publicChat(history: HistoryService): ChatSession {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));
  const { runtime, providerManager } = createChatSessionRuntime({
    settingsService,
  });
  const settings = createSessionSettingsFixture(config, settingsService);
  const context = createAgentRuntimeContext({
    prepareProviderInvocation: (name, parameters, signal) =>
      captureProviderInvocation(runtime, name, parameters, signal),
    state: createAgentRuntimeState({
      runtimeId: 'public-cursor',
      provider: 'test-provider',
      model: 'test-model',
      sessionId: 'public-cursor',
    }),
    history,
    settings: {},
    provider: createProviderAdapterFromManager(providerManager),
    telemetry: createTelemetryAdapter(config, settings.settingsOwner.telemetry),
    tools: createToolRegistryViewFromRegistry(undefined),
    providerRuntime: runtime,
  });
  const unavailable = async (): Promise<never> => {
    throw new Error('No provider request expected in a history read');
  };
  return new ChatSession(
    context,
    {
      generateContent: unavailable,
      generateContentStream: unavailable,
      countTokens: unavailable,
      embedContent: unavailable,
    },
    {},
    [],
  );
}

export function publicCommandContext(
  chat: ChatSession,
  signal = new AbortController().signal,
): CommandContext {
  return createMockCommandContext({
    signal,
    services: {
      config: {},
      agent: {
        agentClient: {
          hasChatInitialized: () => true,
          getChat: () => chat,
          getHistory: (_curated?: false, historySignal?: AbortSignal) =>
            chat.streamHistory(historySignal),
        },
      },
    },
  });
}

export function publicRow(index: number, bytes = 2048): IContent {
  const row = accountingRow(index, bytes);
  return {
    ...row,
    blocks: [
      ...row.blocks,
      { type: 'thinking', thought: `not copied:${index}` },
      { type: 'text', text: `\n尾:${index}` },
    ],
  };
}

export function clipboardOracle(size: number, bytes = 2048): string {
  const lastAiIndex = size - 1 - ((size - 2) % 3);
  return `row:${lastAiIndex}:${'x'.repeat(bytes)}\n尾:${lastAiIndex}`;
}
