import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '../../test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '../../test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import type { SettingsService } from '../../settings/SettingsService.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

type AnthropicImageBlock = {
  type: 'image';
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string };
};

type AnthropicDocumentBlock = {
  type: 'document';
  source: { type: 'base64'; media_type: string; data: string };
  title?: string;
};

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content:
        | string
        | Array<
            | { type: 'text'; text: string }
            | AnthropicImageBlock
            | AnthropicDocumentBlock
          >;
      is_error?: boolean;
    }
  | AnthropicImageBlock
  | AnthropicDocumentBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

vi.mock('../../tools/ToolFormatter.js', () => ({
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

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('System prompt'),
}));

vi.mock('../../prompt-config/subagent-delegation.js', () => ({
  shouldIncludeSubagentDelegation: vi.fn().mockReturnValue(false),
}));

vi.mock('../../utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

describe('AnthropicProvider MediaBlock support', () => {
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
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
      contents,
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
        runtimeId: 'anthropic.mediaBlock.test',
        metadata: { source: 'AnthropicProvider.mediaBlock.test.ts' },
      },
    );
    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;
    if (runtimeContext.config == null) {
      runtimeContext.config = createRuntimeConfigStub(settingsService);
    }
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

  it('should convert MediaBlocks in user messages to Anthropic image blocks', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('I see a cat'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'iVBORw0KGgo=',
            encoding: 'base64' as const,
          },
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
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const contentArray = userMsg!.content as AnthropicContentBlock[];
    expect(contentArray).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: 'What is in this image?',
        }),
        expect.objectContaining({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        }),
      ]),
    );
  });

  it('should include MediaBlocks in tool_result content as multipart array', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('I see the image'));

    const toolCallId = 'hist_tool_readfile_456';
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Read that image' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'read_file',
            parameters: { path: 'photo.png' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallId,
            toolName: 'read_file',
            result: { output: 'Binary content provided (1 item(s)).' },
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'iVBORw0KGgo=',
            encoding: 'base64' as const,
          },
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

    const toolResultMsg = anthropicMessages.find(
      (msg) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();

    const toolResultBlock = (
      toolResultMsg!.content as AnthropicContentBlock[]
    ).find((b) => b.type === 'tool_result') as AnthropicContentBlock & {
      type: 'tool_result';
    };
    expect(toolResultBlock).toBeDefined();

    expect(Array.isArray(toolResultBlock.content)).toBe(true);
    const contentParts = toolResultBlock.content as Array<
      { type: 'text'; text: string } | AnthropicImageBlock
    >;

    const textPart = contentParts.find((p) => p.type === 'text');
    expect(textPart).toBeDefined();

    const imagePart = contentParts.find((p) => p.type === 'image');
    expect(imagePart).toBeDefined();
    expect(imagePart).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    });
  });

  it('should strip data URI prefix from MediaBlock data for Anthropic', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Describe this' },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'data:image/jpeg;base64,/9j/4AAQ=',
            encoding: 'base64' as const,
          },
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
    const contentArray = userMsg!.content as AnthropicContentBlock[];

    const imageBlock = contentArray.find(
      (b) => b.type === 'image',
    ) as AnthropicImageBlock;
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source.type).toBe('base64');
    expect(imageBlock.source).toMatchObject({
      type: 'base64',
      media_type: 'image/jpeg',
      data: '/9j/4AAQ=',
    });
  });

  it('should use url source type for URL-encoded media', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Describe this' },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'https://example.com/photo.jpg',
            encoding: 'url' as const,
          },
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
    const contentArray = userMsg!.content as AnthropicContentBlock[];

    const imageBlock = contentArray.find(
      (b) => b.type === 'image',
    ) as AnthropicImageBlock;
    expect(imageBlock).toBeDefined();
    expect(imageBlock.source).toMatchObject({
      type: 'url',
      url: 'https://example.com/photo.jpg',
    });
  });

  it('should convert PDF MediaBlock to Anthropic document block in user messages', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Read this PDF' },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'JVBERi0xLjQ=',
            encoding: 'base64' as const,
            filename: 'report.pdf',
          },
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
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const contentArray = userMsg!.content as AnthropicContentBlock[];
    const docBlock = contentArray.find(
      (b) => b.type === 'document',
    ) as AnthropicDocumentBlock;
    expect(docBlock).toBeDefined();
    expect(docBlock.source).toStrictEqual({
      type: 'base64',
      media_type: 'application/pdf',
      data: 'JVBERi0xLjQ=',
    });
    expect(docBlock.title).toBe('report.pdf');
  });

  it('should convert PDF MediaBlock in tool responses to document block', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const toolCallId = 'hist_tool_readfile_789';
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Read this file' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: toolCallId,
            name: 'read_file',
            parameters: { path: 'doc.pdf' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: toolCallId,
            toolName: 'read_file',
            result: { output: 'Binary content provided (1 item(s)).' },
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'JVBERi0xLjQ=',
            encoding: 'base64' as const,
            filename: 'doc.pdf',
          },
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

    const toolResultMsg = anthropicMessages.find(
      (msg) =>
        msg.role === 'user' &&
        Array.isArray(msg.content) &&
        msg.content.some((b) => b.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();

    const toolResultBlock = (
      toolResultMsg!.content as AnthropicContentBlock[]
    ).find((b) => b.type === 'tool_result') as AnthropicContentBlock & {
      type: 'tool_result';
    };
    expect(Array.isArray(toolResultBlock.content)).toBe(true);

    const contentParts = toolResultBlock.content as Array<
      | { type: 'text'; text: string }
      | AnthropicImageBlock
      | AnthropicDocumentBlock
    >;
    const docPart = contentParts.find(
      (p) => p.type === 'document',
    ) as AnthropicDocumentBlock;
    expect(docPart).toBeDefined();
    expect(docPart.source).toStrictEqual({
      type: 'base64',
      media_type: 'application/pdf',
      data: 'JVBERi0xLjQ=',
    });
  });

  it('should produce text placeholder for unsupported media in user messages', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Play this audio' },
          {
            type: 'media',
            mimeType: 'audio/mpeg',
            data: 'audiodata',
            encoding: 'base64' as const,
            filename: 'song.mp3',
          },
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
    expect(Array.isArray(userMsg!.content)).toBe(true);

    const contentArray = userMsg!.content as AnthropicContentBlock[];
    const placeholder = contentArray.find(
      (b) => b.type === 'text' && b.text.includes('Unsupported'),
    ) as { type: 'text'; text: string };
    expect(placeholder).toBeDefined();
    expect(placeholder.text).toContain('audio/mpeg');
    expect(placeholder.text).toContain('song.mp3');
    expect(placeholder.text).toContain('Anthropic');
  });

  it('should never silently drop media - each MediaBlock produces output', async () => {
    mockMessagesCreate.mockResolvedValue(createMockStream('OK'));

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Mixed media' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'imgdata',
            encoding: 'base64' as const,
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'pdfdata',
            encoding: 'base64' as const,
          },
          {
            type: 'media',
            mimeType: 'video/mp4',
            data: 'viddata',
            encoding: 'base64' as const,
          },
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
    const contentArray = userMsg!.content as AnthropicContentBlock[];

    expect(contentArray).toHaveLength(4);
    const types = contentArray.map((b) => b.type);
    expect(types).toContain('image');
    expect(types).toContain('document');
    expect(types.filter((t) => t === 'text')).toHaveLength(2);
  });
});
