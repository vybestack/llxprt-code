/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import type { Config } from '../../../config/config.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { IProviderConfig } from '../../types/IProviderConfig.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { createCodeAssistContentGenerator } from '../../code_assist/codeAssist.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../../test-utils/providerCallOptions.js';

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

const googleGenAIState = {
  instances: [] as Array<{ options: Record<string, unknown> }>,
  streamCalls: [] as Array<{ request: Record<string, unknown> }>,
  nonStreamCalls: [] as Array<{ request: Record<string, unknown> }>,
  streamPlans: [] as Array<Array<Record<string, unknown>>>,
};

const codeAssistState = {
  streamCalls: [] as Array<{
    request: Record<string, unknown>;
    sessionId: string | undefined;
  }>,
  streamPlans: [] as Array<Array<Record<string, unknown>>>,
};

vi.mock('@google/genai', () => {
  class FakeGoogleGenAI {
    readonly models: {
      generateContentStream: ReturnType<typeof vi.fn>;
    };

    constructor(opts: Record<string, unknown>) {
      googleGenAIState.instances.push({ options: opts });
      this.models = {
        generateContentStream: vi.fn(async function* (
          request: Record<string, unknown>,
        ) {
          googleGenAIState.streamCalls.push({ request });
          const plan = googleGenAIState.streamPlans.shift() ?? [];
          for (const response of plan) {
            yield response;
          }
        }),
        generateContent: vi.fn(async (request: Record<string, unknown>) => {
          googleGenAIState.nonStreamCalls.push({ request });
          return {
            candidates: [],
          };
        }),
      };
    }
  }

  const Type = { OBJECT: 'object' };

  return { GoogleGenAI: FakeGoogleGenAI, Type };
});

vi.mock('../../code_assist/codeAssist.js', () => ({
  createCodeAssistContentGenerator: vi.fn(async () => ({
    generateContentStream: vi.fn(
      (request: Record<string, unknown>, sessionId?: string) => {
        codeAssistState.streamCalls.push({
          request,
          sessionId,
        });
        const plan = codeAssistState.streamPlans.shift() ?? [];
        return {
          async *[Symbol.asyncIterator]() {
            for (const response of plan) {
              yield response;
            }
          },
        };
      },
    ),
  })),
}));

const queueGoogleStream = (responses: Array<Record<string, unknown>>): void => {
  googleGenAIState.streamPlans.push(responses);
};

function buildCallOptions(
  provider: GeminiProvider,
  overrides: Omit<ProviderCallOptionsInit, 'providerName'> = {},
) {
  const { contents = [], ...rest } = overrides;
  return createProviderCallOptions({
    providerName: provider.name,
    contents,
    ...rest,
  });
}

class TestGeminiProvider extends GeminiProvider {
  setEphemeralSettings(settings: Record<string, unknown>): void {
    const currentConfig = (
      this as unknown as { providerConfig?: IProviderConfig }
    ).providerConfig;
    (this as unknown as { providerConfig?: IProviderConfig }).providerConfig = {
      ...(currentConfig ?? {}),
      getEphemeralSettings: () => settings,
    };
  }

  protected override async createOAuthContentGenerator(
    httpOptions: Record<string, unknown>,
    config: unknown,
    baseURL?: string,
  ) {
    return (await createCodeAssistContentGenerator(
      httpOptions,
      config as never,
      baseURL,
    )) as Awaited<ReturnType<typeof createCodeAssistContentGenerator>>;
  }
}

const mockDetermineBestAuth = (
  modes: Array<{ authMode: 'gemini-api-key' | 'oauth'; token: string }>,
) => {
  let activeIndex = 0;
  const spy = vi.spyOn(
    GeminiProvider.prototype as unknown as {
      determineBestAuth(): Promise<{ authMode: string; token: string }>;
    },
    'determineBestAuth',
  );

  spy.mockImplementation(async () => {
    const config = modes[activeIndex] ?? modes[modes.length - 1];
    return { authMode: config.authMode, token: config.token };
  });

  return {
    spy,
    useMode(index: number) {
      activeIndex = index;
    },
    restore() {
      spy.mockRestore();
    },
  };
};

const createHumanContent = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

const collectResults = async (
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> => {
  const results: IContent[] = [];
  for await (const chunk of iterator) {
    results.push(chunk);
  }
  return results;
};

beforeEach(() => {
  googleGenAIState.instances.length = 0;
  googleGenAIState.streamCalls.length = 0;
  googleGenAIState.nonStreamCalls.length = 0;
  googleGenAIState.streamPlans.length = 0;
  codeAssistState.streamCalls.length = 0;
  codeAssistState.streamPlans.length = 0;
  vi.mocked(createCodeAssistContentGenerator).mockClear();
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({
      settingsService: new SettingsService(),
      runtimeId: 'gemini-thinkingLevel-test',
    }),
  );
});

afterEach(() => {
  clearActiveProviderRuntimeContext();
});

describe('Gemini provider thinkingLevel tests', () => {
  it('Gemini 2.x model uses thinkingBudget when reasoning enabled', async () => {
    queueGoogleStream([
      {
        candidates: [{ content: { parts: [{ text: 'thinking-2x' }] } }],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-think-2x' },
    ]);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-think-2x');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-think-2x',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion(
        buildCallOptions(provider, {
          contents: [createHumanContent('test thinking 2x')],
          settings,
          config,
          runtime,
          ephemerals: {
            'reasoning.enabled': true,
          },
          resolved: { model: 'gemini-2.5-pro' },
        }),
      ),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request as {
      config?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(request?.config?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: -1,
    });
  });

  it('Gemini 3.x model uses thinkingLevel when reasoning.effort is set', async () => {
    queueGoogleStream([
      {
        candidates: [{ content: { parts: [{ text: 'thinking-3x' }] } }],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-think-3x' },
    ]);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-think-3x');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-think-3x',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion(
        buildCallOptions(provider, {
          contents: [createHumanContent('test thinking 3x')],
          settings,
          config,
          runtime,
          ephemerals: {
            'reasoning.enabled': true,
            'reasoning.effort': 'high',
          },
          resolved: { model: 'gemini-3-flash-preview' },
        }),
      ),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request as {
      config?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(request?.config?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingLevel: 'HIGH',
    });
    // Gemini 3.x must NOT have thinkingBudget
    expect(request?.config?.thinkingConfig).not.toHaveProperty(
      'thinkingBudget',
    );
  });

  it('Gemini 3.x model maps each effort level correctly', async () => {
    const effortMappings: Array<{
      effort: string;
      expected: string;
    }> = [
      { effort: 'minimal', expected: 'LOW' },
      { effort: 'low', expected: 'LOW' },
      { effort: 'medium', expected: 'MEDIUM' },
      { effort: 'high', expected: 'HIGH' },
      { effort: 'xhigh', expected: 'HIGH' },
    ];

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-effort-map' },
    ]);

    for (const { effort, expected } of effortMappings) {
      googleGenAIState.streamCalls.length = 0;
      queueGoogleStream([
        {
          candidates: [{ content: { parts: [{ text: `effort-${effort}` }] } }],
        },
      ]);

      const provider = new TestGeminiProvider();
      const settings = new SettingsService();
      settings.set('call-id', `runtime-effort-${effort}`);
      const config = createRuntimeConfigStub(settings) as Config;
      provider.setConfig(config);
      const runtime = createProviderRuntimeContext({
        runtimeId: `runtime-effort-${effort}`,
        settingsService: settings,
        config,
      });

      await collectResults(
        provider.generateChatCompletion(
          buildCallOptions(provider, {
            contents: [createHumanContent(`test effort ${effort}`)],
            settings,
            config,
            runtime,
            ephemerals: {
              'reasoning.enabled': true,
              'reasoning.effort': effort,
            },
            resolved: { model: 'gemini-3-pro-preview' },
          }),
        ),
      );

      const request = googleGenAIState.streamCalls[0]?.request as {
        config?: { thinkingConfig?: Record<string, unknown> };
      };
      expect(request?.config?.thinkingConfig?.thinkingLevel).toBe(expected);
      expect(request?.config?.thinkingConfig?.includeThoughts).toBe(true);
      expect(request?.config?.thinkingConfig).not.toHaveProperty(
        'thinkingBudget',
      );
    }

    authMock.restore();
  });

  it('Gemini 3.x model without effort has no thinkingLevel or thinkingBudget', async () => {
    queueGoogleStream([
      {
        candidates: [{ content: { parts: [{ text: 'thinking-3x-default' }] } }],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-think-3x-default' },
    ]);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-think-3x-default');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-think-3x-default',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion(
        buildCallOptions(provider, {
          contents: [createHumanContent('test thinking 3x default')],
          settings,
          config,
          runtime,
          ephemerals: {
            'reasoning.enabled': true,
          },
          resolved: { model: 'gemini-3-flash-preview' },
        }),
      ),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request as {
      config?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(request?.config?.thinkingConfig).toEqual({
      includeThoughts: true,
    });
    expect(request?.config?.thinkingConfig).not.toHaveProperty('thinkingLevel');
    expect(request?.config?.thinkingConfig).not.toHaveProperty(
      'thinkingBudget',
    );
  });

  it('Gemini 2.x model uses reasoningMaxTokens for thinkingBudget', async () => {
    queueGoogleStream([
      {
        candidates: [{ content: { parts: [{ text: 'thinking-2x-budget' }] } }],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-think-2x-budget' },
    ]);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-think-2x-budget');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-think-2x-budget',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion(
        buildCallOptions(provider, {
          contents: [createHumanContent('test thinking 2x budget')],
          settings,
          config,
          runtime,
          ephemerals: {
            'reasoning.enabled': true,
            'reasoning.maxTokens': 4096,
          },
          resolved: { model: 'gemini-2.5-flash' },
        }),
      ),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request as {
      config?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(request?.config?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: 4096,
    });
  });

  it('Gemini 2.x model defaults thinkingBudget to -1', async () => {
    queueGoogleStream([
      {
        candidates: [{ content: { parts: [{ text: 'thinking-2x-auto' }] } }],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-think-2x-auto' },
    ]);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-think-2x-auto');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-think-2x-auto',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion(
        buildCallOptions(provider, {
          contents: [createHumanContent('test thinking 2x auto')],
          settings,
          config,
          runtime,
          ephemerals: {
            'reasoning.enabled': true,
          },
          resolved: { model: 'gemini-2.5-pro' },
        }),
      ),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request as {
      config?: { thinkingConfig?: Record<string, unknown> };
    };
    expect(request?.config?.thinkingConfig).toEqual({
      includeThoughts: true,
      thinkingBudget: -1,
    });
  });
});
