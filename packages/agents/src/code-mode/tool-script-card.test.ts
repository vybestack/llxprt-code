/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The script card stays one bounded screen however large the run (issue
 * #4084): a 64-call script with a long source and a large result renders a
 * fixed number of lines, and folding recorded events gives each run its own
 * view in start order.
 */

import { describe, expect, it } from 'bun:test';
import type { ToolScriptEventPayload } from '@vybestack/llxprt-code-core';
import {
  CARD_MAX_LINE_CHARS,
  CARD_MAX_LISTED_CALLS,
  CARD_MAX_RESULT_CHARS,
  CARD_MAX_SOURCE_LINES,
  foldToolScriptEvents,
  formatToolScriptCard,
} from './tool-script-card.js';

const time = '2026-11-13T00:00:00.000Z';

function started(runId: string, purpose: string): ToolScriptEventPayload {
  return {
    phase: 'started',
    runId,
    parentCallId: `parent-${runId}`,
    time,
    agentId: 'primary',
    purpose,
    tools: ['read_file'],
  };
}

function call(
  runId: string,
  sequence: number,
  status: 'ok' | 'failed' = 'ok',
): ToolScriptEventPayload {
  return {
    phase: 'call',
    runId,
    parentCallId: `parent-${runId}`,
    time,
    sequence,
    callId: `parent-${runId}#script-${sequence}`,
    tool: 'read_file',
    argsSummary: JSON.stringify({ absolute_path: `/repo/file-${sequence}.ts` }),
    approval: 'not_required',
    status,
    ...(status === 'ok' ? { completeness: 'complete' as const } : {}),
    resultBytes: 100,
  };
}

function finished(runId: string, callCount: number): ToolScriptEventPayload {
  return {
    phase: 'finished',
    runId,
    parentCallId: `parent-${runId}`,
    time,
    ok: true,
    callCount,
    partial: false,
    inputBytes: callCount * 100,
    finalBytes: 2,
    durationMs: 1234,
  };
}

describe('formatToolScriptCard', () => {
  it('keeps a 64-call run with a long source and a large result to a fixed number of lines', () => {
    const events = [
      started('r1', 'scan every file'),
      ...Array.from({ length: 64 }, (_, index) =>
        call('r1', index + 1, index === 10 ? 'failed' : 'ok'),
      ),
      finished('r1', 64),
    ];
    const [view] = foldToolScriptEvents(events);
    const source = Array.from(
      { length: 200 },
      (_, index) => `const line${index} = ${index};`,
    ).join('\n');
    const card = formatToolScriptCard(view, {
      source,
      result: JSON.stringify({ rows: 'x'.repeat(10_000) }),
    });
    const lines = card.split('\n');

    // purpose, status, counts, hidden-calls marker, listed calls, script
    // header, source lines, more-lines marker, result
    expect(lines).toHaveLength(
      3 + 1 + CARD_MAX_LISTED_CALLS + 1 + CARD_MAX_SOURCE_LINES + 1 + 1,
    );
    expect(
      lines.every((line) => line.length <= CARD_MAX_RESULT_CHARS + 8),
    ).toBe(true);
    expect(lines[0]).toBe('Purpose: scan every file');
    expect(lines[1]).toBe('Status: completed in 1234 ms');
    expect(lines[2]).toBe('Tool calls: 64 (63 ok, 1 failed)');
    expect(lines[3]).toBe(
      `  … ${64 - CARD_MAX_LISTED_CALLS} earlier call(s) not shown`,
    );
    expect(lines[4]).toBe(
      `  ✓ read_file {"absolute_path":"/repo/file-${64 - CARD_MAX_LISTED_CALLS + 1}.ts"}`,
    );
    expect(card).toContain('Script (200 lines):');
    expect(card).toContain(`  … ${200 - CARD_MAX_SOURCE_LINES} more line(s)`);
    const last = lines[lines.length - 1];
    expect(last.startsWith('Result: {"rows":"xxx')).toBe(true);
    expect(last.endsWith('…')).toBe(true);
  });

  it('shows a running run without a result and a failed run with its named code', () => {
    const [running] = foldToolScriptEvents([
      started('r1', 'probe'),
      call('r1', 1),
    ]);
    expect(formatToolScriptCard(running)).toBe(
      [
        'Purpose: probe',
        'Status: running',
        'Tool calls: 1 (1 ok)',
        '  ✓ read_file {"absolute_path":"/repo/file-1.ts"}',
      ].join('\n'),
    );

    const [failedRun] = foldToolScriptEvents([
      started('r2', 'probe'),
      {
        phase: 'finished',
        runId: 'r2',
        parentCallId: 'parent-r2',
        time,
        ok: false,
        errorCode: 'APPROVAL_REQUIRED',
        errorMessage: 'needs approval '.repeat(40),
        callCount: 1,
        partial: false,
        inputBytes: 0,
        finalBytes: 0,
        durationMs: 3,
      },
    ]);
    const status = formatToolScriptCard(failedRun).split('\n')[1];
    expect(status.startsWith('Status: failed APPROVAL_REQUIRED: needs')).toBe(
      true,
    );
    expect(status.length).toBeLessThanOrEqual(CARD_MAX_LINE_CHARS);
  });
});

describe('foldToolScriptEvents', () => {
  it('gives each run its own view in start order, even when their records interleave', () => {
    const views = foldToolScriptEvents([
      started('a', 'first'),
      started('b', 'second'),
      call('b', 1),
      call('a', 1),
      call('a', 2),
      finished('b', 1),
      finished('a', 2),
    ]);
    expect(
      views.map((view) => ({
        purpose: view.purpose,
        calls: view.calls.length,
        done: view.finished?.callCount,
      })),
    ).toStrictEqual([
      { purpose: 'first', calls: 2, done: 2 },
      { purpose: 'second', calls: 1, done: 1 },
    ]);
  });

  it('skips records of a run whose start was not recorded', () => {
    expect(
      foldToolScriptEvents([call('lost', 1), finished('lost', 1)]),
    ).toStrictEqual([]);
  });
});
