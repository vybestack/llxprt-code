/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID, createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { ProviderCuratedStreamOptions } from '@vybestack/llxprt-code-core/services/history/provider-curated-stream.js';
import type { ApiRequestEvent } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import type { GenerateChatOptions } from '@vybestack/llxprt-code-providers/IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/runtimeTokenizerFactory.js';
import { withGpt56DiskSources } from '@vybestack/llxprt-code-providers/tokenizers/gpt56-disk-tokenizer-factory.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { projectionInstructions } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/projection-ownership-fixture.js';
import { StreamProcessor } from '../../StreamProcessor.js';
import { ConversationManager } from '../../ConversationManager.js';
import { CompressionHandler } from '../../../compression/CompressionHandler.js';
import type { ChatSessionConfig } from '../../chatSession.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

export const sourcePending: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Answer the history.' }],
};

/** Observes real normalization without replacing its work or ownership lifecycle. */
export class ObservedHistory extends HistoryService {
  readonly references: Array<WeakRef<IContent>> = [];
  readonly inputReferences: Array<WeakRef<IContent>> = [];
  readonly retained: IContent[] = [];
  readonly owners: Array<{ closed: boolean; count: number }> = [];
  override async prepareCuratedForProviderSnapshot(
    pending: readonly IContent[] = [],
    options: ProviderCuratedStreamOptions = {},
    override?: Iterable<IContent> | AsyncIterable<IContent>,
  ): Promise<ProviderRequestSnapshot> {
    const snapshot = await super.prepareCuratedForProviderSnapshot(
      pending,
      options,
      override,
    );
    const owner = { closed: false, count: snapshot.count };
    this.owners.push(owner);
    const references = this.references;
    const retained = this.retained;
    return {
      count: snapshot.count,
      pending: snapshot.pending,
      isPending: (index) => snapshot.isPending(index),
      async *openReader(signal): AsyncGenerator<IContent, void, unknown> {
        for await (const row of snapshot.openReader(signal)) {
          references.push(new WeakRef(row));
          if (process.env.ISSUE854_RETAIN_STREAM_ROWS === '1')
            retained.push(row);
          yield row;
        }
      },
      close() {
        owner.closed = true;
        snapshot.close();
      },
    };
  }
}

class ObservedResponsesProvider extends OpenAIResponsesProvider {
  readonly tokens: object[] = [];
  override async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const projected = await super.projectPromptEnvelope(options);
    this.tokens.push(projected.transportToken);
    return projected;
  }
}

export async function processorFixture(
  root: string,
  baseURL: string,
  large = false,
  count = 64,
) {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'gpt-5.6');
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  settings.set('retries', 1);
  settings.set('retrywait', 0);
  settings.set('context-limit', 4_000_000);
  const config = new Config({
    cwd: root,
    targetDir: root,
    sessionId: randomUUID(),
    model: 'gpt-5.6',
    debugMode: false,
    settingsService: settings,
    enableHooks: true,
    trustedFolder: true,
    hooks: {},
    telemetry: { enabled: true, logPrompts: false },
  });
  const nativeFactory = createRuntimeTokenizerFactory();
  await nativeFactory.prepareTokenizer?.('openai-responses', 'gpt-5.6');
  config.setTokenizerFactory(withGpt56DiskSources(nativeFactory, root));
  const provider = new ObservedResponsesProvider('test-key', baseURL);
  const history = new ObservedHistory();
  for (let index = 0; index < count; index++) {
    const row = diskTextRow(index, large);
    history.inputReferences.push(new WeakRef(row));
    history.add(row);
  }
  await history.waitForTokenUpdates();
  return assembleProcessorFixture(
    config,
    settings,
    nativeFactory,
    provider,
    history,
    baseURL,
  );
}

function assembleProcessorFixture(
  config: Config,
  settings: SettingsService,
  nativeFactory: RuntimeTokenizerFactory,
  provider: ObservedResponsesProvider,
  history: ObservedHistory,
  baseURL: string,
) {
  const requests: ApiRequestEvent[] = [];
  const providerRuntime = {
    config,
    settingsService: settings,
    runtimeId: randomUUID(),
  };
  const runtime = createAgentRuntimeContext({
    state: {
      runtimeId: providerRuntime.runtimeId,
      sessionId: config.getSessionId(),
      provider: provider.name,
      model: 'gpt-5.6',
      updatedAt: Date.now(),
      baseUrl: baseURL,
    },
    history,
    settings: { contextLimit: 4_000_000 },
    providerRuntime,
    provider: { getActiveProvider: () => provider, setActiveProvider() {} },
    tools: { listToolNames: () => [], getToolMetadata: () => undefined },
    telemetry: {
      logApiRequest(event) {
        requests.push(event);
      },
      logApiResponse() {},
      logApiError() {},
    },
  });
  const generation: ChatSessionConfig = {
    systemInstruction: projectionInstructions,
  };
  const compression = new CompressionHandler(
    runtime,
    history,
    generation,
    () => ({ provider, runtime: providerRuntime }),
    async () => undefined,
  );
  const processor = new StreamProcessor(
    runtime,
    new ConversationManager(history, runtime),
    compression,
    () => provider,
    (_source, metadata) => ({ ...providerRuntime, metadata }),
    history,
    generation,
  );
  return {
    config,
    settings,
    nativeFactory,
    provider,
    history,
    requests,
    compression,
    processor,
    runtime,
    generation,
  };
}

export function largestSourceRowBytes(large: boolean): number {
  return diskTextRow(63, large).blocks.reduce(
    (sum, block) =>
      sum + (block.type === 'text' ? Buffer.byteLength(block.text) : 0),
    0,
  );
}

export function sourceWireOracle(
  large: boolean,
  pending: IContent = sourcePending,
): {
  bytes: number;
  sha256: string;
} {
  const hash = createHash('sha256');
  let bytes = 0;
  const append = (value: string): void => {
    bytes += Buffer.byteLength(value);
    hash.update(value);
  };
  append('{"model":"gpt-5.6","input":[');
  for (let index = 0; index < 65; index++) {
    if (index !== 0) append(',');
    const row = index === 64 ? pending : diskTextRow(index, large);
    append(
      JSON.stringify({
        role: row.speaker === 'human' ? 'user' : 'assistant',
        content: row.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(row.speaker === 'human' ? '\n' : ''),
      }),
    );
  }
  append(
    `],"stream":true,"instructions":${JSON.stringify(projectionInstructions)}}`,
  );
  return { bytes, sha256: hash.digest('hex') };
}
