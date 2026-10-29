/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Build a normalized projection key for an IContent that is stable across the
 * hook translator round-trip. The hook translator produces text-only IContents
 * with fresh IDs and no metadata, so we compare by speaker + block shape:
 * text blocks contribute {type:'text', text}; non-text blocks contribute
 * their full shape (volatile id/callId mismatches on non-text blocks correctly
 * yield a mismatch, which is the desired unrecoverable outcome).
 *
 * NON-TEXT BLOCK STRUCTURAL COMPARISON: non-text blocks (tool_call,
 * tool_response, etc.) are compared structurally INCLUDING ids (e.g.,
 * tool_call id / tool_response callId). This is deliberately conservative:
 * hook translator round-trips that regenerate tool-call ids will make the
 * comparison fail and force unrecoverable rather than risk misattribution of
 * a tool call to the wrong response.
 *
 * COLLISION TOLERANCE: this projection deliberately ignores ids/metadata, so
 * duplicate same-speaker/same-text messages can collide (e.g. two identical
 * user messages produce the same key). Collisions WITHIN one side of the
 * boundary (both in history, or both in pending) are tolerated — the
 * recovered slice is always taken from the hook-modified array POSITIONS
 * (modifiedContents.slice(...)), so any collision yields content identical
 * under projection with no data loss. Collisions ACROSS the boundary (one key
 * in the history prefix AND one in the pending suffix) are AMBIGUOUS when the
 * hook modified the contents: a surviving duplicate cannot be reliably
 * attributed to the correct side. In that case recovery is conservatively
 * marked unrecoverable (see hasBoundaryStraddlingDuplicate in
 * recoverPendingBoundary).
 *
 * The disk-backed boundary snapshot stores these keys per row so differential
 * recovery can compare the pre-hook and hook-modified requests.
 *
 * ACCEPTED LIMITATION: boundary recovery is based on the provider-visible
 * projection (speaker + block content). Metadata-only changes (e.g. a hook
 * that mutates only an item's metadata/providerMetadata in place) do NOT
 * affect the projection key, so such an item is treated as "unmodified".
 * Consequently the caller pending is used, and if compression runs the
 * metadata mutation is superseded by recomposition (which rebuilds from
 * HistoryService). This is accepted because the projection exists to survive
 * the hook translator round-trip, which itself strips ids/metadata.
 */
export function contentProjectionKey(content: IContent): string {
  const blocks = content.blocks.map((block) => {
    if (block.type === 'text') {
      return { type: 'text' as const, text: block.text };
    }
    return block;
  });
  return JSON.stringify({ speaker: content.speaker, blocks });
}
