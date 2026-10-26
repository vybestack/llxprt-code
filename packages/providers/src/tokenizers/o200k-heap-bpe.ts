/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { countBpePiece } from '@vybestack/llxprt-code-core/utils/neutral-long-piece.js';
import { diskAssets } from './o200k-disk-assets.js';

export const MAX_HEAP_PIECE_BYTES = 2 ** 24 - 1;

/** Exact in-memory counting using the shared fixed-depth rank queue. */
export function countPieceInMemory(bytes: Buffer): number {
  if (bytes.length > MAX_HEAP_PIECE_BYTES)
    throw new RangeError(
      `Heap BPE piece of ${bytes.length} bytes is too large`,
    );
  return countBpePiece(bytes, diskAssets().ranks);
}
