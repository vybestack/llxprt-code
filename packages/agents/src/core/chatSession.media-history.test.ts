import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { afterEach as closeInvocationRoots } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
const retainedInvocationOwners: SessionSettingsOwner[] = [];

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSession } from './chatSession.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  mediaHistory,
  mediaHistoryShape,
  prefixedMediaHistory,
} from './chatSession.media-history-fixtures.js';

function mediaEncodings(history: readonly IContent[]): readonly string[] {
  return history.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' ? [block.encoding] : [],
    ),
  );
}

describe('ChatSession media history boundaries', () => {
  closeInvocationRoots(async () => {
    for (const owner of retainedInvocationOwners.splice(0))
      await owner.dispose();
  });

  let directory = '';
  let lifecycle: ProviderFileLifecycle;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-chat-media-history-'));
    lifecycle = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function createChat(
    onRequest?: (
      request: GenerateChatOptions,
      bindings: ProviderFileBindingStore | undefined,
    ) => Promise<void>,
  ): ChatSession {
    const provider: IProvider & {
      requestProviderFileBindings?: ProviderFileBindingStore;
    } = {
      requestProviderFileBindings: undefined,
      name: 'media-history-provider',
      getDefaultModel: () => 'media-history-model',
      getModels: () => Promise.resolve([]),
      async *generateChatCompletion(
        request: GenerateChatOptions | IContent[],
      ): AsyncIterableIterator<IContent> {
        if (!Array.isArray(request))
          await onRequest?.(request, this.requestProviderFileBindings);
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
    const invocationOwner = new SessionSettingsOwner(setup.settingsService);
    retainedInvocationOwners.push(invocationOwner);
    const runtime = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        invocationOwner.prepareProviderInvocation(
          state.runtimeId,
          name,
          parameters,
          signal,
        ),
      state,
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 100_000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
      },
      provider: createProviderAdapterFromManager(setup.providerManager),
      telemetry: createTelemetryAdapter(
        setup.config,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-adapter-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
      tools: createToolRegistryViewFromRegistry(),
      providerRuntime: {
        ...setup.runtime,
        config: setup.config,
        providerFileLifecycle: lifecycle,
      },
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

  it('rebinds prepared chat history without recreating media admission and retires the old graph separately', async () => {
    const oldChat = createChat();
    await oldChat.setHistory(mediaHistory());
    const live = oldChat.getHistoryService();
    const candidate = createChat(async (request, bindings) => {
      const media = request.contents
        .flatMap((content) => content.blocks)
        .find(
          (block) => block.type === 'media' && block.encoding === 'reference',
        );
      if (media !== undefined) {
        if (!bindings) throw new Error('Missing history binding');
        await bindings.bind(media.contentId, {
          provider: 'media-history-provider',
          baseURL: 'https://media.test',
          credentialHash: 'test',
          fileId: 'adopted-file',
          byteLength: media.byteLength,
          scope: 'session',
          scopeId: 'media-history-runtime',
          createdAt: 1,
          expiresAt: 1000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
          deletionState: 'active',
        });
      }
    });
    await candidate.setHistory(structuredClone(oldChat.getHistory()));
    const detached = candidate.getHistoryService();
    const oldBinding = oldChat.prepareHistoryRebind(detached);
    const newBinding = candidate.prepareHistoryRebind(live, oldChat);
    const adopt = await live.prepareProfileAdoption(detached);
    const before = live.getAll();
    const staged = detached.getAll();
    expect(oldChat.getHistory()).toStrictEqual(before);
    oldBinding();
    adopt();
    newBinding();
    await oldChat.clearHistory();
    expect(candidate.getHistory()).toStrictEqual(staged);
    await candidate.verifyHistoryMedia(candidate.getHistory());
    await candidate.sendMessage(
      { message: 'continued after adoption' },
      'adopted-send',
    );
    expect(JSON.stringify(live.getAll())).toContain('continued after adoption');
    expect(JSON.stringify(live.getAll())).toContain('adopted-file');
    for await (const _event of await candidate.sendMessageStream(
      { message: 'stream after adoption' },
      'adopted-stream',
    )) {
      expect(_event).toBeDefined();
    }
    expect(JSON.stringify(live.getAll())).toContain('stream after adoption');
    const beforeDirect = live.getAll();
    const direct = await candidate.generateDirectMessage(
      { message: 'direct after adoption' },
      'adopted-direct',
    );
    expect(direct.content.blocks.length).toBeGreaterThan(0);
    expect(live.getAll()).toStrictEqual(beforeDirect);
    expect(detached.getAll()).toStrictEqual([]);
    await live.waitForTokenUpdates();
    expect(live.getTotalTokens()).toBeGreaterThan(0);
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const retained = live.getAll()[0].blocks[0];
    if (retained.type !== 'media' || retained.encoding !== 'reference')
      throw new Error('Expected retained reference');
    expect(await store.hasReservations(retained.contentId)).toBe(true);
    await candidate.clearHistory();
    await live.waitForOwnershipSettlement();
    expect(live.getAll()).toStrictEqual([]);
    expect(await store.hasReservations(retained.contentId)).toBe(false);
  });

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
      lifecycle.acquire({
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
    readonly execution: AgentChatRecordingExecution;
    readonly requests: readonly IContent[][];
  }> {
    const requests: IContent[][] = [];
    const provider: IProvider & {
      requestProviderFileBindings?: ProviderFileBindingStore;
    } = {
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
    const setup = createChatSessionRuntime({ provider });
    setup.settingsService.set('media.semantic-purge', options.mode);
    setup.settingsService.set('prompt-caching', '5m');
    const history = new HistoryService();
    const store = new LocalMediaStore({
      rootDirectory: join(directory, `media-${options.providerName}`),
      quotaBytes: 1024 * 1024,
    });
    const state = createAgentRuntimeState({
      runtimeId: `purge-${options.providerName}`,
      provider: options.providerName,
      model: 'media-history-model',
      sessionId: `purge-${options.providerName}`,
    });
    const invocationOwner = new SessionSettingsOwner(setup.settingsService);
    retainedInvocationOwners.push(invocationOwner);
    const runtime = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        invocationOwner.prepareProviderInvocation(
          state.runtimeId,
          name,
          parameters,
          signal,
        ),
      state,
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 100_000,
        preserveThreshold: 0.2,
        telemetry: { enabled: false, target: null },
        'media.semantic-purge': options.mode,
        promptCaching: invocationOwner.readRuntimePolicy().promptCaching,
      },
      provider: createProviderAdapterFromManager(setup.providerManager),
      telemetry: createTelemetryAdapter(
        setup.config,
        RootTelemetry.prepare({
          enabled: false,
          sessionId: 'isolated-adapter-fixture',
          maxBytes: 1024,
          maxFiles: 1,
        }),
      ),
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
      execution: {
        transcriptPath: () => recording.getFilePath() ?? undefined,
        persistSemanticMediaPurge: async (candidate, frontier) => {
          if (!recording.isActive()) {
            throw new Error(
              'Semantic media purge requires an active session recording',
            );
          }
          recording.recordSemanticMediaPurge(candidate, frontier);
          await recording.flush();
          if (!recording.isActive()) {
            throw new Error(
              'Semantic media purge recording did not remain active',
            );
          }
        },
      },
      requests,
    };
  }

  function sendOwned(
    fixture: Awaited<ReturnType<typeof createPurgeChat>>,
    message: string,
    prompt: string,
  ): ReturnType<ChatSession['sendMessage']> {
    return fixture.chat.sendMessage({ message }, prompt, fixture.execution);
  }

  function streamOwned(
    fixture: Awaited<ReturnType<typeof createPurgeChat>>,
    message: string,
    prompt: string,
  ): ReturnType<ChatSession['sendMessageStream']> {
    return fixture.chat.sendMessageStream(
      { message },
      prompt,
      fixture.execution,
    );
  }

  it('commits semantic media purge to the adopted live history after rebinding', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'adopted-purge',
    });
    await fixture.chat.setHistory(mediaHistory());
    const detached = fixture.chat.getHistoryService();
    const live = new HistoryService();
    const rebind = fixture.chat.prepareHistoryRebind(live);
    const adopt = await live.prepareProfileAdoption(detached);
    adopt();
    rebind();
    await sendOwned(fixture, 'purge adopted media', 'adopted-purge');
    await fixture.recording.flush();
    expect(mediaEncodings(live.getAll())).toStrictEqual(['url']);
    expect(detached.getAll()).toStrictEqual([]);
    expect(JSON.stringify(live.getAll())).toContain('purge adopted media');
    await fixture.chat.clearHistory();
    await fixture.recording.dispose();
  });

  it('rejects an ownerless semantic purge without changing durable history', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'unbound-purge',
    });
    await fixture.chat.setHistory(mediaHistory());

    await expect(
      fixture.chat.sendMessage({ message: 'next' }, 'unbound-purge'),
    ).rejects.toThrow(
      'Semantic media purge requires an active session recording',
    );

    expect(mediaHistoryShape(fixture.chat.getHistory())).toStrictEqual([
      'reference',
      'url',
    ]);
    expect(fixture.requests).toHaveLength(1);
    await fixture.recording.dispose();
  });

  it('sends the purge candidate through the real chat send path and commits after provider success', async () => {
    const fixture = await createPurgeChat({
      mode: 'remove',
      providerName: 'test-provider',
    });
    await fixture.chat.setHistory(mediaHistory());

    await sendOwned(fixture, 'next', 'purge-success');
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

    await sendOwned(fixture, 'next', 'capability-cache-proof');

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

    await sendOwned(fixture, 'next', 'capability-no-cache-proof');

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

    const stream = await streamOwned(
      fixture,
      'next',
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

    await sendOwned(fixture, 'next', 'purge-no-cache-write');

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

    await sendOwned(fixture, 'next', 'purge-cache-write');

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

    await expect(sendOwned(fixture, 'next', 'purge-error')).rejects.toThrow(
      'provider failed',
    );

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
      sendOwned(fixture, 'next', 'turn-commit-failure'),
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

    const stream = await streamOwned(
      fixture,
      'next',
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
      sendOwned(fixture, 'next', 'purge-commit-failure'),
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

    const first = sendOwned(fixture, 'first', 'purge-first');
    await firstStarted;
    const second = sendOwned(fixture, 'second', 'purge-second');
    releaseFirst();
    await Promise.all([first, second]);

    // Both sends must have reached the transport before their contents mean
    // anything. The `?? []` these replace made the second assertion pass when
    // there was no second request at all: mediaEncodings([]) is [], which is
    // what it asserted (#3129).
    const [firstRequest, secondRequest] = fixture.requests;
    assertDefined(firstRequest, 'first message never reached the transport');
    assertDefined(secondRequest, 'second message never reached the transport');
    expect(mediaEncodings(firstRequest)).toStrictEqual(['url']);
    expect(mediaEncodings(secondRequest)).toStrictEqual([]);
    expect(mediaEncodings(fixture.chat.getHistory())).toStrictEqual([]);
    await fixture.recording.dispose();
  });
});
