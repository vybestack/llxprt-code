/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import type { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { mkdirSync, mkdtempSync } from 'node:fs';
import {
  operationFileCreates,
  type OperationFileCreates,
} from '../../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  loggingChatSession,
  readLoggingChatStream,
} from '../../../../agents/src/core/__tests__/support/chat-session-logging-fixture.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../providerTestConfig.js';
import {
  anthropicJournalSink,
  type AnthropicCapturedRequest,
} from './anthropic-journal-case.js';
import { rowsSelection } from './wireBodyCapture.js';

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
    providerRuntime: { ...fixture.runtime, mediaResolver },
    provider: { getActiveProvider: () => provider, setActiveProvider() {} },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    telemetry: {
      logApiRequest() {},
      logApiResponse() {},
      logApiError() {},
    },
  });
  const chat = loggingChatSession(runtime, provider, {
    systemInstruction: 'system 雪',
  });
  return { chat, owner };
}

export async function publicAnthropicTailCase(
  prior: readonly IContent[],
  message: IContent,
  cache: 'off' | '5m' | '1h' = 'off',
  strip: 'none' | 'all' | 'allButLast' = 'none',
): Promise<{
  readonly output: string;
  readonly created: OperationFileCreates;
  readonly changedSources: readonly number[];
  readonly requests: readonly AnthropicCapturedRequest[];
}> {
  const sink = await anthropicJournalSink();
  const parent = `${import.meta.dir}/../../../../../tmp/anthropic-tail/public-fixtures`;
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(`${parent}/session-`);
  const model = sink.route.model;
  const recording = JournalRecordingService.create({
    sessionId: 'anthropic-tail',
    projectHash: 'anthropic-tail',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'anthropic',
    model,
  });
  const history = new HistoryService({ recording });
  const settings = new SettingsService();
  settings.setProviderSetting('anthropic', 'model', model);
  settings.setProviderSetting('anthropic', 'base-url', sink.route.baseURL);
  settings.setProviderSetting('anthropic', 'auth-key', 'test-api-key');
  settings.setProviderSetting('anthropic', 'prompt-caching', cache);
  settings.set('reasoning.stripFromContext', strip);
  settings.set('reasoning.includeInContext', true);
  settings.set('model', model);
  settings.set('streaming', 'disabled');
  settings.set('token-usage-log', false);
  const provider = new ObservedAnthropicProvider(
    'test-api-key',
    sink.route.baseURL,
    TEST_PROVIDER_CONFIG,
  );
  provider.setRuntimeSettingsService(settings);
  const { chat, owner } = publicChat(
    provider,
    settings,
    history,
    model,
    sink.route.baseURL,
  );
  try {
    await history.addBatch(prior);
    await history.waitForCommit();
    await recording.setSessionName('Public pending user fixture');
    let output = '';
    const created = await operationFileCreates(async () => {
      output = await readLoggingChatStream(chat, { message }, 'anthropic-tail');
    });
    const reference = provider.references[0];
    const builder = new AnthropicProvider(
      'test-api-key',
      sink.route.baseURL,
      TEST_PROVIDER_CONFIG,
    );
    builder.setRuntimeSettingsService(settings);
    for await (const chunk of builder.generateChatCompletion(reference))
      void chunk;
    return {
      output,
      created,
      changedSources: provider.changedSources,
      requests: sink.requests,
    };
  } finally {
    await sink.close();
    await history.dispose();
    await recording.dispose();
    await owner.dispose();
  }
}
