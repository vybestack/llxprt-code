/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  AdmissionFailureRecorder,
  exactTokenizer,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import {
  createRowCounters,
  type RowCounters,
} from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import type { ProviderContentEnforcementDeps } from '../providerContentEnforcement.js';
import { CompressionHandler } from '../CompressionHandler.js';
import {
  pendingAwareRequestSelection,
  type PendingAwareRequestSelection,
} from '../../core/source-pending-selection.js';
import { enforceProviderSourceSelectionForTest } from './support/enforce-provider-source.js';
import {
  toolRankingRow,
  digestRows,
} from './tool-truncation-stream-helpers.js';

interface FallbackHandlerInternals {
  logger: DebugLogger;
  lastPromptTokenCount: number | null;
  performProviderDiskFallback: ProviderContentEnforcementDeps['performFallbackCompression'];
}

export interface FallbackHarness {
  handler: CompressionHandler;
  history: HistoryService;
  estimate: (candidate: ProviderRequestSelection) => Promise<number>;
  baseline: () => number | null;
  openSelection: (
    realOpen: () => Promise<PendingAwareRequestSelection>,
  ) => Promise<PendingAwareRequestSelection>;
}

const EMPTY_ROWS: ProviderRequestSelection = Object.freeze({
  count: 0,
  async *openReader() {},
  close() {},
});

export class FallbackDiskHistory extends HistoryService {}

export interface FallbackFixture {
  history: FallbackDiskHistory;
  recorder: AdmissionFailureRecorder;
  reads: RowCounters;
  owners: RowOwnership;
  before: string;
}

export async function withFallbackFixture(
  size: number,
  action: (fixture: FallbackFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../../tmp/provider-fallback-journal-',
    ),
  );
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'fallback',
    projectHash: 'fallback',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  const reads = createRowCounters();
  const owners = new RowOwnership();
  const history = new FallbackDiskHistory({
    recording: recorder,
    attachmentCounters: reads.counters,
    mutationOwnership: owners,
  });
  history.setTokenizerFactory(exactTokenizer());
  try {
    await history.transformRows(async (_source, sink) => {
      for (let index = 0; index < size; index++)
        sink.appendDetached(toolRankingRow(index, 2048));
    }, 'test');
    await recorder.flush();
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const before = await digestRows(history.streamRawHistory());
    await action({ history, recorder, reads, owners, before });
  } finally {
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

export function fallbackHarness(
  history: HistoryService,
  fallback: ProviderContentEnforcementDeps['performFallbackCompression'],
  options: { fits?: boolean; resetFails?: boolean; logger?: DebugLogger } = {},
): FallbackHarness {
  let attempted = false;
  const handler = new CompressionHandler(
    buildRuntimeContext(history, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    }),
    history,
    {},
    () => ({ provider: {} as never, runtime: {} as never }),
    async () => {},
  );
  const internals = handler as unknown as FallbackHandlerInternals;
  if (options.logger !== undefined) internals.logger = options.logger;
  internals.lastPromptTokenCount = 123;
  vi.spyOn(handler, 'ensureDensityOptimized').mockResolvedValue(undefined);
  vi.spyOn(handler, 'performCompression').mockResolvedValue(
    PerformCompressionResult.FAILED,
  );
  internals.performProviderDiskFallback = async (...args) => {
    try {
      return await fallback(...args);
    } finally {
      attempted = true;
    }
  };
  if (options.resetFails === true) {
    // The source route resets the baseline through a setter on the handler;
    // fail that reset the way the original harness did.
    let baseline: number | null = internals.lastPromptTokenCount;
    Object.defineProperty(internals, 'lastPromptTokenCount', {
      configurable: true,
      get: () => baseline,
      set: (value: number | null) => {
        if (value === null) throw new Error('baseline reset failed');
        baseline = value;
      },
    });
  }
  const estimate = async (
    candidate: ProviderRequestSelection,
  ): Promise<number> => {
    if (attempted && options.fits !== true)
      throw new Error('stop after fallback projection');
    if (options.fits !== true) return 150_000;
    // Stream the candidate: the large-history cases must not materialise it.
    for await (const row of candidate.openReader()) {
      if (
        row.blocks.some(
          (block) => block.type === 'text' && block.text === 'candidate',
        )
      )
        return 1;
    }
    return 150_000;
  };
  return {
    handler,
    history,
    estimate,
    // Each real snapshot of the 8192-row history costs seconds of provider
    // normalization. Selections are only read when the harness estimate
    // inspects the installed candidate (fits), which happens after the
    // fallback ran. Every other stage sees a constant or throwing estimate and
    // gets an empty selection.
    openSelection: async (realOpen) =>
      attempted && options.fits === true
        ? realOpen()
        : pendingAwareRequestSelection(EMPTY_ROWS, undefined),
    baseline: () => internals.lastPromptTokenCount,
  };
}

export function fallbackCandidate(bytes = 0): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'candidate' },
      { type: 'text', text: 'x'.repeat(bytes) },
    ],
  };
}

export function enforceFallback(harness: FallbackHarness): Promise<IContent[]> {
  const pending: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'pending' }],
  };
  return enforceProviderSourceSelectionForTest(
    harness.handler,
    harness.history,
    [pending],
    'disk-fallback',
    undefined,
    harness.estimate,
    harness.openSelection,
  );
}
