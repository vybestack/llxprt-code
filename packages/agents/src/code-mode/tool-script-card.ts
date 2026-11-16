/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The script card (issue #4084): one bounded text view of a code mode run,
 * built from its `tool_script_event` records. The live card, the final
 * `execute_tool_script` display and the card a resumed session redraws all
 * come from {@link formatToolScriptCard}, so they cannot drift apart. The
 * card never grows with the run: it lists the last few calls, a few source
 * lines and a bounded result excerpt, so a 64-call script stays one screen.
 */

import type {
  ToolScriptCallPayload,
  ToolScriptCallStatus,
  ToolScriptEventPayload,
  ToolScriptFinishedPayload,
} from '@vybestack/llxprt-code-core';

export const CARD_MAX_LISTED_CALLS = 8;
export const CARD_MAX_SOURCE_LINES = 8;
export const CARD_MAX_RESULT_CHARS = 600;
export const CARD_MAX_LINE_CHARS = 160;

/** Folded state of one script run. */
export interface ToolScriptRunView {
  readonly runId: string;
  readonly parentCallId: string;
  readonly agentId: string;
  readonly purpose: string;
  readonly tools: readonly string[];
  readonly calls: readonly ToolScriptCallPayload[];
  readonly finished: ToolScriptFinishedPayload | undefined;
}

/**
 * Applies one record to a run's view. A `call` or `finished` record for a
 * run whose `started` record is missing has nothing to attach to, which only
 * a damaged recording produces; it is reported, not guessed around.
 */
export function applyToolScriptEvent(
  view: ToolScriptRunView | undefined,
  event: ToolScriptEventPayload,
): ToolScriptRunView {
  if (event.phase === 'started')
    return {
      runId: event.runId,
      parentCallId: event.parentCallId,
      agentId: event.agentId,
      purpose: event.purpose,
      tools: [...event.tools],
      calls: [],
      finished: undefined,
    };
  if (view === undefined)
    throw new Error(
      `Script run ${event.runId} has a ${event.phase} record before it started`,
    );
  return event.phase === 'call'
    ? { ...view, calls: [...view.calls, event] }
    : { ...view, finished: event };
}

/**
 * Folds recorded script events into one view per run, in start order. Runs
 * whose `started` record is missing are skipped (the recording lost their
 * start; there is no card to rebuild).
 */
export function foldToolScriptEvents(
  events: readonly ToolScriptEventPayload[],
): ToolScriptRunView[] {
  const runs = new Map<string, ToolScriptRunView>();
  for (const event of events) {
    const current = runs.get(event.runId);
    if (event.phase !== 'started' && current === undefined) continue;
    runs.set(event.runId, applyToolScriptEvent(current, event));
  }
  return [...runs.values()];
}

const STATUS_MARK: Record<ToolScriptCallStatus, string> = {
  ok: '✓',
  failed: '✗',
  denied: '⊘',
  approval_required: '?',
  cancelled: '-',
};

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function statusLine(view: ToolScriptRunView): string {
  const done = view.finished;
  if (done === undefined) return 'Status: running';
  if (done.ok)
    return `Status: completed in ${Math.round(done.durationMs)} ms${done.partial ? ' (partial results)' : ''}`;
  const message =
    done.errorMessage === undefined ? '' : `: ${done.errorMessage}`;
  return clip(
    `Status: failed ${done.errorCode ?? 'UNKNOWN'}${message}`,
    CARD_MAX_LINE_CHARS,
  );
}

function countsLine(view: ToolScriptRunView): string {
  const counts = new Map<ToolScriptCallStatus, number>();
  for (const call of view.calls)
    counts.set(call.status, (counts.get(call.status) ?? 0) + 1);
  const parts = [...counts.entries()].map(
    ([status, count]) => `${count} ${status.replace('_', ' ')}`,
  );
  const total = view.finished?.callCount ?? view.calls.length;
  return `Tool calls: ${total}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
}

function callLines(view: ToolScriptRunView): string[] {
  const listed = view.calls.slice(-CARD_MAX_LISTED_CALLS);
  const hidden = view.calls.length - listed.length;
  return [
    ...(hidden > 0 ? [`  … ${hidden} earlier call(s) not shown`] : []),
    ...listed.map(
      (call) =>
        `  ${clip(
          `${STATUS_MARK[call.status]} ${call.tool} ${call.argsSummary}${call.completeness === 'partial' ? ' [partial]' : ''}`,
          CARD_MAX_LINE_CHARS - 2,
        )}`,
    ),
  ];
}

function sourceLines(source: string): string[] {
  const lines = source.trimEnd().replace(/^\n+/, '').split('\n');
  const shown = lines.slice(0, CARD_MAX_SOURCE_LINES);
  return [
    `Script (${lines.length} line${lines.length === 1 ? '' : 's'}):`,
    ...shown.map((line) => `  ${line.slice(0, CARD_MAX_LINE_CHARS)}`),
    ...(lines.length > shown.length
      ? [`  … ${lines.length - shown.length} more line(s)`]
      : []),
  ];
}

export interface ToolScriptCardContent {
  /** The script source (the `execute_tool_script` call's `source`). */
  readonly source?: string;
  /** The final JSON value, when the script returned one. */
  readonly result?: string;
}

export function formatToolScriptCard(
  view: ToolScriptRunView,
  content: ToolScriptCardContent = {},
): string {
  const lines = [
    clip(`Purpose: ${view.purpose}`, CARD_MAX_LINE_CHARS),
    statusLine(view),
    countsLine(view),
    ...callLines(view),
    ...(content.source === undefined ? [] : sourceLines(content.source)),
    ...(content.result === undefined
      ? []
      : [`Result: ${clip(content.result, CARD_MAX_RESULT_CHARS)}`]),
  ];
  return lines.join('\n');
}
