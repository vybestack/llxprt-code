import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | AnthropicContentBlock[];
      is_error?: boolean;
    };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn(() => []),
    fromProviderFormat: vi.fn(() => []),
  })),
}));

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield {
              id: 'claude-sonnet-4-20250514',
              display_name: 'Claude 4 Sonnet',
            };
          },
        }),
      },
    },
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('System prompt'),
}));

vi.mock(
  '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js',
  () => ({
    shouldIncludeSubagentDelegation: vi.fn().mockReturnValue(false),
  }),
);

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

describe('AnthropicProvider multi-block human message assembly', () => {
  let provider: AnthropicProvider;
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  const createMockStream = (text: string) => ({
    async *[Symbol.asyncIterator]() {
      yield {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text },
      };
    },
  });

  const buildCallOptions = (
    contents: IContent[],
    overrides?: Omit<
      Partial<ProviderCallOptionsInit>,
      'providerName' | 'contents'
    >,
  ) =>
    createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
    });

  beforeEach(() => {
    vi.clearAllMocks();

    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');
        svc.setProviderSetting('anthropic', 'prompt-caching', 'off');
        return new AnthropicProvider(
          'test-api-key',
          undefined,
          TEST_PROVIDER_CONFIG,
        );
      },
      {
        runtimeId: 'anthropic.multiBlock.test',
        metadata: { source: 'AnthropicProvider.multiBlock.test.ts' },
      },
    );
    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;
    runtimeContext.config ??= createRuntimeConfigStub(settingsService);
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings(provider.name),
    });
    runtimeContext.config.getEphemeralSetting = (key: string) => {
      const providerValue = settingsService.getProviderSetting(
        provider.name,
        key,
      );
      if (providerValue !== undefined) {
        return providerValue;
      }
      return settingsService.get(key);
    };

    setActiveProviderRuntimeContext(runtimeContext);
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('should concatenate all text blocks in a multi-block human message', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('FirstSecond');
  });

  it('should preserve spacing between concatenated text blocks', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: ' World' },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('Hello World');
  });

  it('should produce a plain string (not an array) for a text-only multi-block message', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'First' },
          { type: 'text', text: 'Second' },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(typeof userMsg!.content).toBe('string');
    expect(Array.isArray(userMsg!.content)).toBe(false);
  });

  it('should not trim leading or trailing whitespace from concatenated text', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: ' First' },
          { type: 'text', text: 'Second ' },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe(' FirstSecond ');
  });

  it('should wrap a CodeBlock in fenced markdown alongside a TextBlock', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: "Here's code:" },
          { type: 'code', code: 'const x = 1', language: 'typescript' },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe(
      "Here's code:\n\n```typescript\nconst x = 1\n```\n",
    );
  });

  it('should replace an empty-blocks human message with the empty placeholder', async () => {
    // Empty content is rejected by strict endpoints; the sanitizer substitutes a placeholder.
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('[Empty message]');
  });

  it('should replace an empty-string-only TextBlock with the empty placeholder', async () => {
    // Falsy text is skipped by the concatenator, yielding '', which the sanitizer replaces.
    mockMessagesCreate.mockResolvedValue(createMockStream('ok'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: '' }],
      },
    ];

    const generator = provider.generateChatCompletion(
      buildCallOptions(messages),
    );
    for await (const _chunk of generator) {
      // consume
    }

    const request = mockMessagesCreate.mock.calls[0][0];
    const anthropicMessages = request.messages as AnthropicMessage[];

    const userMsg = anthropicMessages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).toBe('[Empty message]');
  });
});
