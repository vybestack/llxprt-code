/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SourceCandidate } from '../../source-candidate.js';
import { truncateOversizedToolResponsesUnified } from '../../toolResultTruncator.js';

type JournalTransform = Parameters<
  HistoryService['detachedValues']['transform']
>[0];
type DetachedHistorySource = Parameters<JournalTransform>[0];
type DetachedHistorySink = Parameters<JournalTransform>[1];

export const FIXTURE_MODEL = 'test-model';
export const COMPLETION_BUDGET = 100;
const PAYLOAD_BYTES = 2048;

/**
 * Three-row cycle: human text, ai text, tool response. Every seventh ai row
 * carries a stored Responses parent so chain invalidation is exercised. Tool
 * payload sizes vary so the ranking is not one long tie.
 */
export function mixedRow(index: number, payloadBytes: number): IContent {
  const chronology = {
    seq: index + 1,
    userTurn: Math.floor(index / 3) + 1,
    step: index % 3,
    recordedAt: 0,
  };
  const kind = index % 3;
  if (kind === 2) {
    return {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `call-${index}`,
          toolName: 'read_file',
          result: {
            index,
            payload: 'x'.repeat(payloadBytes + (index % 5) * 64),
          },
        },
      ],
      metadata: { chronology },
    };
  }
  return {
    speaker: kind === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${index}:${'y'.repeat(payloadBytes)}` }],
    metadata: {
      chronology,
      ...(kind === 1 && index % 7 === 1 ? { responsesStored: true } : {}),
    },
  };
}

export function pendingToolRow(index: number, bytes: number): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: `pending-${index}`,
        toolName: 'shell',
        result: { index, payload: 'p'.repeat(bytes) },
      },
    ],
  };
}

export function withMixedHistory<T>(
  size: number,
  action: (history: HistoryService) => Promise<T>,
): Promise<T> {
  return withSuffixFixture(
    size,
    (history) => action(history),
    PAYLOAD_BYTES,
    mixedRow,
  );
}

export interface StageWork {
  /** Rows streamed by candidate projections. */
  projectedRows: number;
  /** Rows rebuilt into a new disk candidate. */
  copiedRows: number;
  /** Rows read plus rows written by journal transactions. */
  journalRows: number;
  projections: number;
  copies: number;
  journalWrites: number;
}

/**
 * Per-block estimates summed per row. `toolWeight` scales tool responses so a
 * projection can disagree with the stage's own estimator.
 */
async function blockTokens(
  history: HistoryService,
  row: IContent,
  toolWeight: number,
): Promise<number> {
  let total = 0;
  for (const block of row.blocks) {
    const tokens = await history.estimateTokensForContents(
      [{ speaker: 'tool', blocks: [block] }],
      FIXTURE_MODEL,
    );
    total += block.type === 'tool_response' ? tokens * toolWeight : tokens;
  }
  return total;
}

/** Request tokens as the sum of per-block estimates, matching the stage's own estimator at weight 1. */
async function projectRows(
  history: HistoryService,
  pending: readonly IContent[],
  work: StageWork,
  toolWeight: number,
): Promise<number> {
  let total = 0;
  for await (const row of history.streamRawHistory()) {
    work.projectedRows++;
    total += await blockTokens(history, row, toolWeight);
  }
  for (const row of pending) {
    work.projectedRows++;
    total += await blockTokens(history, row, toolWeight);
  }
  return total;
}

export function newStageWork(): StageWork {
  return {
    projectedRows: 0,
    copiedRows: 0,
    journalRows: 0,
    projections: 0,
    copies: 0,
    journalWrites: 0,
  };
}

/** Counts every journal transaction and the rows it reads and writes. */
export function countJournalWrites(
  history: HistoryService,
  work: StageWork,
): void {
  const transform = history.detachedValues.transform.bind(
    history.detachedValues,
  );
  history.detachedValues.transform = (task, model, options) => {
    work.journalWrites++;
    return transform(
      async (source: DetachedHistorySource, sink: DetachedHistorySink) => {
        const counted: DetachedHistorySource = {
          ...source,
          streamRows: (signal) => countRows(source.streamRows(signal), work),
        };
        const countedSink: DetachedHistorySink = {
          ...sink,
          appendValue: (row) => {
            work.journalRows++;
            return sink.appendValue(row);
          },
        };
        await task(counted, countedSink);
      },
      model,
      options,
    );
  };
}

async function* countRows(
  rows: AsyncIterable<IContent>,
  work: StageWork,
): AsyncGenerator<IContent> {
  for await (const row of rows) {
    work.journalRows++;
    yield row;
  }
}

export function candidateOver(
  history: HistoryService,
  pending: IContent[],
  work: StageWork,
  toolWeight = 1,
): SourceCandidate<object> {
  let current = pending;
  return new SourceCandidate<object>(
    {},
    async () => {
      work.projections++;
      return projectRows(history, current, work, toolWeight);
    },
    async () => {
      work.copies++;
      for await (const row of history.streamRawHistory()) {
        void row;
        work.copiedRows++;
      }
      return {};
    },
    {
      read: async () => current,
      replace: (rows) => {
        current = rows;
      },
    },
  );
}

export async function totalRequestTokens(
  history: HistoryService,
  pending: readonly IContent[],
  toolWeight = 1,
): Promise<number> {
  return projectRows(history, pending, newStageWork(), toolWeight);
}

export interface SourceTruncationInput {
  readonly historyService: HistoryService;
  readonly logger: DebugLogger;
  readonly model: string;
  readonly marginAdjustedLimit: number;
  readonly completionBudget: number;
  readonly candidate: SourceCandidate<object>;
}

export function stageInput(
  history: HistoryService,
  candidate: SourceCandidate<object>,
  requestLimit: number,
): SourceTruncationInput {
  return {
    historyService: history,
    logger: new DebugLogger('test:source-tool-truncation'),
    model: FIXTURE_MODEL,
    marginAdjustedLimit: requestLimit + COMPLETION_BUDGET,
    completionBudget: COMPLETION_BUDGET,
    candidate,
  };
}

/**
 * The stage as it was wired before the one-pass rewrite: the unified
 * truncator with one candidate reopen and projection after every replacement.
 * Differential tests compare the current stage against it.
 */
export async function legacyTruncateSourceToolResponses(
  input: SourceTruncationInput,
): Promise<{ readonly replacedCount: number }> {
  const { historyService, logger, model, candidate } = input;
  const result = await truncateOversizedToolResponsesUnified(
    {
      historyService,
      logger,
      pendingContents: await candidate.pending.read(),
      estimateBlockTokensAsync: (block) =>
        historyService.estimateTokensForContents(
          [{ speaker: 'tool', blocks: [block] }],
          model,
        ),
      computeProjected: async (working) =>
        (await candidate.estimateWithPending([...working])) +
        input.completionBudget,
      resetBaseline: () => {},
      getRuntimeModel: () => model,
    },
    input.marginAdjustedLimit,
  );
  if (result.transformedPending !== undefined)
    candidate.pending.replace(result.transformedPending);
  return { replacedCount: result.replacedCount };
}

export async function journalDigest(history: HistoryService): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of history.streamRawHistory())
    hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}
