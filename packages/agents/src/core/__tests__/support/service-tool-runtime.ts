import { chatSessionPorts } from '../../chatSessionPorts.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { ChatSession } from '../../chatSession.js';

export const toolId = 'hist_w21_original_001';
export const toolResult = {
  output: 'native result\n雪\u0000end',
  bytes: [0, 1, 127, 255],
};
export const resultBlock: ToolResponseBlock = {
  type: 'tool_response',
  callId: toolId,
  toolName: 'lookup',
  result: toolResult,
};
export const providerName = 'w21-local';
export const modelName = 'w21-model';

export function toolGate(): {
  readonly promise: Promise<void>;
  resolve(): void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

export function completedTool(): CompletedToolCall {
  return {
    status: 'error',
    request: {
      callId: toolId,
      name: 'lookup',
      args: { query: 'durability' },
      isClientInitiated: false,
      prompt_id: 'first',
    },
    response: {
      callId: toolId,
      responseParts: [resultBlock],
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  };
}

export interface RequestFacts {
  readonly calls: number;
  readonly results: number;
  readonly ids: readonly string[];
  readonly result: unknown;
  readonly texts: readonly string[];
}

export async function requestFacts(
  contents: AsyncIterable<IContent>,
): Promise<RequestFacts> {
  let calls = 0;
  let results = 0;
  const ids: string[] = [];
  const texts: string[] = [];
  let result: unknown;
  for await (const row of contents) {
    for (const block of row.blocks) {
      if (block.type === 'tool_call') {
        calls++;
        ids.push(block.id);
      }
      if (block.type === 'tool_response') {
        results++;
        ids.push(block.callId);
        result = block.result;
      }
      if (block.type === 'text') texts.push(block.text);
    }
  }
  return { calls, results, ids, result, texts };
}

export function localProvider(
  generate: (
    options: RuntimeGenerateChatOptions,
  ) => AsyncIterableIterator<IContent>,
): RuntimeProvider {
  return {
    name: providerName,
    getDefaultModel: () => modelName,
    getModels: async () => [],
    generateChatCompletion(
      input: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (!('contents' in input))
        throw new Error('Expected production request options');
      return generate(input);
    },
  };
}

const unused = async (): Promise<never> => {
  throw new Error('Unexpected legacy generator');
};
const silentTelemetry = {
  logApiRequest(): void {},
  logApiResponse(): void {},
  logApiError(): void {},
};
const unusedGenerator = {
  generateContent: unused,
  generateContentStream: unused,
  countTokens: unused,
  embedContent: unused,
};

export function serviceToolChat(
  history: HistoryService,
  provider: RuntimeProvider,
  sessionId: string,
  directory: string,
): {
  readonly chat: ChatSession;
  close(): Promise<void>;
} {
  const settings = new SettingsService();
  settings.set('prompt-caching', 'off');
  settings.set('retries', 1);
  const config = new Config({
    cwd: directory,
    targetDir: directory,
    sessionId,
    model: modelName,
    debugMode: false,
    trustedFolder: true,
    telemetry: { enabled: false },
  });
  const owner = new SessionSettingsOwner(settings);
  const state = createAgentRuntimeState({
    runtimeId: sessionId,
    sessionId,
    provider: providerName,
    model: modelName,
  });
  const runtime = createAgentRuntimeContext({
    state,
    history,
    readRuntimeSettings: () => owner.readRuntimePolicy(),
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        sessionId,
        name,
        parameters,
        signal,
        undefined,
        globalThis.fetch,
      ),
    settings: {
      contextLimit: 100000,
      telemetry: { enabled: false, target: null },
    },
    providerRuntime: createProviderRuntimeContext({
      runtimeId: sessionId,
    }),
    provider: {
      getProviderKeys: () => {
        throw new Error('Fixture has no credential key authority');
      },

      getActiveProvider: () => provider,
      setActiveProvider(): void {
        throw new Error('Unexpected provider switch');
      },
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    telemetry: silentTelemetry,
  });
  return {
    chat: new ChatSession(
      chatSessionPorts(runtime),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      unusedGenerator,
    ),
    close: async (): Promise<void> => {
      await owner.dispose();
      await config.dispose();
    },
  };
}
