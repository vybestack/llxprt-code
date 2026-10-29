import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { vi } from 'bun:test';
import { join } from 'node:path';
import { collectHistoryFixture } from './support/collect-history-test-fixture.js';
import { ChatSession } from '../chatSession.js';
import { chatSessionPorts } from '../chatSessionPorts.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

type MediaHistoryRequest = (
  request: GenerateChatOptions,
  bindings: ProviderFileBindingStore | undefined,
  materialized: readonly IContent[],
  workspaceDirectory: string | undefined,
) => Promise<void>;
function createMediaHistoryProvider(
  onRequest: MediaHistoryRequest | undefined,
): IProvider {
  const provider: IProvider & {
    requestProviderFileBindings?: ProviderFileBindingStore;
    requestMediaResolver?: RequestMediaResolver;
    requestMediaBudgetBytes?: number;
    requestWorkspaceDirectory?: string;
  } = {
    requestProviderFileBindings: undefined,
    requestMediaResolver: undefined,
    requestMediaBudgetBytes: undefined,
    name: 'media-history-provider',
    getDefaultModel: () => 'media-history-model',
    getModels: () => Promise.resolve([]),
    async *generateChatCompletion(
      request: GenerateChatOptions | AsyncIterable<IContent>,
    ): AsyncIterableIterator<IContent> {
      if (Symbol.asyncIterator in request)
        throw new Error('Expected request options');
      if (
        this.requestMediaResolver === undefined ||
        this.requestMediaBudgetBytes === undefined
      )
        throw new Error('Expected selected media dependencies');
      const resolved = await this.requestMediaResolver.resolve({
        contents: await collectHistoryFixture(request.contents),
        requestId: 'media-history-request',
        turnId: 'media-history-turn',
        aggregateBudgetBytes: this.requestMediaBudgetBytes,
      });
      try {
        await resolved.withContents((contents) =>
          onRequest?.(
            request,
            this.requestProviderFileBindings,
            contents,
            this.requestWorkspaceDirectory,
          ),
        );
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'unused' }] };
      } finally {
        await resolved.release();
      }
    },
  };
  return provider;
}
export function createMediaHistoryChat(
  directory: string,
  lifecycle: ProviderFileLifecycle,
  retainedInvocationOwners: SessionSettingsOwner[],
  onRequest?: MediaHistoryRequest,
): ChatSession {
  const provider = createMediaHistoryProvider(onRequest);
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
        requestFetch,
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
  return new ChatSession(
    chatSessionPorts(runtime),
    setup.config,
    new RequestMediaResolver(store),
    1024 * 1024,
    createHistoryProviderFileBindingStore(history),
    lifecycle,
    undefined,
    undefined,
    contentGenerator,
  );
}
