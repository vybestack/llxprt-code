/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Headless provider-manager construction verification (issue #1594 unblock proof).
 *
 * This test proves a fully functional {@link ProviderManager} — with real alias
 * providers and OAuth infrastructure — can be constructed without importing
 * anything from the CLI package (`@vybestack/llxprt-code`). It imports only
 * sibling composition modules (relative paths) and the public
 * `@vybestack/llxprt-code-settings` / `@vybestack/llxprt-code-core` packages,
 * both legitimate providers dependencies.
 *
 * Filesystem isolation follows the established composition-test pattern:
 * `vi.mock('strip-json-comments')`, `vi.mock('os')`, and a {@link MockFileSystem}
 * wired via {@link setFileSystem} so the factory never reads the real user
 * settings file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock os so Storage.getGlobalSettingsPath() resolves under a fake homedir.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(() => '/home/headless-user'),
    platform: vi.fn(() => 'linux'),
  };
});

// Mock strip-json-comments so the raw settings read is a passthrough.
vi.mock('strip-json-comments', () => ({
  default: (content: string) => content,
}));

// Keep the concrete-provider completion proof hermetic: stub the system-prompt
// resolution so no prompt files are read from disk.
vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

import type OpenAI from 'openai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { MockFileSystem } from '../composition/IFileSystem.js';
import { setFileSystem } from '../composition/providerManagerInstance.js';
import { createHeadlessProviderManager } from '../composition/headlessFactory.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IModel } from '../IModel.js';

describe('headless provider-manager construction (issue #1594)', () => {
  let mockFileSystem: MockFileSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileSystem = new MockFileSystem();
    // No mock settings file is registered, so resolveUserSettings() returns
    // undefined and the factory uses defaults — no real user settings are read.
    setFileSystem(mockFileSystem);
  });

  it('constructs a working manager for openai', () => {
    const { manager } = createHeadlessProviderManager({ provider: 'openai' });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('openai');
    expect(manager.listProviders()).toContain('openai');
  });

  it('constructs a working manager for anthropic', () => {
    const { manager } = createHeadlessProviderManager({
      provider: 'anthropic',
    });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('anthropic');
    expect(manager.listProviders()).toContain('anthropic');
  });

  it('constructs a working manager for gemini', () => {
    const { manager } = createHeadlessProviderManager({ provider: 'gemini' });

    expect(manager.hasActiveProvider()).toBe(true);
    expect(manager.getActiveProviderName()).toBe('gemini');
    expect(manager.listProviders()).toContain('gemini');
  });

  it('returns an OAuth manager alongside the provider manager', () => {
    const { oauthManager } = createHeadlessProviderManager({
      provider: 'openai',
    });
    expect(oauthManager).toBeDefined();
  });

  it('throws when an unregistered provider is requested', () => {
    expect(() =>
      createHeadlessProviderManager({
        provider: 'this-provider-does-not-exist',
      }),
    ).toThrow('Provider not found');
  });

  it('applies the model option to the active provider', () => {
    // The model option is written into the provider-scoped settings before
    // activation; concrete providers resolve their effective model from
    // SettingsService.getProviderSettings(name) via BaseProvider. This proves
    // the option is functional (not a no-op) without needing network or keys.
    const requestedModel = 'gemini-2.5-flash';
    const { manager } = createHeadlessProviderManager({
      provider: 'gemini',
      model: requestedModel,
    });

    const getCurrentModel = manager.getActiveProvider().getCurrentModel;
    expect(typeof getCurrentModel).toBe('function');

    const currentModel = manager.getActiveProvider().getCurrentModel!();
    expect(currentModel).toBe(requestedModel);
  });

  it('routes a completion through the active provider of a headlessly-constructed manager (no CLI import)', async () => {
    // Proves the ProviderManager wiring end-to-end: the manager built by the
    // headless factory hands off generateChatCompletion to whatever provider is
    // active. A deterministic in-test provider (no network, no keys) is
    // registered and activated, then driven through the public ProviderManager
    // API — all without any CLI involvement.
    const cannedReply: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'headless-pong' }],
    };

    class InlineFakeProvider implements IProvider {
      name = 'inline-fake';
      isDefault = false;
      // Satisfies ProviderManager.normalizeRuntimeInputs base-url/auth checks.
      baseProviderConfig = { baseURL: 'http://inline-fake.local' };

      async getModels(): Promise<IModel[]> {
        return [
          {
            id: 'inline-fake-model',
            name: 'inline-fake-model',
            provider: this.name,
            supportedToolFormats: ['auto'],
          },
        ];
      }

      async *generateChatCompletion(
        _options: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        yield cannedReply;
      }

      getDefaultModel(): string {
        return 'inline-fake-model';
      }

      getCurrentModel(): string {
        return 'inline-fake-model';
      }

      async getAuthToken(): Promise<string> {
        return 'inline-fake-token';
      }

      getServerTools(): string[] {
        return [];
      }

      async invokeServerTool(): Promise<unknown> {
        throw new Error('InlineFakeProvider does not support server tools');
      }
    }

    const { manager } = createHeadlessProviderManager({ provider: 'openai' });
    manager.registerProvider(new InlineFakeProvider());
    manager.setActiveProvider('inline-fake');

    const provider = manager.getActiveProvider();
    const chunks: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion({
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'ping' }] },
      ],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    const [block] = chunks[0].blocks;
    expect(block).toStrictEqual({ type: 'text', text: 'headless-pong' });
  });

  it('runs a completion through a CONCRETE OpenAIProvider with zero CLI imports (issue #2033 criterion 4)', async () => {
    // The decisive #2033 unblock proof: a real, concrete provider implementation
    // (OpenAIProvider) executes its actual completion code path and yields model
    // text — entirely from the providers package, no CLI import, no network. The
    // HTTP client is replaced at the protected getClient seam with a canned
    // streaming response (the established OpenAIProvider unit-test pattern).
    const mockChatCreate = vi.fn();
    const mockStream = {
      async *[Symbol.asyncIterator](): AsyncIterableIterator<OpenAI.Chat.Completions.ChatCompletionChunk> {
        yield {
          id: 'chatcmpl-headless',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            { index: 0, delta: { content: 'headless-' }, finish_reason: null },
          ],
        };
        yield {
          id: 'chatcmpl-headless',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: 'completion' },
              finish_reason: 'stop',
            },
          ],
        };
      },
    };
    mockChatCreate.mockResolvedValueOnce(mockStream);

    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'enabled');
    settingsService.setProviderSetting('openai', 'streaming', 'enabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'enabled' }),
    });
    provider.setRuntimeSettingsService(settingsService);

    const getClientSpy = vi
      .spyOn(
        OpenAIProvider.prototype as unknown as {
          getClient: () => Promise<OpenAI>;
        },
        'getClient',
      )
      .mockResolvedValue({
        chat: { completions: { create: mockChatCreate } },
      } as unknown as OpenAI);

    const results: IContent[] = [];
    for await (const content of provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: 'openai',
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'ping' }],
          },
        ],
        settings: settingsService,
        runtimeId: 'headless-openai-completion',
      }),
    )) {
      results.push(content);
    }

    getClientSpy.mockRestore();

    const text = results
      .flatMap((r) => r.blocks)
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(text).toBe('headless-completion');
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });
});
