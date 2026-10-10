/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import {
  pendingAwareRequestSelection,
  sourcePendingMembership,
  type PendingAwareRequestSelection,
} from '../../../core/source-pending-selection.js';
import type { CompressionHandler } from '../../CompressionHandler.js';
import type { SourcePendingRows } from '../../source-candidate.js';

export async function collectSelection(
  selection: ProviderRequestSelection,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of selection.openReader()) rows.push(row);
  return rows;
}

/**
 * Drives the product enforcement ladder (CompressionHandler.enforceProviderSource)
 * the way the stream processor does: the candidate is the pending-aware
 * snapshot of `history`, and every candidate is measured by `estimateRows`
 * over its materialised rows. Returns the surviving rows and leaves the
 * provider compression callback attached, as the product does on success.
 */
export function enforceProviderSourceForTest(
  handler: CompressionHandler,
  history: HistoryService,
  pendingContents: IContent[],
  promptId: string,
  provider: RuntimeProvider | undefined,
  estimateRows: (rows: IContent[]) => Promise<number> = (rows) =>
    history.estimateTokensForContents(rows),
  pendingRecoverable = true,
): Promise<IContent[]> {
  return enforceProviderSourceSelectionForTest(
    handler,
    history,
    pendingContents,
    promptId,
    provider,
    async (candidate) => estimateRows(await collectSelection(candidate)),
    undefined,
    pendingRecoverable,
  );
}

/**
 * Same ladder as enforceProviderSourceForTest, but the estimator receives the
 * candidate selection itself so tests over large histories can stream it
 * instead of materialising every row. `openSelection` may substitute the
 * snapshot opened for a stage whose rows the test never inspects.
 * `pendingRecoverable` false models a BeforeModel hook that discarded the
 * pending boundary.
 */
export async function enforceProviderSourceSelectionForTest(
  handler: CompressionHandler,
  history: HistoryService,
  pendingContents: IContent[],
  promptId: string,
  provider: RuntimeProvider | undefined,
  estimateSelection: (candidate: ProviderRequestSelection) => Promise<number>,
  openSelection: (
    realOpen: () => Promise<PendingAwareRequestSelection>,
  ) => Promise<PendingAwareRequestSelection> = (realOpen) => realOpen(),
  pendingRecoverable = true,
): Promise<IContent[]> {
  let pendingRows = pendingContents;
  const realOpen = async (): Promise<PendingAwareRequestSelection> => {
    const snapshot =
      await history.prepareCuratedForProviderSnapshot(pendingRows);
    return pendingAwareRequestSelection(
      snapshot,
      sourcePendingMembership(snapshot),
    );
  };
  const open = (): Promise<PendingAwareRequestSelection> =>
    openSelection(realOpen);
  const pending: SourcePendingRows = {
    read: async () => pendingRows,
    replace: (rows) => {
      pendingRows = rows;
    },
  };
  const source = await open();
  const enforced = await handler.enforceProviderSource(
    provider ?? ({ name: 'test-provider' } as unknown as RuntimeProvider),
    promptId,
    source,
    estimateSelection,
    open,
    pendingRecoverable,
    pending,
  );
  return collectSelection(enforced);
}
