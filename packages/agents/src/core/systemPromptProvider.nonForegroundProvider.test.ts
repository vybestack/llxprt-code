/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import process from 'node:process';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import {
  getCoreSystemPromptAsync,
  initializePromptSystem,
} from '@vybestack/llxprt-code-core/core/prompts.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions as GenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createSettingsProviderRuntimeContext,
  deactivateSettingsRuntimeContext,
  setSettingsProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextState } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  AfterModelHookOutput,
  BeforeModelHookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import { createChatObject } from './subagentRuntimeSetup.js';

const AMBIENT_PROVIDER = 'ambient-provider-alpha';
const SUBAGENT_PROVIDER = 'subagent-provider-beta';
const SUBAGENT_MODEL = 'sub-model-v1';
const AMBIENT_SENTINEL = 'AMBIENT_PROVIDER_ALPHA_SENTINEL';
const SUBAGENT_SENTINEL = 'SUBAGENT_BETA_MODEL_SENTINEL';

describe('System prompt provider — non-foreground subagent (issue #3176, D5)', () => {
  let tempDir: string;
  let originalPromptsDir: string | undefined;

  beforeAll(async () => {
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-nonforeground-provider-'),
    );

    for (const [provider, sentinel] of [
      [AMBIENT_PROVIDER, AMBIENT_SENTINEL],
      [SUBAGENT_PROVIDER, SUBAGENT_SENTINEL],
    ] as const) {
      const dir = path.join(
        tempDir,
        'providers',
        provider,
        'models',
        SUBAGENT_MODEL,
        'core',
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'default.md'), `${sentinel}\n`);
    }

    process.env.LLXPRT_PROMPTS_DIR = tempDir;
    await initializePromptSystem();
  });

  afterEach(() => {
    deactivateSettingsRuntimeContext();
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
  });

  it('would resolve the ambient template without an explicit request provider', async () => {
    const settings = new SettingsService();
    settings.set('activeProvider', AMBIENT_PROVIDER);
    setSettingsProviderRuntimeContext(
      createSettingsProviderRuntimeContext({ settingsService: settings }),
    );

    const prompt = await getCoreSystemPromptAsync({
      model: SUBAGENT_MODEL,
      coreMemory: '',
    });

    expect(prompt).toContain(AMBIENT_SENTINEL);
    expect(prompt).not.toContain(SUBAGENT_SENTINEL);
  });

  it('sends the real template for the provider executing the subagent request', async () => {
    const settings = new SettingsService();
    settings.set('activeProvider', AMBIENT_PROVIDER);
    settings.set('model', SUBAGENT_MODEL);
    const config = new Config(createConfigParams(settings));
    const capturedCalls: GenerateChatOptions[] = [];
    const providerRuntime = createProviderRuntimeContext({
      settingsService: settings,
      config,
      runtimeId: 'test.subagent.nonforeground',
    });
    const provider: IProvider = {
      name: SUBAGENT_PROVIDER,
      isDefault: true,
      getModels: vi.fn(async () => []),
      getDefaultModel: () => SUBAGENT_MODEL,
      getCurrentModel: () => SUBAGENT_MODEL,
      generateChatCompletion: vi.fn(async function* (
        optionsOrContents:
          | GenerateChatOptions
          | GenerateChatOptions['contents'],
      ): AsyncGenerator<IContent> {
        if (Array.isArray(optionsOrContents)) {
          throw new Error('Legacy chat arguments are not used by this test');
        }
        capturedCalls.push(optionsOrContents);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] };
      }),
      getServerTools: () => [],
      invokeServerTool: vi.fn(),
    };
    const manager = new TestRuntimeProviderManager(providerRuntime);
    manager.setConfig(config);
    manager.registerProvider(provider);
    config.setProviderManager(manager);
    Object.defineProperties(config, {
      getModel: { value: () => SUBAGENT_MODEL },
      getCoreMemory: { value: () => '' },
      getConversationLoggingEnabled: { value: () => false },
      getEnableHooks: { value: () => false },
      getHookSystem: {
        value: () => ({
          initialize: async () => undefined,
          isInitialized: () => true,
          fireBeforeModelEvent: async () => new BeforeModelHookOutput({}),
          fireAfterModelEvent: async () => new AfterModelHookOutput({}),
        }),
      },
    });
    const runtimeContext = createAgentRuntimeContext({
      state: createAgentRuntimeState({
        runtimeId: 'test.subagent.nonforeground',
        provider: SUBAGENT_PROVIDER,
        model: SUBAGENT_MODEL,
        sessionId: config.getSessionId(),
        subagentName: 'test-subagent',
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
      providerRuntime,
    });
    const chat = await createChatObject({
      promptConfig: { systemPrompt: 'You are a subagent.' },
      modelConfig: { model: SUBAGENT_MODEL, temp: 0, top_p: 1 },
      runtimeContext,
      contentGenerator: {} as ContentGenerator,
      environmentContextLoader: async () => [],
      foregroundConfig: config,
      context: new ContextState(),
    });

    expect(chat).not.toBeNull();
    await chat?.sendMessage({ message: 'do the task' }, 'prompt-1');

    expect(capturedCalls).toHaveLength(1);
    const sentPrompt = capturedCalls[0].systemInstruction as string;
    expect(sentPrompt).toContain(SUBAGENT_SENTINEL);
    expect(sentPrompt).not.toContain(AMBIENT_SENTINEL);
  });
});
