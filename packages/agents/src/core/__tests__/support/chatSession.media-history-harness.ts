/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { vi } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSession } from '../../chatSession.js';
import { chatSessionPorts } from '../../chatSessionPorts.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import {
  createAgentRuntimeContext,
  registerRuntimeMediaOwner,
} from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
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
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { encodeContentRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { collectHistoryFixture } from './collect-history-test-fixture.js';

type ReferenceMediaBlock = Extract<
  IContent['blocks'][number],
  { type: 'media'; encoding: 'reference' }
>;

let directory = '';
let lifecycle: ProviderFileLifecycle | undefined;
const retainedInvocationOwners: SessionSettingsOwner[] = [];

export async function openMediaHistoryHarness(): Promise<void> {
  directory = await mkdtemp(join(tmpdir(), 'llxprt-chat-media-history-'));
  lifecycle = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  });
}

export async function closeMediaHistoryHarness(): Promise<void> {
  for (const owner of retainedInvocationOwners.splice(0)) await owner.dispose();
  await rm(directory, { recursive: true, force: true });
}

export function harnessDirectory(): string {
  return directory;
}

export function harnessLifecycle(): ProviderFileLifecycle {
  if (lifecycle === undefined)
    throw new Error('Media history harness is not open');
  return lifecycle;
}

export type PurgeChatOptions = {
  readonly mode: 'off' | 'remove';
  readonly providerName: string;
  readonly explicitCacheBreakpoints?: boolean;
  readonly cacheWriteTokens?: number;
  readonly fail?: boolean;
  readonly beforeComplete?: (requestIndex: number) => Promise<void>;
};

function createPurgeProvider(
  options: PurgeChatOptions,
  requests: IContent[][],
): IProvider {
  return {
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
      request: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      const stream =
        Symbol.asyncIterator in request ? request : request.contents;
      return (async function* (): AsyncIterableIterator<IContent> {
        const rows: IContent[] = [];
        for await (const content of stream) {
          rows.push(content);
        }
        const requestIndex = requests.length;
        requests.push([...rows]);
        await options.beforeComplete?.(requestIndex);
        if (options.fail === true) throw new Error('provider failed');
        const preparedBoundary = rows.find(
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
}

export async function createPurgeChat(options: PurgeChatOptions): Promise<{
  readonly chat: ChatSession;
  readonly recording: JournalRecordingService;
  readonly execution: AgentChatRecordingExecution;
  readonly requests: readonly IContent[][];
}> {
  const requests: IContent[][] = [];
  const provider = createPurgeProvider(options, requests);
  const recording = JournalRecordingService.create({
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
        undefined,
        () => Promise.reject(new Error('Unexpected fixture network request')),
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
    telemetry: createTelemetryAdapter(setup.config, isolatedTelemetry()),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: { ...setup.runtime },
    mediaStore: store,
    mediaAdmission: new MediaAdmissionService(store),
  });
  await registerRuntimeMediaOwner(runtime);
  const contentGenerator = createContentGeneratorFixture();
  return {
    chat: new ChatSession(
      chatSessionPorts(runtime),
      setup.config,
      new RequestMediaResolver(store),
      1024 * 1024,
      createHistoryProviderFileBindingStore(history),
      harnessLifecycle(),
      undefined,
      undefined,
      contentGenerator,
      {},
      [],
    ),
    recording,
    execution: createPurgeExecution(recording),
    requests,
  };
}

function createPurgeExecution(
  recording: JournalRecordingService,
): AgentChatRecordingExecution {
  return {
    transcriptPath: () => recording.getFilePath() ?? undefined,
    persistSemanticMediaPurge: async (candidate) => {
      if (!recording.isActive()) {
        throw new Error(
          'Semantic media purge requires an active session recording',
        );
      }
      const session = await recording.session();
      await session.store.commit([
        {
          kind: 'replace',
          rows: (async function* () {
            for await (const row of candidate.streamRows())
              yield encodeContentRow(row, { owner: 0 });
          })(),
        },
      ]);
      await recording.flush();
      if (!recording.isActive()) {
        throw new Error('Semantic media purge recording did not remain active');
      }
    },
  };
}

function isolatedTelemetry(): RootTelemetry {
  return RootTelemetry.prepare({
    enabled: false,
    sessionId: 'isolated-adapter-fixture',
    maxBytes: 1024,
    maxFiles: 1,
  });
}

export function sendOwned(
  fixture: Awaited<ReturnType<typeof createPurgeChat>>,
  message: string,
  prompt: string,
): ReturnType<ChatSession['sendMessage']> {
  return fixture.chat.sendMessage({ message }, prompt, fixture.execution);
}

export function streamOwned(
  fixture: Awaited<ReturnType<typeof createPurgeChat>>,
  message: string,
  prompt: string,
): ReturnType<ChatSession['sendMessageStream']> {
  return fixture.chat.sendMessageStream({ message }, prompt, fixture.execution);
}

export async function rawRows(history: HistoryService): Promise<IContent[]> {
  return collectHistoryFixture(history.streamRawHistory());
}

export async function findReferenceMedia(
  contents: AsyncIterable<IContent>,
): Promise<ReferenceMediaBlock | undefined> {
  for await (const content of contents) {
    for (const block of content.blocks) {
      if (block.type === 'media' && block.encoding === 'reference')
        return block;
    }
  }
  return undefined;
}

export async function createChat(
  onRequest?: (
    request: GenerateChatOptions,
    bindings: ProviderFileBindingStore | undefined,
  ) => Promise<void>,
): Promise<ChatSession> {
  const provider: IProvider & {
    requestProviderFileBindings?: ProviderFileBindingStore;
  } = {
    requestProviderFileBindings: undefined,
    name: 'media-history-provider',
    getDefaultModel: () => 'media-history-model',
    getModels: () => Promise.resolve([]),
    async *generateChatCompletion(
      request: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (!(Symbol.asyncIterator in request))
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
        undefined,
        () => Promise.reject(new Error('Unexpected fixture network request')),
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
    telemetry: createTelemetryAdapter(setup.config, isolatedTelemetry()),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: {
      ...setup.runtime,
    },
    mediaStore: store,
    mediaAdmission: new MediaAdmissionService(store),
  });
  await registerRuntimeMediaOwner(runtime);
  const contentGenerator = createContentGeneratorFixture();
  return new ChatSession(
    chatSessionPorts(runtime),
    setup.config,
    new RequestMediaResolver(store),
    1024 * 1024,
    createHistoryProviderFileBindingStore(history),
    harnessLifecycle(),
    undefined,
    undefined,
    contentGenerator,
    {},
    [],
  );
}

function createContentGeneratorFixture() {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(1),
    embedContent: vi.fn(),
  };
}
