/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { restoreClientTurns } from './sessionHistoryClear.js';

/**
 * Cuts the last `turns` human-led turns through the streamed row snapshot (the
 * journal attached to the active recording writes the single rewind). The
 * remaining history is returned as a cold stream over the journal, so nothing
 * is materialized.
 */
export async function restoreOwnerTurns(
  turns: number,
  client: AgentClientContract,
  mediaStore: LocalMediaStore,
): Promise<{
  readonly remainingHistory: AsyncIterable<IContent>;
  readonly itemsRemoved: number;
}> {
  const itemsRemoved = await restoreClientTurns(client, mediaStore, turns);
  return {
    remainingHistory: client.getHistory(),
    itemsRemoved,
  };
}
