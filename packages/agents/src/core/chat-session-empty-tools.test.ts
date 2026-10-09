/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggingProviderWrapper } from '../../../providers/src/LoggingProviderWrapper.js';
import type { IProvider } from '../../../providers/src/IProvider.js';
import * as telemetryLoggers from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import type { ConversationRequestEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
import { ChatSession } from './chatSession.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ToolChoice } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import type { HookLLMRequest } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import {
  AfterModelHookOutput,
  BeforeModelHookOutput,
  BeforeToolSelectionHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

type Origin = 'producer' | 'missing' | 'none' | 'unmatched';
type Path = 'direct' | 'stream' | 'turn';

const unusedGenerator: ContentGenerator = {
  generateContent: async () => {
    throw new Error('Unexpected generator call');
  },
  generateContentStream: async () => {
    throw new Error('Unexpected generator call');
  },
  countTokens: async () => ({ totalTokens: 0 }),
  embedContent: async () => {
    throw new Error('Unexpected embedding call');
  },
};

function observeHooks(
  config: Config,
  choice: ToolChoice | undefined,
  before: Array<Omit<HookLLMRequest, 'version'>>,
  after: Array<Omit<HookLLMRequest, 'version'>>,
  selection: Array<Omit<HookLLMRequest, 'version'>>,
): void {
  Object.defineProperties(config, {
    getEnableHooks: { value: () => true },
    getHookSystem: {
      value: () => ({
        initialize: async (): Promise<void> => undefined,
        isInitialized: (): boolean => true,
        fireBeforeToolSelectionEvent: async (
          request: Omit<HookLLMRequest, 'version'>,
        ) => {
          selection.push(request);
          return new BeforeToolSelectionHookOutput({
            hookSpecificOutput: { toolChoice: choice },
          });
        },
        fireBeforeModelEvent: async (
          request: Omit<HookLLMRequest, 'version'>,
        ) => {
          before.push(request);
          return new BeforeModelHookOutput({});
        },
        fireAfterModelEvent: async (
          request: Omit<HookLLMRequest, 'version'>,
        ) => {
          after.push(request);
          return new AfterModelHookOutput({});
        },
      }),
    },
  });
}

function observeProvider(requests: RuntimeGenerateChatOptions[]): IProvider {
  return {
    name: 'stub',
    getModels: async () => [],
    getDefaultModel: () => 'stub-model',
    generateChatCompletion(
      options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (!('contents' in options))
        throw new Error('Unexpected positional provider call');
      requests.push(options);
      return (async function* (): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'response' }] };
      })();
    },
  };
}

function choiceFor(origin: Origin): ToolChoice | undefined {
  const choices: Record<Origin, ToolChoice | undefined> = {
    producer: undefined,
    missing: undefined,
    none: { mode: 'none' },
    unmatched: { mode: 'auto', allowedToolNames: ['absent'] },
  };
  return choices[origin];
}

async function send(
  path: Path,
  origin: Origin,
  conversationLogPath?: string,
): Promise<{
  before: Array<Omit<HookLLMRequest, 'version'>>;
  after: Array<Omit<HookLLMRequest, 'version'>>;
  selection: Array<Omit<HookLLMRequest, 'version'>>;
  requests: RuntimeGenerateChatOptions[];
}> {
  const settingsService = new SettingsService();
  const config = new Config({
    ...createConfigParams(settingsService),
    telemetry: {
      enabled: false,
      logConversations: conversationLogPath !== undefined,
      conversationLogPath,
    },
  });
  const before: Array<Omit<HookLLMRequest, 'version'>> = [];
  const after: Array<Omit<HookLLMRequest, 'version'>> = [];
  const selection: Array<Omit<HookLLMRequest, 'version'>> = [];
  const requests: RuntimeGenerateChatOptions[] = [];
  observeHooks(config, choiceFor(origin), before, after, selection);
  const runtime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'empty-tools',
  });
  const manager = new TestRuntimeProviderManager(runtime);
  manager.setConfig(config);
  config.setProviderManager(manager);
  const provider = observeProvider(requests);
  manager.registerProvider(
    conversationLogPath === undefined
      ? provider
      : new LoggingProviderWrapper(provider),
  );
  const view = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: 'empty-tools',
      provider: 'stub',
      model: config.getModel(),
      sessionId: config.getSessionId(),
    }),
    history: new HistoryService(),
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 128000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(manager),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: runtime,
  });
  const chat = new ChatSession(view, unusedGenerator, {}, []);
  if (origin === 'producer') chat.setTools([]);
  if (origin === 'none' || origin === 'unmatched')
    chat.setTools([{ name: 'search', parametersJsonSchema: {} }]);
  if (path === 'direct')
    await chat.generateDirectMessage({ message: 'hello' }, 'empty-tools');
  else if (path === 'turn')
    await chat.sendMessage({ message: 'hello' }, 'empty-tools');
  else {
    const stream = await chat.sendMessageStream(
      { message: 'hello' },
      'empty-tools',
    );
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  }
  return { before, after, selection, requests };
}

describe.each<Path>(['direct', 'stream'])(
  '%s empty tool origin behavior',
  (path) => {
    it('keeps producer-empty tools in BeforeModel, AfterModel and provider options', async () => {
      const { before, after, requests } = await send(path, 'producer');
      expect(before).toHaveLength(1);
      expect(after).toHaveLength(1);
      expect(requests).toHaveLength(1);
      expect(before[0].tools).toStrictEqual([]);
      expect(after[0].tools).toStrictEqual([]);
      expect(requests[0].tools).toStrictEqual([]);
    });
    it.each<Origin>(['missing', 'none', 'unmatched'])(
      'omits %s tools from AfterModel while retaining path-specific BeforeModel behavior',
      async (origin) => {
        const { before, after, requests } = await send(path, origin);
        expect(before).toHaveLength(1);
        expect(after).toHaveLength(1);
        expect(requests).toHaveLength(1);
        expect(before[0].tools).toStrictEqual(
          path === 'stream' ? [] : undefined,
        );
        expect(after[0]).not.toHaveProperty('tools');
        const expectedTools =
          path === 'direct' || origin === 'missing' ? undefined : [];
        expect(requests[0].tools).toStrictEqual(expectedTools);
      },
    );
  },
);

describe.each<Path>(['direct', 'stream', 'turn'])(
  '%s empty origin conversation persistence',
  (path) => {
    it.each<Origin>(['producer', 'missing', 'none', 'unmatched'])(
      'preserves %s event and JSONL tool presentation through the real logging wrapper',
      async (origin) => {
        const dir = await mkdtemp(join(tmpdir(), 'issue3694-empty-origin-'));
        const events: ConversationRequestEvent[] = [];
        resetConversationFileWriterForTesting();
        const sink = vi
          .spyOn(telemetryLoggers, 'logConversationRequest')
          .mockImplementation((_config, event): Promise<void> => {
            events.push(event);
            return Promise.resolve();
          });
        try {
          const { before, after, selection } = await send(path, origin, dir);
          expect(selection).toHaveLength(1);
          for (const request of [...before, ...after, ...selection]) {
            expect(request).not.toHaveProperty('metadata');
            expect(request).not.toHaveProperty('conversationLogEmptyTools');
          }
          const logName = (await readdir(dir)).find((name) =>
            name.endsWith('.jsonl'),
          );
          if (logName === undefined) throw new Error('No conversation log');
          const entries: unknown[] = (
            await readFile(join(dir, logName), 'utf8')
          )
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
            .filter((entry) => entry.type === 'request');
          expect(events).toHaveLength(1);
          expect(entries).toHaveLength(1);
          let expectedTools: ConversationRequestEvent['redacted_tools'] = [];
          if (origin === 'producer')
            expectedTools = [{ functionDeclarations: [] }];
          if (path === 'direct' && origin !== 'producer')
            expectedTools = undefined;
          const entry = entries[0];
          if (
            typeof entry !== 'object' ||
            entry === null ||
            !('context' in entry)
          )
            throw new Error('Missing request context');
          const context = entry.context;
          if (typeof context !== 'object' || context === null)
            throw new Error('Invalid request context');
          expect(events[0].redacted_tools).toStrictEqual(expectedTools);
          expect('tools' in context ? context.tools : undefined).toStrictEqual(
            expectedTools,
          );
          expect(Object.prototype.hasOwnProperty.call(context, 'tools')).toBe(
            expectedTools !== undefined,
          );
        } finally {
          sink.mockRestore();
          resetConversationFileWriterForTesting();
          await rm(dir, { recursive: true, force: true });
        }
      },
    );
  },
);
