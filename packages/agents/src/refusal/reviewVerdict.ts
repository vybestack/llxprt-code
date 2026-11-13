/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { findDroppedLiterals } from './protectedLiterals.js';
import type { ReviewRewrite, ReviewWindow } from './reviewWindow.js';

/**
 * The only shape a reviewer may answer with (issue #4036). Unknown keys are an
 * error: a reply that does not match the contract is not partially trusted.
 */
const ReviewReplySchema = z
  .object({
    verdict: z.enum(['disallowed', 'rewrite', 'no_change']),
    explanation: z.string().trim().min(1),
    rewrites: z
      .array(z.object({ id: z.string().min(1), newText: z.string() }).strict())
      .default([]),
  })
  .strict();

export type ReviewDecision =
  | { readonly kind: 'disallowed'; readonly explanation: string }
  | { readonly kind: 'no_change'; readonly explanation: string }
  | {
      readonly kind: 'rewrite';
      readonly explanation: string;
      readonly rewrites: readonly ReviewRewrite[];
    };

export type ParsedReview =
  | { readonly ok: true; readonly decision: ReviewDecision }
  | { readonly ok: false; readonly reason: string };

const FENCED_JSON = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/;

function unwrapFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = FENCED_JSON.exec(trimmed);
  return fenced === null ? trimmed : fenced[1];
}

function rejected(reason: string): ParsedReview {
  return { ok: false, reason };
}

const DECLINED_TO_REWRITE = 'reviewer declined to rewrite';
const INSUFFICIENT_CONTEXT_PREFIX = 'insufficient_context:';

/**
 * The prompt reserves `no_change` for a window too thin to judge or one with
 * nothing editable. Anything else is a reviewer that would not do the task.
 */
function declinesWithoutReason(
  explanation: string,
  window: ReviewWindow,
): boolean {
  return (
    window.entries.some((entry) => entry.editable) &&
    !explanation.startsWith(INSUFFICIENT_CONTEXT_PREFIX)
  );
}

function checkRewrite(
  rewrite: ReviewRewrite,
  window: ReviewWindow,
): string | undefined {
  const entry = window.entries.find((candidate) => candidate.id === rewrite.id);
  if (entry === undefined) return `unknown entry id ${rewrite.id}`;
  if (!entry.editable) return `entry ${rewrite.id} is not editable`;
  if (rewrite.newText.trim() === '') {
    return `the replacement for ${rewrite.id} is empty`;
  }
  if (rewrite.newText === entry.text) {
    return `the edit of ${rewrite.id} changes nothing`;
  }
  const dropped = findDroppedLiterals(entry.text, rewrite.newText);
  if (dropped.length > 0) {
    return `the replacement for ${rewrite.id} drops ${dropped.join(', ')}`;
  }
  return undefined;
}

function checkRewrites(
  rewrites: readonly ReviewRewrite[],
  window: ReviewWindow,
): string | undefined {
  if (rewrites.length === 0) {
    return 'the rewrite verdict needs at least one rewrite';
  }
  const seen = new Set<string>();
  for (const rewrite of rewrites) {
    if (seen.has(rewrite.id)) {
      return `entry ${rewrite.id} is rewritten more than once`;
    }
    seen.add(rewrite.id);
  }
  for (const rewrite of rewrites) {
    const problem = checkRewrite(rewrite, window);
    if (problem !== undefined) return problem;
  }
  return undefined;
}

/**
 * Validates a reviewer's reply against the contract and the window it was
 * asked about. A single fenced json block around the object is tolerated;
 * nothing else is. Any failure rejects the whole reply, so no partial rewrite
 * can reach the history.
 */
export function parseReviewReply(
  raw: string,
  window: ReviewWindow,
): ParsedReview {
  let json: unknown;
  try {
    json = JSON.parse(unwrapFence(raw));
  } catch {
    return rejected('the reviewer reply was not valid JSON');
  }
  const parsed = ReviewReplySchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return rejected(
      `the reviewer reply broke the contract (${where}${issue.message})`,
    );
  }
  const { verdict, explanation, rewrites } = parsed.data;
  if (verdict !== 'rewrite') {
    if (rewrites.length > 0) {
      return rejected('rewrites are only allowed with the rewrite verdict');
    }
    if (verdict === 'no_change' && declinesWithoutReason(explanation, window)) {
      return rejected(DECLINED_TO_REWRITE);
    }
    return { ok: true, decision: { kind: verdict, explanation } };
  }
  const problem = checkRewrites(rewrites, window);
  if (problem !== undefined) return rejected(problem);
  return { ok: true, decision: { kind: 'rewrite', explanation, rewrites } };
}
