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
import { ChatSession } from '../chatSession.js';

type MediaHistoryRequest = (
  request: GenerateChatOptions,
  bindings: ProviderFileBindingStore | undefined,
  materialized: readonly IContent[],
) => Promise<void>;
function createMediaHistoryProvider(
  onRequest: MediaHistoryRequest | undefined,
): IProvider {
  const provider: IProvider & {
    requestProviderFileBindings?: ProviderFileBindingStore;
    requestMediaResolver?: RequestMediaResolver;
    requestMediaBudgetBytes?: number;
  } = {
    requestProviderFileBindings: undefined,
    requestMediaResolver: undefined,
    requestMediaBudgetBytes: undefined,
    name: 'media-history-provider',
    getDefaultModel: () => 'media-history-model',
    getModels: () => Promise.resolve([]),
    async *generateChatCompletion(
      request: GenerateChatOptions | IContent[],
    ): AsyncIterableIterator<IContent> {
      if (Array.isArray(request)) throw new Error('Expected request options');
      if (
        this.requestMediaResolver === undefined ||
        this.requestMediaBudgetBytes === undefined
      )
        throw new Error('Expected selected media dependencies');
      const resolved = await this.requestMediaResolver.resolve({
        contents: request.contents,
        requestId: 'media-history-request',
        turnId: 'media-history-turn',
        aggregateBudgetBytes: this.requestMediaBudgetBytes,
      });
      try {
        await resolved.withContents((contents) =>
          onRequest?.(request, this.requestProviderFileBindings, contents),
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
    runtime,
    new RequestMediaResolver(store),
    1024 * 1024,
    createHistoryProviderFileBindingStore(history),
    lifecycle,
    contentGenerator,
  );
}
