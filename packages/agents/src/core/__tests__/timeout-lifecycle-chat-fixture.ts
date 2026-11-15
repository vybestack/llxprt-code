/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { vi } from 'bun:test';
import { join } from 'node:path';
import { ProviderState } from '../../api/__tests__/helpers/stalling-provider.js';
import { ChatSession } from '../chatSession.js';
import { chatSessionPorts } from '../chatSessionPorts.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

export interface TimeoutLifecycleChat {
  readonly chat: ChatSession;
  readonly history: HistoryService;
  /** The provider the chat sends to; its streams never look at a signal. */
  readonly provider: ProviderState;
  /** Frontiers the session asked the journal to persist for a media purge. */
  readonly persistedPurges: readonly SemanticMediaPurgeFrontier[];
  /** The recording execution a turn passes, with a collecting purge journal. */
  readonly execution: AgentChatRecordingExecution;
  /** Disposed with the chat. */
  readonly invocationOwner: SessionSettingsOwner;
}

export interface TimeoutLifecycleOptions {
  readonly semanticMediaPurge?: 'off' | 'remove' | 'summary';
  readonly streamTimeoutPolicy: Readonly<Record<string, number>>;
}

function scriptedProvider(script: ProviderState): IProvider {
  return {
    name: 'timeout-lifecycle-provider',
    getDefaultModel: () => 'timeout-lifecycle-model',
    getModels: () => Promise.resolve([]),
    generateChatCompletion(
      request: GenerateChatOptions | IContent[],
    ): AsyncIterableIterator<IContent> {
      if (Array.isArray(request)) throw new Error('Expected request options');
      return script.begin(request).stream();
    },
  };
}

function createRuntime(
  provider: IProvider,
  history: HistoryService,
  store: LocalMediaStore,
  options: TimeoutLifecycleOptions,
): {
  readonly runtime: ReturnType<typeof createAgentRuntimeContext>;
  readonly config: ReturnType<typeof createChatSessionRuntime>['config'];
  readonly invocationOwner: SessionSettingsOwner;
} {
  const setup = createChatSessionRuntime({ provider });
  const state = createAgentRuntimeState({
    runtimeId: 'timeout-lifecycle-runtime',
    provider: provider.name,
    model: 'test-model',
    sessionId: 'timeout-lifecycle-session',
  });
  const invocationOwner = new SessionSettingsOwner(setup.settingsService);
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
      streamTimeoutPolicy: options.streamTimeoutPolicy,
      'media.semantic-purge': options.semanticMediaPurge ?? 'off',
    },
    provider: createProviderAdapterFromManager(setup.providerManager),
    telemetry: createTelemetryAdapter(
      setup.config,
      RootTelemetry.prepare({
        enabled: false,
        sessionId: 'timeout-lifecycle-adapter',
        maxBytes: 1024,
        maxFiles: 1,
      }),
    ),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: { ...setup.runtime },
    mediaStore: store,
    mediaAdmission: new MediaAdmissionService(store),
  });
  return { runtime, config: setup.config, invocationOwner };
}

/**
 * A real ChatSession over a real HistoryService, with a provider that is a
 * bare IProvider: unlike a registered provider it has no retry orchestrator
 * above it, so nothing races its stream against cancellation. The stream
 * advances only when a scenario emits to or finishes the attempt.
 */
export function createTimeoutLifecycleChat(
  directory: string,
  lifecycle: ProviderFileLifecycle,
  options: TimeoutLifecycleOptions,
): TimeoutLifecycleChat {
  const script = new ProviderState();
  const history = new HistoryService();
  const store = new LocalMediaStore({
    rootDirectory: join(directory, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const { runtime, config, invocationOwner } = createRuntime(
    scriptedProvider(script),
    history,
    store,
    options,
  );
  const persistedPurges: SemanticMediaPurgeFrontier[] = [];
  const execution: AgentChatRecordingExecution = {
    transcriptPath: () => undefined,
    persistSemanticMediaPurge: (_history, frontier) => {
      persistedPurges.push(frontier);
      return Promise.resolve();
    },
  };
  const chat = new ChatSession(
    chatSessionPorts(runtime),
    config,
    new RequestMediaResolver(store),
    1024 * 1024,
    createHistoryProviderFileBindingStore(history),
    lifecycle,
    undefined,
    undefined,
    {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(1),
      embedContent: vi.fn(),
    },
  );
  return {
    chat,
    history,
    provider: script,
    persistedPurges,
    execution,
    invocationOwner,
  };
}
