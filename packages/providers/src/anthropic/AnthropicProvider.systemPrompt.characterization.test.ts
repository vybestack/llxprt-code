/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Byte-for-byte characterization test (tripwire) for the Anthropic system
 * prompt wire format. This test locks CURRENT behavior so that any later
 * change to the provider-side prompt assembly (issue #3136 steps 4-7) is
 * immediately visible. It must pass on the unmodified code BEFORE those
 * changes land.
 *
 * Covers:
 *  - OAuth path: `system` field is a fixed Claude Code string; the real
 *    prompt is delivered as messages[0] role 'user' wrapped in
 *    `<system>...</system>\n\nUser provided conversation begins here:`
 *    with cache_control when caching is on, plain string when off.
 *  - Non-OAuth path: `system` is an array-with-cache_control when caching
 *    on, a bare string when off, undefined when the prompt is empty.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  setupAnthropicProvider,
  type AnthropicMessage,
  type AnthropicContentBlock,
} from './test-utils/anthropicProviderTestSetup.js';

const MOCK_CORE_PROMPT = 'MOCK_CORE_PROMPT_CONTENT';

const mockMessagesCreate = vi.fn();

void vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[]) => tools),
    fromProviderFormat: vi.fn((raw: unknown) => [raw]),
    convertToolDeclarationsToAnthropic: vi.fn(() => []),
    convertToolDeclarationsToFormat: vi.fn(() => undefined),
  })),
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => MOCK_CORE_PROMPT),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

void vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield { id: 'claude-sonnet-4-20250514', display_name: 'Sonnet 4' };
          },
        }),
      },
    },
  })),
}));

const OAUTH_SYSTEM_FIELD =
  "You are Claude Code, Anthropic's official CLI for Claude.";

const SINGLE_MESSAGE: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
];

interface CapturedRequest {
  system: string | AnthropicContentBlock[] | undefined;
  messages: AnthropicMessage[];
}

function captureRequest(): CapturedRequest {
  const call = mockMessagesCreate.mock.calls[0];
  expect(call).toBeDefined();
  return call[0] as CapturedRequest;
}

function buildOptions(
  providerName: string,
  contents: IContent[],
  settingsService: SettingsService,
  setup: ReturnType<typeof setupAnthropicProvider>,
  overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  systemInstruction?: string,
): ReturnType<typeof createProviderCallOptions> {
  const base = createProviderCallOptions({
    providerName,
    contents,
    settings: settingsService,
    runtime: setup.runtimeContext,
    config: setup.runtimeContext.config!,
    ...overrides,
  });
  return systemInstruction !== undefined
    ? { ...base, systemInstruction }
    : base;
}

describe('AnthropicProvider — system prompt characterization (tripwire)', () => {
  let settingsService: SettingsService;
  let setup: ReturnType<typeof setupAnthropicProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    setup = setupAnthropicProvider();
    settingsService = setup.settingsService;
    setup.runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings('anthropic'),
    });
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  // -------------------------------------------------------------------------
  // OAuth path
  // -------------------------------------------------------------------------

  describe('OAuth system field', () => {
    function makeOAuthProvider(
      caching: 'off' | '5m' | '1h',
    ): AnthropicProvider {
      settingsService.setProviderSetting(
        'anthropic',
        'prompt-caching',
        caching,
      );
      const provider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
          }),
        },
      );
      vi.spyOn(provider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );
      return provider;
    }

    function mockResponse(): void {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
    }

    it('system field is exactly the Claude Code string and contains no prompt markers', async () => {
      mockResponse();
      const provider = makeOAuthProvider('1h');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'CALLER_INSTRUCTION',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      expect(req.system).toBe(OAUTH_SYSTEM_FIELD);
      expect(typeof req.system).toBe('string');
    });

    it('messages[0] role is user with exact <system> wrapping format (caching ON 1h)', async () => {
      mockResponse();
      const provider = makeOAuthProvider('1h');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'CALLER_INSTRUCTION',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      const first = req.messages[0];
      expect(first.role).toBe('user');
      expect(Array.isArray(first.content)).toBe(true);
      const block = (first.content as AnthropicContentBlock[])[0];
      expect(block.type).toBe('text');
      expect(block.text).toBe(
        `<system>\nCALLER_INSTRUCTION\n</system>\n\nUser provided conversation begins here:`,
      );
    });

    it('messages[0] block carries cache_control with resolved ttl when caching is ON (1h)', async () => {
      mockResponse();
      const provider = makeOAuthProvider('1h');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'ASSEMBLED_PROMPT',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      const block = (req.messages[0].content as AnthropicContentBlock[])[0];
      expect(block.cache_control).toStrictEqual({
        type: 'ephemeral',
        ttl: '1h',
      });
    });

    it('messages[0] block carries cache_control ttl 5m when caching is 5m', async () => {
      mockResponse();
      const provider = makeOAuthProvider('5m');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'ASSEMBLED_PROMPT',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      const block = (req.messages[0].content as AnthropicContentBlock[])[0];
      expect(block.cache_control).toStrictEqual({
        type: 'ephemeral',
        ttl: '5m',
      });
    });

    it('messages[0] is a plain string with no cache_control when caching is OFF', async () => {
      mockResponse();
      const provider = makeOAuthProvider('off');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'ASSEMBLED_PROMPT',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      const first = req.messages[0];
      expect(first.role).toBe('user');
      expect(typeof first.content).toBe('string');
      expect(first.content).toBe(
        `<system>\nASSEMBLED_PROMPT\n</system>\n\nUser provided conversation begins here:`,
      );
    });

    it('delivers the caller systemInstruction verbatim so subagent personas reach the OAuth path (#2410)', async () => {
      mockResponse();
      const provider = makeOAuthProvider('off');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'SUBAGENT_PERSONA',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      const first = req.messages[0];
      expect(first.content).toBe(
        `<system>\nSUBAGENT_PERSONA\n</system>\n\nUser provided conversation begins here:`,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Non-OAuth path
  // -------------------------------------------------------------------------

  describe('Non-OAuth system field', () => {
    function makeProvider(caching: 'off' | '5m' | '1h'): AnthropicProvider {
      settingsService.setProviderSetting(
        'anthropic',
        'prompt-caching',
        caching,
      );
      return new AnthropicProvider('test-api-key', undefined, {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          ...settingsService.getAllGlobalSettings(),
          ...settingsService.getProviderSettings('anthropic'),
        }),
      });
    }

    it('system is an array of one text block WITH cache_control when caching is ON', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const provider = makeProvider('5m');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'ASSEMBLED_PROMPT',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      expect(Array.isArray(req.system)).toBe(true);
      const blocks = req.system as AnthropicContentBlock[];
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('text');
      expect(blocks[0].text).toBe('ASSEMBLED_PROMPT');
      expect(blocks[0].cache_control).toStrictEqual({
        type: 'ephemeral',
        ttl: '5m',
      });
    });

    it('system is a bare string when caching is OFF', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const provider = makeProvider('off');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'ASSEMBLED_PROMPT',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      expect(typeof req.system).toBe('string');
      expect(req.system).toBe('ASSEMBLED_PROMPT');
    });

    it('fails fast instead of sending a prompt-less request when no systemInstruction is supplied', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const provider = makeProvider('5m');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        {
          streaming: 'disabled',
          systemInstruction: undefined,
        } as unknown as ProviderCallOptionsInit,
      );
      const gen = provider.generateChatCompletion(options);

      await expect(gen.next()).rejects.toThrow(/agent layer owns assembly/i);
      expect(mockMessagesCreate).not.toHaveBeenCalled();
    });

    it('delivers the caller systemInstruction verbatim (caching OFF)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      const provider = makeProvider('off');
      const options = buildOptions(
        'anthropic',
        SINGLE_MESSAGE,
        settingsService,
        setup,
        { streaming: 'disabled' } as unknown as ProviderCallOptionsInit,
        'EXTRA_DIRECTIVE',
      );
      const gen = provider.generateChatCompletion(options);
      await gen.next();

      const req = captureRequest();
      expect(typeof req.system).toBe('string');
      expect(req.system).toBe('EXTRA_DIRECTIVE');
    });
  });
});
