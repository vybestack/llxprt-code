/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** "15 s", "250 ms" or "now" for a wait in milliseconds. */
export function formatRefusalDelay(ms: number): string {
  if (ms <= 0) return 'now';
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

function terminalText(value: string): string {
  let sanitized = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code < 0x20 || (code >= 0x7f && code <= 0x9f))) {
      sanitized += ' ';
    } else {
      sanitized += character;
    }
  }
  return sanitized.replace(/\s+/g, ' ').trim();
}

function refusalDiagnosticSuffix(input: {
  readonly category?: string | null;
  readonly explanation?: string | null;
}): string {
  const details: string[] = [];
  if (input.category !== undefined && input.category !== null) {
    details.push(`Category: ${terminalText(input.category)}.`);
  }
  if (input.explanation !== undefined && input.explanation !== null) {
    details.push(terminalText(input.explanation));
  }
  return details.length === 0 ? '' : ` ${details.join(' ')}`;
}

export function appendRefusalDiagnostics(
  message: string,
  input: {
    readonly category?: string | null;
    readonly explanation?: string | null;
  },
): string {
  return `${message}${refusalDiagnosticSuffix(input)}`;
}

/** Shown when a refused request is about to be resent. */
export function describeRefusalRetry(input: {
  readonly model: string;
  readonly delayMs: number;
  readonly retryNumber: number;
  readonly retries: number;
  readonly category?: string | null;
  readonly explanation?: string | null;
}): string {
  const wait =
    input.delayMs <= 0 ? 'now' : `in ${formatRefusalDelay(input.delayMs)}`;
  return `Model ${input.model} refused the request; retrying ${wait} (retry ${input.retryNumber} of ${input.retries}).${refusalDiagnosticSuffix(input)}`;
}

/** One review that rewrote context, as the stop summary reports it. */
export interface RewriteSummary {
  readonly reviewer: string;
  readonly messages: number;
}

/** Shown when recovery gives up after at least one retry or rewrite. */
export function describeRefusalStop(input: {
  readonly model: string;
  readonly refusals: number;
  readonly delaysMs: readonly number[];
  readonly rewrites: readonly RewriteSummary[];
  readonly category?: string | null;
  readonly explanation?: string | null;
}): string {
  const retries = input.delaysMs.length;
  const backoff = input.delaysMs.every((ms) => ms <= 0)
    ? 'no wait'
    : `backoff ${input.delaysMs.map(formatRefusalDelay).join(', ')}`;
  const noun = retries === 1 ? 'retry' : 'retries';
  const rewrote = input.rewrites.map(
    (r) => `reviewer ${r.reviewer} rewrote ${r.messages} message(s)`,
  );
  const reviewed =
    rewrote.length === 0
      ? ''
      : `; ${rewrote.join(', then ')} and the model refused again`;
  return `Model ${terminalText(input.model)} refused ${input.refusals} times (${retries} ${noun} with ${backoff}${reviewed}). Stopping.${refusalDiagnosticSuffix(input)}`;
}

/** What one rewritten entry looked like before and after, for the user. */
export interface RewriteChangeSummary {
  readonly kind: string;
  readonly originalText: string;
  readonly newText: string;
}

const PREVIEW_LENGTH = 80;
const PREVIEWED_CHANGES = 3;

function preview(text: string): string {
  const firstLine = text.split('\n', 1)[0];
  return firstLine.length > PREVIEW_LENGTH || text.includes('\n')
    ? `${firstLine.slice(0, PREVIEW_LENGTH)}…`
    : firstLine;
}

/** Shown before the reviewer is called, since a review can take a while. */
export function describeReviewStart(input: {
  readonly model: string;
  readonly refusals: number;
  readonly reviewer: string;
  readonly category?: string | null;
  readonly explanation?: string | null;
}): string {
  return appendRefusalDiagnostics(
    `Model ${input.model} refused ${input.refusals} time(s); asking ${input.reviewer} to review the recent context.`,
    input,
  );
}

/** Shown when a reviewer rewrote context and the request is about to resend. */
export function describeReviewRewrite(input: {
  readonly reviewer: string;
  readonly changes: readonly RewriteChangeSummary[];
  readonly operationId: string;
  readonly category?: string | null;
  readonly explanation?: string | null;
}): string {
  const shown = input.changes.slice(0, PREVIEWED_CHANGES).map((change) =>
    // Tool results can hold credentials and the notice reaches every
    // reader of the task, so only their size is reported.
    change.kind === 'tool_result'
      ? `${change.kind}: ${change.originalText.length} → ${change.newText.length} characters (text omitted)`
      : `${change.kind}: "${preview(change.originalText)}" → "${preview(change.newText)}"`,
  );
  const more = input.changes.length - shown.length;
  const list = more > 0 ? [...shown, `+${more} more`] : shown;
  return appendRefusalDiagnostics(
    `Refusal review by ${input.reviewer}: rewrote ${input.changes.length} message(s) [${list.join('; ')}] (operation ${input.operationId}). Retrying.`,
    input,
  );
}

/** Shown when the rewritten request finally succeeds. */
export function describeRefusalRecovered(reviewer: string): string {
  return `Refusal recovered after rewrite by ${reviewer}.`;
}

/** Shown when a reviewer finds the request genuinely disallowed. */
export function describeReviewDisallowed(input: {
  readonly reviewer: string;
  readonly explanation: string;
}): string {
  return `Refusal review by ${input.reviewer} found the request genuinely disallowed, so nothing was rewritten and the model was not asked again: ${input.explanation}`;
}

export type ReviewStopReason =
  | 'unusable-profile'
  | 'reviewer-refused'
  | 'reviewer-failed'
  | 'invalid-reply'
  | 'context-too-large'
  | 'no-change'
  | 'history-changed'
  | 'commit-failed';

/** Shown when a review ends without a rewrite or a disallowed verdict. */
export function describeReviewStopped(input: {
  readonly reason: ReviewStopReason;
  readonly reviewer: string | undefined;
  readonly detail: string;
}): string {
  const by =
    input.reviewer === undefined
      ? 'The refusal reviewer'
      : `Refusal review by ${input.reviewer}`;
  switch (input.reason) {
    case 'unusable-profile':
      return `${input.detail} Nothing was rewritten. Stopping.`;
    case 'reviewer-refused': {
      const who =
        input.reviewer === undefined
          ? 'The refusal reviewer'
          : `The refusal reviewer ${input.reviewer}`;
      return `${who} itself refused, so nothing was rewritten. Configure a different reviewer with refusal.review-profile (for example: /set refusal.review-profile <profile>). Stopping.`;
    }
    case 'reviewer-failed':
      return `${by} failed (${input.detail}), so nothing was rewritten. Stopping.`;
    case 'invalid-reply':
      return `${by} gave an unusable answer (${input.detail}), so nothing was rewritten. Stopping.`;
    case 'context-too-large':
      return `${by} was not asked: ${input.detail} Nothing was rewritten. Stopping.`;
    case 'no-change':
      return `${by} found nothing to change: ${input.detail} Stopping.`;
    case 'history-changed':
      return `${by} finished after the conversation had changed, so its rewrite was discarded and nothing was rewritten. Stopping.`;
    default:
      return `${by} proposed a rewrite, but it could not be committed (${input.detail}), so nothing was rewritten. Stopping.`;
  }
}
