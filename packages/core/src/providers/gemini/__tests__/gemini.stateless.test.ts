/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P11
 * @requirement REQ-SP2-001
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../../settings/SettingsService.js';
import { createProviderRuntimeContext } from '../../../runtime/providerRuntimeContext.js';
import { createRuntimeConfigStub } from '../../../test-utils/runtime.js';
import type { Config } from '../../../config/config.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { IProviderConfig } from '../../types/IProviderConfig.js';
import { GeminiProvider } from '../GeminiProvider.js';
import { createCodeAssistContentGenerator } from '../../code_assist/codeAssist.js';

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

const queueCodeAssistStream = (
  responses: Array<Record<string, unknown>>,
): void => {
  codeAssistState.streamPlans.push(responses);
};

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
      'login-with-google' as never,
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
      determineBestAuth(): Promise<string>;
    },
    'determineBestAuth',
  );

  spy.mockImplementation(async function (this: GeminiProvider) {
    const config = modes[activeIndex] ?? modes[modes.length - 1];
    (this as unknown as { authMode: 'gemini-api-key' | 'oauth' }).authMode =
      config.authMode;
    return config.token;
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
});

describe('Gemini provider stateless contract tests', () => {
  it('emits usage metadata chunks during streaming @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 5-7', async () => {
    queueGoogleStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'first-chunk' }],
            },
          },
        ],
      },
      {
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 2,
          totalTokenCount: 5,
        },
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-stream' },
    ]);
    authMock.useMode(0);

    const provider = new TestGeminiProvider();
    provider.setEphemeralSettings({ streaming: 'disabled' });
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-stream');
    const config = createRuntimeConfigStub(settings, {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    }) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-stream',
      settingsService: settings,
      config,
    });

    const chunks = await collectResults(
      provider.generateChatCompletion({
        contents: [createHumanContent('ping')],
        settings,
        runtime,
      }),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(0);
    expect(googleGenAIState.nonStreamCalls).toHaveLength(1);
    expect(chunks).not.toHaveLength(0);
  });

  it('includes server tool declarations for Gemini streams @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 4-6', async () => {
    queueGoogleStream([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    id: 'tool-123',
                    name: 'fetchSomething',
                    args: { query: 'search' },
                  },
                },
              ],
            },
          },
        ],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'gemini-api-key', token: 'token-tools' },
    ]);
    authMock.useMode(0);

    const provider = new TestGeminiProvider();
    const settings = new SettingsService();
    settings.set('call-id', 'runtime-tools');
    const config = createRuntimeConfigStub(settings) as Config;
    provider.setConfig(config);
    const runtime = createProviderRuntimeContext({
      runtimeId: 'runtime-tools',
      settingsService: settings,
      config,
    });

    await collectResults(
      provider.generateChatCompletion({
        contents: [createHumanContent('use tool')],
        settings,
        runtime,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'fetchSomething',
                description: 'fetch data',
                parametersJsonSchema: {},
              },
            ],
          },
        ],
      }),
    );

    authMock.restore();

    expect(googleGenAIState.streamCalls).toHaveLength(1);
    const request = googleGenAIState.streamCalls[0]?.request ?? {};
    const toolConfig = request.config as Record<string, unknown>;
    expect(toolConfig?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionDeclarations: expect.arrayContaining([
            expect.objectContaining({
              name: 'fetchSomething',
            }),
          ]),
        }),
      ]),
    );
    expect(toolConfig?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionDeclarations: expect.arrayContaining([
            expect.objectContaining({
              parameters: expect.objectContaining({ type: 'object' }),
            }),
          ]),
        }),
      ]),
    );

    const toolChunks = googleGenAIState.streamCalls[0]?.request;
    expect(toolChunks).toEqual(
      expect.objectContaining({
        config: expect.objectContaining({
          serverTools: expect.arrayContaining(['web_search', 'web_fetch']),
        }),
      }),
    );
  });

  it('scopes OAuth streaming sessions by runtime @plan:PLAN-20251018-STATELESSPROVIDER2.P11 @requirement:REQ-SP2-001 @pseudocode anthropic-gemini-stateless.md lines 3-6', async () => {
    queueCodeAssistStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'oauth-chunk' }],
            },
          },
        ],
      },
    ]);

    const authMock = mockDetermineBestAuth([
      { authMode: 'oauth', token: 'oauth-token' },
      { authMode: 'oauth', token: 'oauth-token' },
    ]);
    authMock.useMode(0);

    const provider = new TestGeminiProvider();
    const settingsA = new SettingsService();
    settingsA.set('call-id', 'runtime-oauth-a');
    const configA = createRuntimeConfigStub(settingsA) as Config;
    const settingsB = new SettingsService();
    settingsB.set('call-id', 'runtime-oauth-b');
    const configB = createRuntimeConfigStub(settingsB) as Config;
    provider.setConfig(configA);
    const runtimeA = createProviderRuntimeContext({
      runtimeId: 'runtime-oauth-a',
      settingsService: settingsA,
      config: configA,
    });

    const runtimeB = createProviderRuntimeContext({
      runtimeId: 'runtime-oauth-b',
      settingsService: settingsB,
      config: configB,
    });

    const oauthIteratorA = provider.generateChatCompletion({
      contents: [createHumanContent('oauth-a')],
      settings: settingsA,
      runtime: runtimeA,
    });
    await oauthIteratorA.next();

    authMock.useMode(1);

    queueCodeAssistStream([
      {
        candidates: [
          {
            content: {
              parts: [{ text: 'oauth-chunk-b' }],
            },
          },
        ],
      },
    ]);

    const oauthIteratorB = provider.generateChatCompletion({
      contents: [createHumanContent('oauth-b')],
      settings: settingsB,
      runtime: runtimeB,
    });
    await oauthIteratorB.next();

    authMock.restore();

    expect(codeAssistState.streamCalls).toHaveLength(2);
    const firstSession = codeAssistState.streamCalls[0]?.sessionId;
    const secondSession = codeAssistState.streamCalls[1]?.sessionId;
    expect(firstSession).toContain('runtime-oauth-a');
    expect(secondSession).toContain('runtime-oauth-b');
    expect(firstSession).not.toBe(secondSession);
  });
});
