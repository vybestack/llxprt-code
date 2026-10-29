/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  operationFileCreates,
  type OperationFileCreates,
} from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { loggingChatSession } from '../../../../agents/src/core/__tests__/support/chat-session-logging-fixture.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../providerTestConfig.js';
import {
  anthropicJournalSink,
  type AnthropicCapturedRequest,
} from './anthropic-journal-case.js';
import { rowsSelection, buildHistoryCallOptions } from './wireBodyCapture.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { journalSendFixture } from './journal-send-fixture.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

class ObservedAnthropicProvider extends AnthropicProvider {
  readonly changedSources: number[] = [];
  readonly references: GenerateChatOptions[] = [];

  override async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): ReturnType<AnthropicProvider['projectPromptEnvelope']> {
    const selection = options.requestRows;
    if (selection === undefined) throw new Error('Missing public request rows');
    const changed = selection.native?.indexed.viewPlan.changedSources.length;
    if (changed === undefined) throw new Error('Missing public journal view');
    this.changedSources.push(changed);
    const rows: IContent[] = [];
    for await (const row of selection.openReader()) rows.push(row);
    this.references.push({
      ...options,
      contents: rowsSelection(rows).openReader(),
      requestRows: rowsSelection(rows),
      contentCount: rows.length,
    });
    return super.projectPromptEnvelope(options);
  }
}

export function publicChat(
  provider: AnthropicProvider,
  settings: SettingsService,
  history: HistoryService,
  model: string,
  baseURL: string,
  mediaResolver?: RequestMediaResolver,
  mediaStore?: LocalMediaStore,
  requestMediaBudgetBytes?: number,
): {
  readonly chat: ReturnType<typeof loggingChatSession>;
  readonly owner: SessionSettingsOwner;
} {
  const fixture = createChatSessionRuntime({
    provider,
    settingsService: settings,
    configOverrides: {
      getTelemetryLogPromptsEnabled: () => false,
      getUsageStatisticsEnabled: () => false,
    },
  });
  const owner = new SessionSettingsOwner(settings);
  const runtime = createAgentRuntimeContext({
    mediaResolver,
    mediaStore,
    promptEstimator: createRuntimeTokenizerFactory(),
    readRuntimeSettings: () => owner.readRuntimePolicy(),
    prepareProviderInvocation: (name, parameters, signal) =>
      owner.prepareProviderInvocation(
        'anthropic-tail',
        name,
        parameters,
        signal,
        undefined,
        (input, init) => globalThis.fetch(input, init),
      ),
    state: {
      runtimeId: 'anthropic-tail',
      sessionId: 'anthropic-tail',
      provider: 'anthropic',
      model,
      updatedAt: Date.now(),
      baseUrl: baseURL,
    },
    history,
    settings: { contextLimit: 1_000_000 },
    providerRuntime: fixture.runtime,
    provider: {
      getActiveProvider: () => provider,
      getProviderKeys: () => fixture.providerManager.getProviderKeys(),
      setActiveProvider() {},
    },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    telemetry: {
      logApiRequest() {},
      logApiResponse() {},
      logApiError() {},
    },
  });
  const chat = loggingChatSession(
    runtime,
    provider,
    { systemInstruction: 'system 雪' },
    requestMediaBudgetBytes,
  );
  return { chat, owner };
}

async function textOutput(contents: AsyncIterable<IContent>): Promise<string> {
  let text = '';
  for await (const row of contents)
    for (const block of row.blocks)
      if (block.type === 'text') text += block.text;
  return text;
}

interface TailCaseResult {
  readonly output: string;
  readonly created: OperationFileCreates;
  readonly changedSources: readonly number[];
  readonly requests: readonly AnthropicCapturedRequest[];
}

export async function publicAnthropicTailCase(
  prior: readonly IContent[],
  message: IContent,
  cache: 'off' | '5m' | '1h' = 'off',
  strip: 'none' | 'all' | 'allButLast' = 'none',
): Promise<TailCaseResult> {
  const sink = await anthropicJournalSink();
  const fixture = await journalSendFixture(prior, [message]);
  const settings = new SettingsService();
  const route = {
    ...sink.route,
    providerSettings: {
      ...sink.route.providerSettings,
      'prompt-caching': cache,
    },
  };
  const provider = new ObservedAnthropicProvider(
    'test-api-key',
    route.baseURL,
    TEST_PROVIDER_CONFIG,
  );
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'pending-anthropic-tail',
      description: 'Caller tail remains pending through estimation and send',
      rows: [],
      systemInstruction: 'system 雪',
      globalSettings: {
        'reasoning.stripFromContext': strip,
        'reasoning.includeInContext': true,
      },
    },
    'rows',
    settings,
    fixture.selection,
  );
  let projection:
    | Awaited<ReturnType<AnthropicProvider['projectPromptEnvelope']>>
    | undefined;
  try {
    let output = '';
    getScratchRoot();
    const created = await operationFileCreates(async () => {
      projection = await provider.projectPromptEnvelope(options);
      await estimatePromptEnvelope(
        provider.name,
        projection,
        createRuntimeTokenizerFactory(),
      );
      output = await textOutput(
        provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        }),
      );
    });
    const reference = provider.references[0];
    const builder = new AnthropicProvider(
      'test-api-key',
      route.baseURL,
      TEST_PROVIDER_CONFIG,
    );
    for await (const chunk of builder.generateChatCompletion(reference))
      void chunk;
    return {
      output,
      created,
      changedSources: provider.changedSources,
      requests: sink.requests,
    };
  } finally {
    await projection?.releaseIfUnsent?.();
    await sink.close();
    await fixture.close();
  }
}
