/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RefusalRewritePayload } from '@vybestack/llxprt-code-core';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RefusalAttempt } from './refusalTypes.js';
import type { ChangedEntry, ReviewerIdentity } from './reviewTypes.js';
import {
  applyReviewRewrites,
  type ReviewRewrite,
  type ReviewWindow,
} from './reviewWindow.js';

export interface RewriteRequest {
  readonly history: HistoryService;
  readonly window: ReviewWindow;
  readonly rewrites: readonly ReviewRewrite[];
  readonly execution: AgentChatRecordingExecution | undefined;
  readonly attempt: RefusalAttempt;
  readonly reviewer: ReviewerIdentity;
  readonly explanation: string;
  readonly operationId: string;
  readonly now: Date;
}

export type RewriteResult =
  | { readonly kind: 'applied'; readonly changes: readonly ChangedEntry[] }
  | { readonly kind: 'history-changed' }
  | { readonly kind: 'commit-failed'; readonly detail: string };

function changedEntries(
  window: ReviewWindow,
  rewrites: readonly ReviewRewrite[],
): ChangedEntry[] {
  return rewrites.flatMap((rewrite) => {
    const entry = window.entries.find(
      (candidate) => candidate.id === rewrite.id,
    );
    return entry === undefined
      ? []
      : [
          {
            id: entry.id,
            role: entry.role,
            kind: entry.kind,
            originalText: entry.text,
            newText: rewrite.newText,
          },
        ];
  });
}

/**
 * Commits a reviewed rewrite as one transaction: the history is replaced, its
 * token total re-estimated, and the `refusal_rewrite` journal record written
 * together. The history must still be exactly the one that was reviewed; if
 * it changed, or if the journal cannot take the record, the history is left as
 * it was and the caller stops.
 */
export async function applyReviewedRewrite(
  request: RewriteRequest,
): Promise<RewriteResult> {
  const changes = changedEntries(request.window, request.rewrites);
  const prepare = request.execution?.prepareRefusalRewrite;
  try {
    const outcome = await request.history.replaceIfUnchanged({
      expected: request.window.snapshot,
      rewrite: () => applyReviewRewrites(request.window, request.rewrites),
      prepareEffect: (resultingHistory) => {
        if (prepare === undefined) return undefined;
        const payload: RefusalRewritePayload = {
          operationId: request.operationId,
          time: request.now.toISOString(),
          promptId: request.attempt.promptId,
          attemptIndex: request.attempt.attemptIndex,
          reviewer: request.reviewer,
          explanation: request.explanation,
          changes,
          resultingHistory,
        };
        return prepare(payload);
      },
    });
    return outcome === 'applied'
      ? { kind: 'applied', changes }
      : { kind: 'history-changed' };
  } catch (error: unknown) {
    return {
      kind: 'commit-failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
