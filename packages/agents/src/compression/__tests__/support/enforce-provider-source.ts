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
export async function enforceProviderSourceForTest(
  handler: CompressionHandler,
  history: HistoryService,
  pendingContents: IContent[],
  promptId: string,
  provider: RuntimeProvider | undefined,
  estimateRows: (rows: IContent[]) => Promise<number> = (rows) =>
    history.estimateTokensForContents(rows),
): Promise<IContent[]> {
  let pendingRows = pendingContents;
  const open = async (): Promise<PendingAwareRequestSelection> => {
    const snapshot =
      await history.prepareCuratedForProviderSnapshot(pendingRows);
    return pendingAwareRequestSelection(
      snapshot,
      sourcePendingMembership(snapshot),
    );
  };
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
    async (candidate) => estimateRows(await collectSelection(candidate)),
    open,
    true,
    pending,
  );
  return collectSelection(enforced);
}
