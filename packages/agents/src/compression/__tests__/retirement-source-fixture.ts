/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ProviderRequestSelection,
  ProviderRequestRows,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeCompressionGuardInfo } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { ProviderContentEnforcer } from '../providerContentEnforcement.js';
import {
  ProviderSourceEnforcer,
  type ProviderSourceLimits,
} from '../provider-source-enforcement.js';
import { SourceCandidate } from '../source-candidate.js';
import {
  runSourceStages,
  type SourceStageActions,
} from '../source-stage-ladder.js';
import { runGuardedCompression } from '../guardedCompression.js';
import { executeFallbackTransaction } from '../providerFallbackTransaction.js';
import { truncateSourceToolResponses } from '../source-tool-truncation.js';
import {
  retireSourceImages,
  assertSourcePendingMediaBudget,
} from '../source-image-retirement.js';
import { createSourceCompressionCallback } from '../source-compression-callback.js';
import { openNativeProviderFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/native-provider-fixture.js';

export async function collectRequestRows(
  source: ProviderRequestRows,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source.openReader()) rows.push(row);
  return rows;
}
export async function readHistory(
  history: HistoryService,
): Promise<IContent[]> {
  await history.waitForCommit();
  const rows: IContent[] = [];
  for await (const row of history.streamRawHistory()) rows.push(row);
  return rows;
}
export async function readCurated(
  history: HistoryService,
): Promise<IContent[]> {
  const source = await history.prepareCuratedForProviderSnapshot([]);
  try {
    return await collectRequestRows(source);
  } finally {
    await source.close();
  }
}

export interface RetirementSourceInput {
  readonly history: HistoryService;
  readonly directory: string;
  readonly pending: IContent[];
  readonly protectedContents: IContent[];
  readonly contents?: IContent[];
  readonly recoverable: boolean;
  readonly budget: number;
  readonly contextLimit: number;
  readonly model: string;
  readonly compress: () => Promise<PerformCompressionResult>;
  readonly fallback: (
    apply: (rows: IContent[]) => Promise<void>,
  ) => Promise<boolean>;
}

export async function retirementSource(
  input: RetirementSourceInput,
): Promise<ProviderRequestSelection> {
  await input.history.waitForCommit();
  return input.contents === undefined
    ? input.history.prepareCuratedForProviderSnapshot(input.pending)
    : openNativeProviderFixture(
        input.directory,
        input.contents,
        input.contents.length,
      );
}

export async function enforceRetirementSource(
  input: RetirementSourceInput,
  initial: ProviderRequestSelection,
  estimate: (source: ProviderRequestSelection) => Promise<number>,
  own: (source: ProviderRequestSelection) => void,
  guard?: RuntimeCompressionGuardInfo,
): Promise<ProviderRequestSelection> {
  const logger = new DebugLogger('test:retirement-source');
  const candidate = makeRetirementCandidate(input, initial, estimate, own);
  const limits = new ProviderContentEnforcer({
    runtimeContext: {
      state: { model: input.model },
      ephemerals: {
        contextLimit: () => input.contextLimit,
        compressionThreshold: () => 0.8,
      },
    },
    generationConfig: { maxOutputTokens: 1000 },
    readCompletionBudgetSetting: () => undefined,
  }).sourceContextLimits({
    name: 'anthropic',
    getDefaultModel: () => input.model,
    getModels: async () => [],
    async *generateChatCompletion() {},
  });
  const actions = (active: ProviderSourceLimits) =>
    retirementActions(input, candidate, active, logger);
  if (guard !== undefined) {
    // Guard calibration sees the original request, before the retirement view.
    const callback = createSourceCompressionCallback({
      candidate,
      defaultLimits: limits,
      estimateByContents: (rows) =>
        input.history.estimateTokensForContents(
          { [Symbol.asyncIterator]: () => rows.openReader() },
          input.model,
        ),
      pendingRecoverable: input.recoverable,
      getHistoryTokens: () => input.history.getTotalTokens(),
      stageActions: actions,
      warn: () => undefined,
    });
    return callback(guard);
  }
  await candidate.prepareView();
  await runSourceStages(
    new ProviderSourceEnforcer({
      limits,
      estimate: () => candidate.estimate(),
      getHistoryTokens: () => input.history.getTotalTokens(),
    }),
    actions(limits),
    input.recoverable,
  );
  return candidate.value;
}

function makeRetirementCandidate(
  input: RetirementSourceInput,
  initial: ProviderRequestSelection,
  estimate: (source: ProviderRequestSelection) => Promise<number>,
  own: (source: ProviderRequestSelection) => void,
): SourceCandidate<ProviderRequestSelection> {
  let pending = input.pending;
  const capture = () => input.history.historyMutationGuard();
  return new SourceCandidate(
    initial,
    estimate,
    async () => {
      const source =
        await input.history.prepareCuratedForProviderSnapshot(pending);
      own(source);
      return source;
    },
    {
      read: async () => pending,
      replace: (rows) => {
        pending = rows;
      },
    },
    capture,
    async (source, all, error) => {
      if (error !== undefined) {
        await assertSourcePendingMediaBudget(
          source,
          input.protectedContents,
          error,
        );
        return source;
      }
      const projected = await retireSourceImages(
        source,
        input.protectedContents,
        input.budget,
        all,
      );
      own(projected);
      return projected;
    },
  );
}
function retirementActions(
  input: RetirementSourceInput,
  candidate: SourceCandidate<ProviderRequestSelection>,
  active: ProviderSourceLimits,
  logger: DebugLogger,
): SourceStageActions {
  const state = {
    historyService: input.history,
    logger,
    model: input.model,
    getPromptTokenBaseline: () => null,
    resetPromptTokenBaseline: () => undefined,
    restorePromptTokenBaseline: () => undefined,
  };
  return {
    optimizeDensity: async () => input.history.waitForTokenUpdates(),
    compress: async () => {
      const failure = await runGuardedCompression(
        { ...state, performCompression: input.compress },
        'retirement',
      );
      if (failure !== undefined) throw failure;
      return PerformCompressionResult.COMPRESSED;
    },
    replaceSource: () => candidate.replace(),
    relieveMediaPressure: () => candidate.prepareView(true),
    checkMediaPressure: (error) => candidate.checkMediaPressure(error),
    fallback: (target) =>
      executeFallbackTransaction(
        {
          ...state,
          performFallbackCompression: (_id, install) =>
            input.fallback(async (rows) => {
              await install({
                rows: {
                  length: rows.length,
                  readRow: (index) => rows[index],
                  *[Symbol.iterator]() {
                    yield* rows;
                  },
                },
                start: 0,
                hasPendingRows: false,
              });
            }),
        },
        'retirement',
        target,
      ),
    truncateToolResponses: () =>
      truncateSourceToolResponses({
        historyService: input.history,
        logger,
        model: input.model,
        marginAdjustedLimit: active.marginAdjustedLimit,
        completionBudget: active.completionBudget,
        candidate,
      }),
    warn: () => undefined,
  };
}
