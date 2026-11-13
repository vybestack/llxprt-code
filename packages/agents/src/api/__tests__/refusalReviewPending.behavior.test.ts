/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 review round 1 (H2): the request that was refused carries a
 * pending user turn (a new prompt, or the results of the tools the model just
 * ran) that is committed only after the model answers. The reviewer must see
 * that turn, and a rewrite of a pending tool result must be what the model is
 * asked again and what finally enters the history.
 *
 * Every test drives the PUBLIC `agent.stream()` over the real OpenAI provider
 * and local endpoints; the model reads a real file through the real read tool.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { join } from 'node:path';
import { isDoneEvent } from './helpers/agentHarness.js';
import {
  emptyRefusalReply,
  stopReply,
  toolCallReply,
  type EndpointReply,
  type WireRequest,
} from './helpers/refusal-endpoint.js';
import {
  ORIGINAL_PHRASE,
  REWRITTEN_PHRASE,
  reviewData,
  runReviewScenario,
  verdictReply,
  wireIncludes,
  type ReviewRun,
  type ReviewScenario,
} from './helpers/refusal-review-harness.js';

// Each case runs a whole agent, two local endpoints and a journal replay.
setDefaultTimeout(90_000);

const PROFILE = {
  name: 'mesh-reviewer',
  setting: 'refusal.review-profile',
} as const;

const GOAL = 'summarise the mesh notes in notes/mesh.txt';
const NOTES = `Plan: ${ORIGINAL_PHRASE} in src/mesh/fit.ts (42 of 50 done).`;

function doneReasons(run: ReviewRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

function lastOf<T>(items: readonly T[]): T {
  return items[items.length - 1];
}

function journal(run: ReviewRun, type: string): Array<Record<string, unknown>> {
  return run.journalRecords.filter((record) => record['type'] === type);
}

function historyText(
  history: ReadonlyArray<{ blocks: readonly unknown[] }>,
): string {
  return JSON.stringify(history);
}

describe('a refused first prompt (issue #4036)', () => {
  const firstPrompt = (): Promise<ReviewRun> =>
    runReviewScenario({ profile: PROFILE, prompt: GOAL });

  it('shows the reviewer the user goal', async () => {
    const run = await firstPrompt();

    expect(reviewData(run.reviews[0])?.latestUserGoal).toBe(GOAL);
  });

  it('shows the user prompt as an entry the reviewer may not edit', async () => {
    const run = await firstPrompt();

    const entries = reviewData(run.reviews[0])?.entries ?? [];
    expect(
      entries
        .filter((entry) => entry.kind === 'user')
        .map(({ editable, text }) => ({ editable, text })),
    ).toStrictEqual([{ editable: false, text: GOAL }]);
  });
});

/** The model reads the notes file, then the answer to its content is refused. */
function readNotesThenRefuse(): NonNullable<ReviewScenario['foreground']> {
  let requests = 0;
  return (request: WireRequest, env): EndpointReply => {
    requests += 1;
    if (requests === 1) {
      return toolCallReply('read_file', {
        absolute_path: join(env.workingDir, 'notes/mesh.txt'),
      });
    }
    return wireIncludes(request, ORIGINAL_PHRASE)
      ? emptyRefusalReply()
      : stopReply('the notes are summarised');
  };
}

/** The reviewer rewrites the pending tool result and nothing else. */
function rewriteToolResult(request: WireRequest): EndpointReply {
  const entry = (reviewData(request)?.entries ?? []).find(
    (candidate) => candidate.kind === 'tool_result' && candidate.editable,
  );
  return verdictReply({
    verdict: 'rewrite',
    explanation: 'Plain wording for the tool output.',
    rewrites:
      entry === undefined
        ? []
        : [
            {
              id: entry.id,
              newText: entry.text.replace(ORIGINAL_PHRASE, REWRITTEN_PHRASE),
            },
          ],
  });
}

describe('a refused tool continuation (issue #4036)', () => {
  const continuation = (): Promise<ReviewRun> =>
    runReviewScenario({
      profile: PROFILE,
      prompt: GOAL,
      history: [],
      files: { 'notes/mesh.txt': NOTES },
      foreground: readNotesThenRefuse(),
      reviewer: rewriteToolResult,
    });

  it('shows the reviewer the pending tool result as an editable entry', async () => {
    const run = await continuation();

    const entries = reviewData(run.reviews[0])?.entries ?? [];
    expect(
      entries
        .filter((entry) => entry.kind === 'tool_result')
        .map(({ editable, text }) => ({
          editable,
          mentionsPhrase: text.includes(ORIGINAL_PHRASE),
        })),
    ).toStrictEqual([{ editable: true, mentionsPhrase: true }]);
  });

  it('asks the model again with the rewritten tool result and not the original', async () => {
    const run = await continuation();

    const resent = lastOf(run.foreground);
    expect({
      rewritten: wireIncludes(resent, REWRITTEN_PHRASE),
      original: wireIncludes(resent, ORIGINAL_PHRASE),
      reasons: doneReasons(run),
    }).toStrictEqual({ rewritten: true, original: false, reasons: ['stop'] });
  });

  it('keeps the rewritten tool result, not the original, in the history', async () => {
    const run = await continuation();

    const text = historyText(run.historyAfter);
    expect({
      rewritten: text.includes(REWRITTEN_PHRASE),
      original: text.includes(ORIGINAL_PHRASE),
    }).toStrictEqual({ rewritten: true, original: false });
  });

  it('journals the original tool result in the rewrite record', async () => {
    const run = await continuation();

    const record = journal(run, 'refusal_rewrite').find(
      (_, position) => position === 0,
    );
    const changes = (
      record?.['payload'] as {
        changes: Array<{ kind: string; originalText: string; newText: string }>;
      }
    ).changes;
    expect(
      changes.map(({ kind, originalText, newText }) => ({
        kind,
        original: originalText.includes(ORIGINAL_PHRASE),
        rewritten: newText.includes(REWRITTEN_PHRASE),
      })),
    ).toStrictEqual([{ kind: 'tool_result', original: true, rewritten: true }]);
  });

  it('restores the rewritten tool result when the session is resumed', async () => {
    const run = await continuation();

    const text = historyText(run.replayed);
    expect({
      rewritten: text.includes(REWRITTEN_PHRASE),
      original: text.includes(ORIGINAL_PHRASE),
    }).toStrictEqual({ rewritten: true, original: false });
  });
});
