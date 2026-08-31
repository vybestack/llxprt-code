/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSession } from './chatSession.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import {
  requireRuntimeEntry,
  resetCliRuntimeRegistryForTesting,
  upsertRuntimeEntry,
} from '@vybestack/llxprt-code-providers/runtime/runtimeRegistry.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';

function mediaHistory(data = PNG_BASE64): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

function mediaHistoryShape(history: readonly IContent[]): readonly string[] {
  return history.flatMap((content) =>
    content.blocks.map((block) =>
      block.type === 'media' ? block.encoding : block.type,
    ),
  );
}

function mediaEncodings(history: readonly IContent[]): readonly string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' ? [block.encoding] : [],
    ),
  );
}

function prefixedMediaHistory(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'stable prefix' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: PNG_BASE64,
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'url',
          data: 'https://example.test/image.png',
        },
      ],
    },
  ];
}

describe('ChatSession media history boundaries', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-chat-media-history-'));
  });

  afterEach(async () => {
    resetCliRuntimeRegistryForTesting();
    await rm(directory, { recursive: true, force: true });
  });

  function createChat(): ChatSession {
    const provider: IProvider = {
      name: 'media-history-provider',
      getDefaultModel: () => 'media-history-model',
      getModels: () => Promise.resolve([]),
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      },
    };
    const setup = createChatSessionRuntime({ provider });
    const history = new HistoryService();
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const state = createAgentRuntimeState({
      runtimeId: 'media-history-runtime',
      provider: provider.name,
      model: 'test-model',
      sessionId: 'media-history-session',
    });
    const runtime = createAgentRuntimeContext({
      state,
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 100_000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
      },
      provider: createProviderAdapterFromManager(
        setup.config.getProviderManager(),
      ),
      telemetry: createTelemetryAdapterFromConfig(setup.config),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: { ...setup.runtime, config: setup.config },
      mediaStore: store,
      mediaAdmission: new MediaAdmissionService(store),
    });
    const contentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(1),
      embedContent: vi.fn(),
    };
    return new ChatSession(runtime, contentGenerator, {}, []);
  }

  it('migrates inline local media before setHistory retains it and leaves URLs unchanged', async () => {
    const chat = createChat();
    const input = mediaHistory();

    await chat.setHistory(input);

    const stored = chat.getHistory();
    const local = stored[0]?.blocks[0];
    if (local.type !== 'media') throw new Error('Expected local media block');
    expect(local.encoding).toBe('reference');
    expect(stored[0]?.blocks[1]).toStrictEqual(input[0]?.blocks[1]);
  });

  it('awaits session-scoped provider-file deletion before history cleanup completes', async () => {
    const chat = createChat();
    let finishDeletion = (): void => {
      throw new Error('Provider-file deletion did not initialize');
    };
    const deletionBlocked = new Promise<void>((resolve) => {
      finishDeletion = resolve;
    });
    const lifecycle = upsertRuntimeEntry(
      'media-history-runtime',
      {},
    ).providerFileLifecycle;
    const retained = await lifecycle.retain({
      cacheKey: 'chat-clear-provider-file',
      fileId: 'provider-file-for-chat-clear',
      bytes: 1,
      identity: {
        provider: 'test-provider',
        baseURL: 'https://provider.test/v1',
        credentialHash: 'chat-clear-credential',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      scopeId: 'media-history-runtime',
      deleteRemote: () => deletionBlocked,
    });
    await retained.lease.release();

    const clearing: unknown = chat.clearHistory();
    if (!(clearing instanceof Promise)) {
      finishDeletion();
      throw new Error('Expected clearHistory to return its cleanup promise');
    }
    const pendingOutcome = await Promise.race([
      clearing.then(() => 'cleared'),
      Promise.resolve('pending'),
    ]);
    expect(pendingOutcome).toBe('pending');

    finishDeletion();
    await clearing;
    expect(
      requireRuntimeEntry(
        'media-history-runtime',
      ).providerFileLifecycle.acquire({
        cacheKey: 'chat-clear-provider-file',
        identity: {
          provider: 'test-provider',
          baseURL: 'https://provider.test/v1',
          credentialHash: 'chat-clear-credential',
        },
        scope: 'session',
        scopeId: 'media-history-runtime',
      }),
    ).toBeUndefined();
  });

  it('keeps local history when provider-file deletion fails', async () => {
    const chat = createChat();
    await chat.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'retained' }] },
    ]);
    const lifecycle = upsertRuntimeEntry(
      'media-history-runtime',
      {},
    ).providerFileLifecycle;
    const retained = await lifecycle.retain({
      cacheKey: 'chat-clear-provider-file-failure',
      fileId: 'provider-file-for-chat-clear-failure',
      bytes: 1,
      identity: {
        provider: 'test-provider',
        baseURL: 'https://provider.test/v1',
        credentialHash: 'chat-clear-failure-credential',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      scopeId: 'media-history-runtime',
      deleteRemote: () => Promise.reject(new Error('provider deletion failed')),
    });
    await retained.lease.release();

    await expect(chat.clearHistory()).rejects.toThrow(
      /provider file cleanup incomplete/i,
    );

    expect(chat.getHistory()[0]?.blocks).toStrictEqual([
      { type: 'text', text: 'retained' },
    ]);
  });

  it('leaves retained history unchanged when setHistory admission fails', async () => {
    const chat = createChat();
    await chat.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'retained' }] },
    ]);

    await expect(
      Promise.resolve(chat.setHistory(mediaHistory('not-base64'))),
    ).rejects.toThrow(/media admission failed/i);

    expect(chat.getHistory()[0]?.blocks).toStrictEqual([
      { type: 'text', text: 'retained' },
    ]);
  });

  async function createPurgeChat(options: {
    readonly mode: 'off' | 'remove';
    readonly providerName: string;
    readonly explicitCacheBreakpoints?: boolean;
    readonly cacheWriteTokens?: number;
    readonly fail?: boolean;
    readonly beforeComplete?: (requestIndex: number) => Promise<void>;
  }): Promise<{
    readonly chat: ChatSession;
    readonly recording: SessionRecordingService;
    readonly requests: readonly IContent[][];
  }> {
    const requests: IContent[][] = [];
    const provider: IProvider = {
      name: options.providerName,
      getDefaultModel: () => 'media-history-model',
      getMediaTransportCapabilities: () => ({
        durableStoredContinuation: false,
        transportScopedContinuation: false,
        statelessFullReplay: true,
        explicitCacheBreakpoints: options.explicitCacheBreakpoints ?? false,
        automaticPrefixCaching: false,
        cacheAffinityKey: false,
        providerFileReferences: false,
        remoteFileRetention: 'none',
        zeroDataRetention: 'not-applicable',
        streamingRequestBody: false,
      }),
      getModels: () => Promise.resolve([]),
      generateChatCompletion(
        request: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        const contents = Array.isArray(request) ? request : request.contents;
        return (async function* (): AsyncIterableIterator<IContent> {
          const requestIndex = requests.length;
          requests.push([...contents]);
          await options.beforeComplete?.(requestIndex);
          if (options.fail === true) throw new Error('provider failed');
          const preparedBoundary = contents.find(
            (content) =>
              content.metadata?.semanticMediaPurgeBoundary !== undefined,
          )?.metadata?.semanticMediaPurgeBoundary;
          const cacheWriteTokens = options.cacheWriteTokens ?? 0;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'completed' }],
            metadata: {
              usage: {
                promptTokens: 10,
                completionTokens: 2,
                totalTokens: 12,
                cache_creation_input_tokens: cacheWriteTokens,
              },
              ...(cacheWriteTokens > 0 && preparedBoundary !== undefined
                ? {
                    semanticMediaPurgeCacheWriteEvidence: {
                      boundaryId: preparedBoundary.boundaryId,
                      preparation: 'added' as const,
                    },
                  }
                : {}),
            },
          };
        })();
      },
    };
    const recording = new SessionRecordingService({
      sessionId: `purge-${options.providerName}`,
      projectHash: 'purge-project',
      chatsDir: join(directory, `chats-${options.providerName}`),
      workspaceDirs: [],
      provider: options.providerName,
      model: 'media-history-model',
    });
    const setup = createChatSessionRuntime({
      provider,
      configOverrides: {
        getSessionRecordingService: () => recording,
      },
    });
    setup.settingsService.set('media.semantic-purge', options.mode);
    setup.settingsService.set('prompt-caching', '5m');
    const history = new HistoryService();
    const store = new LocalMediaStore({
      rootDirectory: join(directory, `media-${options.providerName}`),
      quotaBytes: 1024 * 1024,
    });
    const runtime = createAgentRuntimeContext({
      state: createAgentRuntimeState({
        runtimeId: `purge-${options.providerName}`,
        provider: options.providerName,
        model: 'media-history-model',
        sessionId: `purge-${options.providerName}`,
      }),
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 100_000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
        'media.semantic-purge': options.mode,
      },
      provider: createProviderAdapterFromManager(
        setup.config.getProviderManager(),
      ),
      telemetry: createTelemetryAdapterFromConfig(setup.config),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: { ...setup.runtime, config: setup.config },
      mediaStore: store,
      mediaAdmission: new MediaAdmissionService(store),
    });
    const contentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(1),
      embedContent: vi.fn(),
    };
    return {
      chat: new ChatSession(runtime, contentGenerator, {}, []),
      recording,
      requests,
    };
  }

  it('sends the purge candidate through the real chat send path and commits after provider success', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'test-provider',
    });
    await fixture.chat.setHistory(mediaHistory());

    await fixture.chat.sendMessage({ message: 'next' }, 'purge-success');
    await fixture.recording.flush();

    const firstRequestBlocks = fixture.requests[0]?.[0]?.blocks;
    expect(firstRequestBlocks).toStrictEqual([
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'url',
        data: 'https://example.test/image.png',
      },
    ]);
    expect(fixture.chat.getHistory()[0]?.blocks).toStrictEqual(
      firstRequestBlocks,
    );
    await fixture.recording.dispose();
  });

  it('keeps the default-off request unchanged and creates no purge recording event', async () => {
    const fixture = await createPurgeChat({
      mode: 'off',
      providerName: 'test-provider-off',
    });
    await fixture.chat.setHistory(mediaHistory());
    const before = fixture.chat.getHistory();

    await fixture.chat.sendMessage({ message: 'next' }, 'purge-off');
    await fixture.recording.flush();

    expect(fixture.requests[0]?.slice(0, before.length)).toStrictEqual([
      ...before,
    ]);
    expect(fixture.chat.getHistory()[0]?.blocks).toStrictEqual(
      before[0]?.blocks,
    );
    expect(fixture.recording.getFilePath()).toBeNull();
    await fixture.recording.dispose();
  });

  it('requires cache-write proof from explicit capabilities rather than provider name', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'custom-explicit-cache-provider',
      explicitCacheBreakpoints: true,
      cacheWriteTokens: 0,
    });
    await fixture.chat.setHistory(mediaHistory());

    await fixture.chat.sendMessage(
      { message: 'next' },
      'capability-cache-proof',
    );

    expect(
      fixture.requests[0]?.[0]?.blocks.map((block) =>
        block.type === 'media' ? block.encoding : block.type,
      ),
    ).toStrictEqual(['reference', 'url']);
    expect(
      fixture.chat
        .getHistory()[0]
        ?.blocks.map((block) =>
          block.type === 'media' ? block.encoding : block.type,
        ),
    ).toStrictEqual(['reference', 'url']);
    await fixture.recording.dispose();
  });

  it('does not infer explicit cache behavior from an Anthropic-shaped name', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'anthropic',
      explicitCacheBreakpoints: false,
      cacheWriteTokens: 0,
    });
    await fixture.chat.setHistory(mediaHistory());

    await fixture.chat.sendMessage(
      { message: 'next' },
      'capability-no-cache-proof',
    );

    expect(
      fixture.requests[0]?.[0]?.blocks.map((block) =>
        block.type === 'media' ? block.encoding : block.type,
      ),
    ).toStrictEqual(['url']);
    expect(
      fixture.chat
        .getHistory()[0]
        ?.blocks.map((block) =>
          block.type === 'media' ? block.encoding : block.type,
        ),
    ).toStrictEqual(['url']);
    await fixture.recording.dispose();
  });

  it('keeps the purge image in the explicit-cache streaming request', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'anthropic',
      explicitCacheBreakpoints: true,
      cacheWriteTokens: 0,
    });
    await fixture.chat.setHistory(mediaHistory());

    const stream = await fixture.chat.sendMessageStream(
      { message: 'next' },
      'purge-stream-request-history',
    );
    for await (const _event of stream) {
      // Consume the real stream so finalization and purge evidence run.
    }

    expect(
      fixture.requests[0]?.[0]?.blocks.map((block) =>
        block.type === 'media' ? block.encoding : block.type,
      ),
    ).toStrictEqual(['reference', 'url']);
    await fixture.recording.dispose();
  });

  it('rolls back Anthropic purge without observed cache-write usage', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'anthropic',
      explicitCacheBreakpoints: true,
      cacheWriteTokens: 0,
    });
    await fixture.chat.setHistory(mediaHistory());

    await fixture.chat.sendMessage({ message: 'next' }, 'purge-no-cache-write');

    expect(
      fixture.chat
        .getHistory()[0]
        ?.blocks.map((block) =>
          block.type === 'media' ? block.encoding : block.type,
        ),
    ).toStrictEqual(['reference', 'url']);
    await fixture.recording.dispose();
  });

  it('commits Anthropic purge from exact boundary evidence and observed cache-write usage', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'anthropic',
      explicitCacheBreakpoints: true,
      cacheWriteTokens: 9,
    });
    await fixture.chat.setHistory(prefixedMediaHistory());

    await fixture.chat.sendMessage({ message: 'next' }, 'purge-cache-write');

    expect(fixture.chat.getHistory()[0]?.blocks).toStrictEqual([
      { type: 'text', text: 'stable prefix' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'url',
        data: 'https://example.test/image.png',
      },
    ]);
    expect(fixture.recording.getFilePath()).not.toBeNull();
    await fixture.recording.dispose();
  });

  it('does not purge when provider completion fails', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'test-provider-error',
      fail: true,
    });
    await fixture.chat.setHistory(mediaHistory());

    await expect(
      fixture.chat.sendMessage({ message: 'next' }, 'purge-error'),
    ).rejects.toThrow('provider failed');

    expect(
      fixture.chat
        .getHistory()[0]
        ?.blocks.map((block) =>
          block.type === 'media' ? block.encoding : block.type,
        ),
    ).toStrictEqual(['reference', 'url']);
    await fixture.recording.dispose();
  });

  it('rolls back a committed non-streaming purge when successful-turn history commit fails', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'purge-before-turn-failure',
    });
    await fixture.chat.setHistory(mediaHistory());
    fixture.chat.getHistoryService().on('contentBatchAdded', () => {
      throw new Error('turn history commit failed');
    });

    await expect(
      fixture.chat.sendMessage({ message: 'next' }, 'turn-commit-failure'),
    ).rejects.toThrow('turn history commit failed');

    expect(mediaHistoryShape(fixture.chat.getHistory())).toStrictEqual([
      'reference',
      'url',
    ]);
    await fixture.recording.dispose();
  });

  it('rolls back a committed streaming purge when successful-turn history commit fails', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'stream-purge-before-turn-failure',
    });
    await fixture.chat.setHistory(mediaHistory());
    fixture.chat.getHistoryService().on('contentBatchAdded', () => {
      throw new Error('stream turn history commit failed');
    });

    const stream = await fixture.chat.sendMessageStream(
      { message: 'next' },
      'stream-turn-commit-failure',
    );
    const consumeStream = async (): Promise<void> => {
      for await (const _event of stream) {
        // Consume the real stream so finalization attempts both commits.
      }
    };
    await expect(consumeStream()).rejects.toThrow(
      'stream turn history commit failed',
    );

    expect(mediaHistoryShape(fixture.chat.getHistory())).toStrictEqual([
      'reference',
      'url',
    ]);
    await fixture.recording.dispose();
  });

  it('does not commit a non-streaming turn when semantic-purge persistence fails first', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'purge-persistence-failure',
    });
    await fixture.chat.setHistory(mediaHistory());
    fixture.recording.recordSemanticMediaPurge = () => {
      throw new Error('purge persistence failed');
    };

    await expect(
      fixture.chat.sendMessage({ message: 'next' }, 'purge-commit-failure'),
    ).rejects.toThrow('purge persistence failed');

    expect(mediaHistoryShape(fixture.chat.getHistory())).toStrictEqual([
      'reference',
      'url',
    ]);
    await fixture.recording.dispose();
  });

  it('begins each concurrent semantic purge after the previous send commits', async () => {
    let releaseFirst: () => void = () => undefined;
    let reportFirstStarted: () => void = () => undefined;
    const firstStarted = new Promise<void>((resolve) => {
      reportFirstStarted = resolve;
    });
    const firstCanComplete = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'concurrent-purge-provider',
      beforeComplete: async (requestIndex) => {
        if (requestIndex !== 0) return;
        reportFirstStarted();
        await firstCanComplete;
      },
    });
    await fixture.chat.setHistory(mediaHistory());

    const first = fixture.chat.sendMessage({ message: 'first' }, 'purge-first');
    await firstStarted;
    const second = fixture.chat.sendMessage(
      { message: 'second' },
      'purge-second',
    );
    releaseFirst();
    await Promise.all([first, second]);

    expect(mediaEncodings(fixture.requests[0] ?? [])).toStrictEqual(['url']);
    expect(mediaEncodings(fixture.requests[1] ?? [])).toStrictEqual([]);
    expect(mediaEncodings(fixture.chat.getHistory())).toStrictEqual([]);
    await fixture.recording.dispose();
  });
});
