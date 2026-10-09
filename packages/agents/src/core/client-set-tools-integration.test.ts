/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createToolRegistryViewFromRegistry } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { HookLLMRequest } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import {
  BeforeModelHookOutput,
  BeforeToolSelectionHookOutput,
  AfterModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { ChatSession } from './chatSession.js';
import { TodoContinuationService } from './TodoContinuationService.js';
import { setClientTools } from './clientSetTools.js';

const schema = {
  type: 'object',
  properties: {
    sentinel: { const: 'primary-schema-sentinel' },
    nested: {
      type: 'object',
      properties: { value: { type: ['string', 'null'] } },
      required: ['value'],
      additionalProperties: false,
    },
    choice: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
  },
  required: ['sentinel', 'nested', 'choice'],
  additionalProperties: false,
};
const complexAnalysis = {
  complexityScore: 1,
  isComplex: true,
  detectedTasks: ['inspect schemas', 'verify provider output'],
  sequentialIndicators: [],
  questionCount: 2,
  shouldSuggestTodos: true,
};
const generator: ContentGenerator = {
  generateContent: async () => {
    throw new Error('Unexpected generator');
  },
  generateContentStream: async () => {
    throw new Error('Unexpected generator');
  },
  countTokens: async () => ({ totalTokens: 0 }),
  embedContent: async () => {
    throw new Error('Unexpected embedding');
  },
};

function makeConfig(settings: SettingsService): Config {
  return new Config({
    sessionId: 'flat-client-seam',
    targetDir: process.cwd(),
    cwd: process.cwd(),
    debugMode: false,
    model: 'test',
    settingsService: settings,
  });
}

function makeHarness(names: string[], disabled: string[] = []) {
  const settings = new SettingsService();
  const config = makeConfig(settings);
  const registry = new ToolRegistry(
    { getEphemeralSettings: () => ({ 'tools.disabled': disabled }) },
    new MessageBus(),
    settings,
  );
  for (const name of names)
    registry.registerTool(
      new MockTool({ name, description: `Inspect ${name}`, params: schema }),
    );
  const history = new HistoryService();
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    config,
    runtimeId: 'flat-client-seam',
  });
  const requests: Array<ToolDeclaration[] | undefined> = [];
  const provider: IProvider = {
    name: 'tool-observer',
    getModels: async () => [],
    getDefaultModel: () => 'test',
    async *generateChatCompletion(input) {
      if (!('contents' in input)) throw new Error('Expected options');
      requests.push(input.tools);
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'done' }],
        metadata: { finishReason: 'stop' },
      };
    },
  };
  const context = createAgentRuntimeContext({
    state: createAgentRuntimeState({
      runtimeId: 'flat-client-seam',
      provider: provider.name,
      model: 'test',
      sessionId: config.getSessionId(),
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
    tools: createToolRegistryViewFromRegistry(registry),
    providerRuntime: runtime,
  });
  const chat = new ChatSession(context, generator, {}, []);
  const todos = new TodoContinuationService({
    config,
    todoReminderService: new TodoReminderService(),
    complexitySuggestionCooldown: 0,
    todoDataDirResolver: () => process.cwd(),
  });
  return {
    config,
    registry,
    chat,
    todos,
    requests,
    async close(): Promise<void> {
      history.dispose();
      await config.dispose();
    },
  };
}

function expected(names: string[]): ToolDeclaration[] {
  return names.map((name) => ({
    name,
    description: `Inspect ${name}`,
    parametersJsonSchema: schema,
  }));
}

describe('client flat declarations at initialization and provider boundaries', () => {
  it.each([false, true])(
    'keeps ordered complete schemas with an existing chat: %s',
    async (initialized) => {
      const h = makeHarness(['todo_read', 'todo_write']);
      try {
        await setClientTools(
          h.registry,
          initialized ? h.chat : undefined,
          async () => h.chat,
          h.todos,
        );
        await h.chat.generateDirectMessage(
          { message: 'inspect' },
          'flat-client-seam',
        );
        expect(h.requests).toStrictEqual([
          expected(['todo_read', 'todo_write']),
        ]);
        expect(h.todos.processComplexityAnalysis(complexAnalysis, 1)).toContain(
          'TodoWrite',
        );
      } finally {
        await h.close();
      }
    },
  );

  it.each([false, true])(
    'keeps an empty producer selection with an existing chat: %s',
    async (initialized) => {
      const h = makeHarness([]);
      try {
        await setClientTools(
          h.registry,
          initialized ? h.chat : undefined,
          async () => h.chat,
          h.todos,
        );
        await h.chat.generateDirectMessage(
          { message: 'inspect' },
          'flat-client-seam',
        );
        expect(h.requests).toStrictEqual([[]]);
        expect(
          h.todos.processComplexityAnalysis(complexAnalysis, 1),
        ).toBeUndefined();
      } finally {
        await h.close();
      }
    },
  );

  it('does not initialize or replace tools when the registry is absent', async () => {
    const h = makeHarness([]);
    let initializations = 0;
    try {
      h.chat.setTools(expected(['retained']));
      await setClientTools(
        undefined,
        undefined,
        async () => {
          initializations += 1;
          return h.chat;
        },
        h.todos,
      );
      await h.chat.generateDirectMessage(
        { message: 'inspect' },
        'flat-client-seam',
      );
      expect(h.requests).toStrictEqual([expected(['retained'])]);
      expect(initializations).toBe(0);
    } finally {
      await h.close();
    }
  });
});

describe('client declaration governance and hooks', () => {
  it.each([false, true])(
    'excludes disabled tools without bypassing registry governance (existing chat: %s)',
    async (initialized) => {
      const h = makeHarness(['todo_read', 'todo_write'], ['todo_write']);
      try {
        await setClientTools(
          h.registry,
          initialized ? h.chat : undefined,
          async () => h.chat,
          h.todos,
        );
        await h.chat.generateDirectMessage(
          { message: 'inspect' },
          'flat-client-seam',
        );
        expect(h.requests).toStrictEqual([expected(['todo_read'])]);
        expect(
          h.todos.processComplexityAnalysis(complexAnalysis, 1),
        ).toBeUndefined();
      } finally {
        await h.close();
      }
    },
  );

  it('passes flat declarations with complete schemas through the BeforeModel envelope', async () => {
    const h = makeHarness(['todo_read']);
    const hooks: Array<Omit<HookLLMRequest, 'version'>> = [];
    Object.defineProperties(h.config, {
      getEnableHooks: { value: () => true },
      getHookSystem: {
        value: () => ({
          initialize: async () => {},
          isInitialized: () => true,
          fireBeforeToolSelectionEvent: async () =>
            new BeforeToolSelectionHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
          fireBeforeModelEvent: async (
            request: Omit<HookLLMRequest, 'version'>,
          ) => {
            hooks.push(request);
            return new BeforeModelHookOutput({});
          },
        }),
      },
    });
    try {
      await setClientTools(h.registry, h.chat, async () => h.chat, h.todos);
      await h.chat.generateDirectMessage(
        { message: 'inspect' },
        'flat-client-seam',
      );
      expect(hooks.map((hook) => hook.tools)).toStrictEqual([
        expected(['todo_read']),
      ]);
      expect(h.requests).toStrictEqual([expected(['todo_read'])]);
    } finally {
      await h.close();
    }
  });
});
