/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import { vi } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { exactTokenizer } from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { createRecorderForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core/recording/recordingPort.js';
import {
  fallbackRecordingFault,
  assertFallbackCommitted,
} from './support/fallback-recording-fault.js';
import { FallbackPublicationOwner } from './support/fallback-publication-owner.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  createRowCounters,
  type RowCounters,
} from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import type { FallbackTransactionDeps } from '../providerFallbackTransaction.js';
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
  performProviderDiskFallback: FallbackTransactionDeps['performFallbackCompression'];
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
  readAt: inMemoryRequestSelection([]).readAt,
  async *openReader() {},
  close() {},
});

export class FallbackDiskHistory extends HistoryService {}

export interface FallbackFixture {
  history: FallbackDiskHistory;
  recorder: Pick<SessionRecordingPort, 'flush'> & {
    failure: Error;
    failAdmissionAfter(successes: number): void;
  };
  reads: RowCounters;
  owners: RowOwnership;
  before: string;
  failCompensation(): Promise<void>;
  pausePublication(ready: () => void, release: Promise<void>): Promise<void>;
}

export async function withFallbackFixture(
  size: number,
  action: (fixture: FallbackFixture) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'provider-fallback-journal-'));
  const recorder = createRecorderForTest({
    sessionId: 'fallback',
    projectHash: 'fallback',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
  });
  recorder.recordSessionMetadata('provider fallback fixture');
  const fault = await fallbackRecordingFault(root);
  const reads = createRowCounters();
  const owners = new RowOwnership();
  const history = fault.attach(
    () =>
      new FallbackDiskHistory({
        recording: recorder,
        attachmentCounters: { ...reads.counters, ownership: owners },
        mutationOwnership: owners,
      }),
  );
  history.setTokenizerFactory(exactTokenizer());
  const media = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024,
  });
  const owner = new FallbackPublicationOwner(media);
  try {
    await history.detachedValues.replace(
      (function* () {
        for (let index = 0; index < size; index++)
          yield toolRankingRow(index, 2048);
      })(),
      'test',
      { publishTokens: true },
    );
    await history.waitForCommit();
    await recorder.flush();
    await history.registerMediaOwner(owner);
    await history.settleMediaOwnership();
    history.setCacheAnchorSeq(1);
    history.setBaseTokenOffset(37);
    const before = await digestRows(history.streamRawHistory());
    await action({
      history,
      recorder: {
        flush: () => recorder.flush(),
        failure: fault.failure,
        failAdmissionAfter: fault.failAdmissionAfter,
      },
      reads,
      owners,
      before,
      failCompensation: async () => {
        owner.rejectNext(fault.failure);
      },
      pausePublication: async (ready, release) => {
        owner.rejectNext(new Error('paused provider publication rejected'), {
          snapshot: await history.openDumpSnapshot(),
          ready,
          release,
        });
      },
    });
    await assertFallbackCommitted(history, recorder, root);
  } finally {
    await history.dispose();
    await recorder.dispose();
    await media.close();
    rmSync(root, { recursive: true, force: true });
  }
}

export function fallbackHarness(
  history: HistoryService,
  fallback: FallbackTransactionDeps['performFallbackCompression'],
  options: { fits?: boolean; resetFails?: boolean; logger?: DebugLogger } = {},
): FallbackHarness {
  let attempted = false;
  const handler = new CompressionHandler(
    buildRuntimeContext(history, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    }),
    undefined,
    history,
    undefined,
    undefined,
    undefined,
    undefined,
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
