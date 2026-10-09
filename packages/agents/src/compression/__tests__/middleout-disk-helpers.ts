import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeModel } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeModel.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { providerFixtureRow } from '../../../../core/src/services/history/provider-curated-test-helpers.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export class MiddleoutDiskHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager middle-out preparation forbidden',
    );
  }
  override replaceAll(): Promise<void> {
    throw new Error('eager middle-out publication forbidden');
  }
}

export function middleoutRow(index: number, bytes = 2048): IContent {
  const row = providerFixtureRow(index, bytes);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      model: 'historical-model',
      ...(index === 0
        ? { semanticMediaPurgeFrontier: { contentIndex: 1, blockIndex: 0 } }
        : {}),
    },
  };
}

export class SummaryTransport {
  readonly name = 'summary-transport';
  readonly requests: string[] = [];
  failure: Error | undefined;
  empty = false;
  beforeSend?: (options: RuntimeGenerateChatOptions) => Promise<void>;
  async getModels(): Promise<RuntimeModel[]> {
    return [];
  }
  async *generateChatCompletion(
    options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!('contents' in options)) throw new Error('Expected chat options');
    const delivered: IContent[] = [];
    for await (const row of options.contents) delivered.push(row);
    this.requests.push(JSON.stringify(delivered));
    await this.beforeSend?.(options);
    if (this.failure !== undefined) throw this.failure;
    if (this.empty) {
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: { finishReason: 'stop', rawStopReason: 'end_turn' },
      };
      return;
    }
    yield {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'checking', signature: 'sig' },
        { type: 'text', text: '<state_snapshot>kept ' },
      ],
    };
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'details</state_snapshot>' }],
      metadata: {
        usage: { promptTokens: 71, completionTokens: 9, totalTokens: 80 },
      },
    };
  }
}

export function middleoutSetup(
  history: HistoryService,
  transport = new SummaryTransport(),
  hook: ConstructorParameters<typeof CompressionHandler>[4] = async () => {},
  overrides: Parameters<typeof buildRuntimeContext>[1] = {},
): {
  handler: CompressionHandler;
  transport: SummaryTransport;
  runtime: ReturnType<typeof buildRuntimeContext>;
} {
  history.setTokenizerFactory(exactTokenizer());
  const runtime = buildRuntimeContext(history, {
    compressionStrategy: 'middle-out',
    ...overrides,
  });
  const handler = new CompressionHandler(
    runtime,
    history,
    {},
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    hook,
  );
  handler.setActiveTodosProvider(async () => 'finish the experiment');
  handler.setTranscriptPathProvider(() => '/fixture/session.jsonl');
  return { handler, transport, runtime };
}

export async function middleoutOracle(
  history: HistoryService,
  size: number,
  bytes = 2048,
  makeRow: (index: number, bytes: number) => IContent = middleoutRow,
): Promise<{ rows: readonly IContent[]; requests: string[]; top: number }> {
  await buildCompressionSystemInstruction('test-model', {
    provider: 'summary-transport',
    interactionMode: 'non-interactive',
  });
  const { runtime, transport } = middleoutSetup(history);
  const logger = new DebugLogger('test:middleout-oracle');
  const raw = Array.from({ length: size }, (_, index) => makeRow(index, bytes));
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    async () => 'finish the experiment',
    () => '/fixture/session.jsonl',
    logger,
  );
  const context = {
    ...metadata,
    history: buildCuratedHistory(logger, raw, false),
  };
  let result = await new MiddleOutStrategy().compress(context);
  if (result.kind === 'noop')
    result = await new OneShotStrategy().compress(context);
  if (result.kind !== 'applied')
    throw new Error('Expected legacy oracle compression');
  const top = result.metadata.topPreserved ?? 0;
  const annotated = annotateCompressionSpan(raw, result.newHistory).map(
    (row, index) => {
      const metadata = { ...row.metadata };
      delete metadata.cacheAnchor;
      if (index === top - 1) metadata.cacheAnchor = true;
      return { ...row, metadata };
    },
  );
  return {
    rows: invalidateResponsesStatefulChain(annotated),
    requests: transport.requests,
    top,
  };
}
