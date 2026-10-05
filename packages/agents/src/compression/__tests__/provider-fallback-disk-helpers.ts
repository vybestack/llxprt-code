/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import {
  toolRankingRow,
  digestRows,
} from './tool-truncation-stream-helpers.js';

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
): { enforcer: ProviderContentEnforcer; baseline: () => number | null } {
  let baseline: number | null = 123;
  let attempted = false;
  const deps: ProviderContentEnforcementDeps = {
    historyService: history,
    runtimeContext: buildRuntimeContext(history, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    }),
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger: options.logger ?? new DebugLogger('test:fallback-disk'),
    ensureDensityOptimized: async () => {},
    performCompression: async () => PerformCompressionResult.FAILED,
    performFallbackCompression: async (...args) => {
      try {
        return await fallback(...args);
      } finally {
        attempted = true;
      }
    },
    getPromptTokenBaseline: () => baseline,
    resetPromptTokenBaseline: () => {
      baseline = 0;
      if (options.resetFails === true) throw new Error('baseline reset failed');
    },
    restorePromptTokenBaseline: (value) => {
      baseline = value;
    },
    estimateFinalizedPromptTokens: async (contents) => {
      if (attempted && options.fits !== true)
        throw new Error('stop after fallback projection');
      return options.fits === true &&
        contents.some((row) =>
          row.blocks.some(
            (block) => block.type === 'text' && block.text === 'candidate',
          ),
        )
        ? 1
        : 150_000;
    },
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    baseline: () => baseline,
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

export function enforceFallback(
  enforcer: ProviderContentEnforcer,
): Promise<IContent[]> {
  const pending: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'pending' }],
  };
  return enforcer.enforce(
    { contents: [pending], pendingContents: [pending] },
    'disk-fallback',
  );
}
