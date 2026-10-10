/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProviderToolset } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { sourceBeforeModelHook } from './source-before-model-hook.js';
import type { CompressionHandler } from '../compression/CompressionHandler.js';
import type { SourcePendingRows } from '../compression/source-candidate.js';
import {
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PreparedSourcePromptEnvelopeSend,
  type PromptEnvelopeSource,
} from './prompt-envelope-source-send.js';
import { estimateSourcePendingTokens } from '../compression/compressionBudgeting.js';
import { preparePendingContents } from './streamRequestHelpers.js';
import {
  pendingAwareRequestSelection,
  sourcePendingMembership,
  type PendingAwareRequestSelection,
} from './source-pending-selection.js';

export function assertSourceRuntimeConfig(runtime: AgentRuntimeContext): void {
  if (runtime.providerRuntime.config === undefined)
    throw new Error('Disk source requires live runtime config');
}

interface StreamDiskSourceInput {
  readonly runtime: AgentRuntimeContext;
  readonly compression: CompressionHandler;
  readonly history: HistoryService;
  readonly userContent: IContent | IContent[];
  readonly promptId: string;
  readonly historyOverride?: AsyncIterable<IContent>;
  readonly provider: RuntimeProvider;
  readonly tools?: RuntimeProviderToolset;
  readonly log: (message: string) => void;
  readonly signal?: AbortSignal;
  readonly buildOptions: (
    contents: AsyncIterable<IContent>,
    count: number,
  ) => RuntimeGenerateChatOptions;
  readonly onPrepared: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => void | Promise<void>;
  /** Streaming callers retry around the whole send; direct turns retry inside it. */
  readonly shouldRetryOnError?: (error: unknown) => boolean;
  readonly send?: (
    prepared: PreparedSourcePromptEnvelopeSend,
    attemptIndex: number,
  ) => AsyncIterableIterator<IContent>;
  readonly onReleased?: () => void;
}

/** Raw pending input for recomposition, which is not the normalized output membership. */
async function rawPendingInput(
  selection: PendingAwareRequestSelection,
  prepared: IContent[],
  signal?: AbortSignal,
): Promise<IContent[]> {
  const recovered = selection.pendingSelection;
  if (recovered?.kind !== 'hook-recovered-input') return prepared;
  const rows: IContent[] = [];
  for await (const row of recovered.rows.openReader(signal)) rows.push(row);
  return rows;
}

function sourceFallbackEstimate(input: StreamDiskSourceInput) {
  return (rows: PromptEnvelopeSource, signal?: AbortSignal): Promise<number> =>
    estimateSourcePendingTokens(
      rows,
      input.history,
      input.runtime.state.model,
      signal,
    );
}

/** The product send. No request-wide content graph is fabricated or retained. */
export async function streamDiskSource(
  input: StreamDiskSourceInput,
): Promise<AsyncIterableIterator<IContent>> {
  assertSourceRuntimeConfig(input.runtime);
  input.signal?.throwIfAborted();
  const preparedPending = preparePendingContents(
    input.userContent,
    input.history,
  );
  const snapshot = await input.history.prepareCuratedForProviderSnapshot(
    preparedPending,
    { signal: input.signal },
    input.historyOverride,
  );
  const source = await sourceBeforeModelHook({
    config: input.runtime.providerRuntime.config,
    snapshot,
    pending: input.userContent,
    model: input.runtime.state.model,
    tools: input.tools,
    log: input.log,
    signal: input.signal,
  });
  let recomposedPending: IContent[] | undefined;
  const pending: SourcePendingRows = {
    read: async () =>
      (recomposedPending ??= await rawPendingInput(
        source,
        preparedPending,
        input.signal,
      )),
    replace: (rows) => {
      recomposedPending = rows;
    },
  };
  const reopen = async (): Promise<PendingAwareRequestSelection> => {
    const rebuilt = await input.history.prepareCuratedForProviderSnapshot(
      await pending.read(),
      { signal: input.signal },
    );
    return pendingAwareRequestSelection(
      rebuilt,
      sourcePendingMembership(rebuilt),
    );
  };
  return enforceAndStreamSourcePromptEnvelopeRetries({
    provider: input.provider,
    source,
    signal: input.signal,
    fallbackEstimate: sourceFallbackEstimate(input),
    buildOptions: (rows) => ({
      ...input.buildOptions(
        { [Symbol.asyncIterator]: () => rows.openReader(input.signal) },
        rows.count,
      ),
      requestRows: rows,
      contentCount: rows.count,
    }),
    enforce: (_rows, estimate) =>
      input.compression.enforceProviderSource(
        input.provider,
        input.promptId,
        source,
        estimate,
        reopen,
        source.pendingSelection !== undefined,
        pending,
      ),
    onPrepared: input.onPrepared,
    send: input.send,
    onReleased: input.onReleased,
    shouldRetryOnError: input.shouldRetryOnError ?? (() => false),
  });
}
