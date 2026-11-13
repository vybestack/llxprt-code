/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 phase 3: when identical retries do not help, a reviewer model
 * checks the context the refused request carries and rewrites it in plain
 * wording, or says it is genuinely disallowed. Every test drives the PUBLIC
 * `agent.stream()` over the real OpenAI provider; the foreground model, the
 * reviewer and the journal are observed through local endpoints and the
 * session file.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { isDoneEvent, isNoticeEvent } from './helpers/agentHarness.js';
import {
  ORIGINAL_PHRASE,
  REVIEWER_MODEL,
  REWRITTEN_PHRASE,
  SUMMARY_ORIGINAL,
  SUMMARY_REWRITTEN,
  reviewEntries,
  runReviewScenario,
  seedHistory,
  summaryRewriteReply,
  verdictReply,
  wireIncludes,
  type ReviewRun,
  type ReviewScenario,
} from './helpers/refusal-review-harness.js';
import {
  emptyRefusalReply,
  httpErrorReply,
  stopReply,
  turnRecords,
} from './helpers/refusal-endpoint.js';

// Each case runs a whole agent, two local endpoints and a journal replay.
setDefaultTimeout(90_000);

const PROFILE = {
  name: 'mesh-reviewer',
  setting: 'refusal.review-profile',
} as const;

function doneReasons(run: ReviewRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

function notices(run: ReviewRun): string[] {
  return run.events.filter(isNoticeEvent).map((notice) => notice.message);
}

function journal(run: ReviewRun, type: string): Array<Record<string, unknown>> {
  return run.journalRecords.filter((record) => record['type'] === type);
}

interface JournalPayload {
  readonly action: string;
  readonly operationId: string;
  readonly promptId: string;
  readonly attemptIndex: number;
  readonly reviewer: { profile?: string; provider: string; model: string };
  readonly changes: ReadonlyArray<{
    kind: string;
    originalText: string;
    newText: string;
  }>;
  readonly resultingHistory: readonly unknown[];
}

function payloadOf(
  record: Record<string, unknown> | undefined,
): JournalPayload {
  return record?.['payload'] as JournalPayload;
}

/** The 80-character first-line preview the rewrite notice shows. */
function preview(text: string): string {
  return `${text.slice(0, 80)}…`;
}

function historyText(
  history: ReadonlyArray<{ blocks: readonly unknown[] }>,
): string {
  return JSON.stringify(history);
}

describe('a refusal that a reviewer rewrite recovers (issue #4036)', () => {
  const recovered = (): Promise<ReviewRun> =>
    runReviewScenario({ profile: PROFILE });

  it('retries once, then asks the configured reviewer exactly once', async () => {
    const run = await recovered();

    expect({
      foregroundRequests: run.foreground.length,
      reviewerRequests: run.profileEndpoint.length,
      reviewedOn: run.reviews.map((r) => r.model),
      waits: run.waits,
    }).toStrictEqual({
      foregroundRequests: 3,
      reviewerRequests: 1,
      reviewedOn: [REVIEWER_MODEL],
      waits: [1, 0],
    });
  });

  it('shows the reviewer the summary as an editable entry and the refusal evidence', async () => {
    const run = await recovered();

    const entries = reviewEntries(run.reviews[0]);
    expect(
      entries.map(({ kind, editable, text }) => ({ kind, editable, text })),
    ).toContainEqual({
      kind: 'summary',
      editable: true,
      text: SUMMARY_ORIGINAL,
    });
    expect(wireIncludes(run.reviews[0], 'scripted-model')).toBe(true);
  });

  it('sends the rewritten summary, and not the original, in the next foreground request', async () => {
    const run = await recovered();

    const last = run.foreground[run.foreground.length - 1];
    expect({
      rewritten: wireIncludes(last, REWRITTEN_PHRASE),
      original: wireIncludes(last, ORIGINAL_PHRASE),
    }).toStrictEqual({ rewritten: true, original: false });
  });

  it('keeps the foreground session on its own model and endpoint', async () => {
    const run = await recovered();

    expect({
      foregroundModels: [...new Set(run.foreground.map((r) => r.model))],
      reviewerModels: [...new Set(run.profileEndpoint.map((r) => r.model))],
    }).toStrictEqual({
      foregroundModels: ['scripted-model'],
      reviewerModels: [REVIEWER_MODEL],
    });
  });

  it('ends once with done stop after the rewritten request is answered', async () => {
    const run = await recovered();

    expect(doneReasons(run)).toStrictEqual(['stop']);
  });

  it('tells the user who rewrote what, then that the request recovered', async () => {
    const run = await recovered();
    const operationId = payloadOf(
      journal(run, 'refusal_rewrite')[0],
    ).operationId;

    expect(notices(run)).toStrictEqual([
      'Model scripted-model refused the request; retrying in 1 ms (retry 1 of 1).',
      `Model scripted-model refused 2 time(s); asking ${REVIEWER_MODEL} to review the recent context.`,
      `Refusal review by ${REVIEWER_MODEL}: rewrote 1 message(s) [summary: "${preview(SUMMARY_ORIGINAL)}" → "${preview(SUMMARY_REWRITTEN)}"] (operation ${operationId}). Retrying.`,
      `Refusal recovered after rewrite by ${REVIEWER_MODEL}.`,
    ]);
  });

  it('journals the review and a rewrite record that keeps the original text', async () => {
    const run = await recovered();

    const rewrite = payloadOf(journal(run, 'refusal_rewrite')[0]);
    expect({
      actions: journal(run, 'refusal').map((r) => payloadOf(r).action),
      reviewer: rewrite.reviewer,
      parent: [rewrite.promptId.length > 0, rewrite.attemptIndex],
      change: {
        kind: rewrite.changes[0].kind,
        originalText: rewrite.changes[0].originalText,
        newText: rewrite.changes[0].newText,
      },
    }).toStrictEqual({
      actions: ['retry', 'review', 'retry'],
      reviewer: {
        profile: PROFILE.name,
        provider: 'openai',
        model: REVIEWER_MODEL,
      },
      parent: [true, 1],
      change: {
        kind: 'summary',
        originalText: SUMMARY_ORIGINAL,
        newText: SUMMARY_REWRITTEN,
      },
    });
  });

  it('holds the rewritten history, not the original, in the live conversation', async () => {
    const run = await recovered();

    const text = historyText(run.historyAfter);
    expect({
      rewritten: text.includes(SUMMARY_REWRITTEN),
      original: text.includes(ORIGINAL_PHRASE),
    }).toStrictEqual({ rewritten: true, original: false });
  });

  it('restores the rewritten history when the session is resumed from its journal', async () => {
    const run = await recovered();

    const resumed = historyText(run.replayed);
    expect({
      rewritten: resumed.includes(SUMMARY_REWRITTEN),
      original: resumed.includes(ORIGINAL_PHRASE),
      answer: resumed.includes('recovered answer'),
    }).toStrictEqual({ rewritten: true, original: false, answer: true });
  });

  it('writes the original text again only inside the rewrite record', async () => {
    const run = await recovered();

    const at = run.journalRecords.findIndex(
      (r) => r['type'] === 'refusal_rewrite',
    );
    const rewrite = payloadOf(run.journalRecords[at]);
    const later = run.journalRecords
      .slice(at + 1)
      .filter((record) => JSON.stringify(record).includes(ORIGINAL_PHRASE));
    expect({
      inChanges: rewrite.changes[0].originalText.includes(ORIGINAL_PHRASE),
      inResultingHistory: JSON.stringify(rewrite.resultingHistory).includes(
        ORIGINAL_PHRASE,
      ),
      laterRecords: later.length,
    }).toStrictEqual({
      inChanges: true,
      inResultingHistory: false,
      laterRecords: 0,
    });
  });

  it('logs the reviewer call under its own purpose and does not count it as a refusal', async () => {
    const run = await recovered();

    const review = run.tokenRecords.filter(
      (r) => r['record_type'] === 'refusal_review',
    );
    expect({
      review: review.map((r) => ({
        purpose: r['purpose'],
        provider: r['provider'],
        model: r['model'],
        verdict: r['verdict'],
      })),
      foregroundOutcomes: turnRecords(run.tokenRecords).map(
        (r) => r['attempt_outcome'],
      ),
      statRefusals: run.stats.apiRefusals,
    }).toStrictEqual({
      review: [
        {
          purpose: 'refusal-review',
          provider: 'openai',
          model: REVIEWER_MODEL,
          verdict: 'rewrite',
        },
      ],
      foregroundOutcomes: ['refusal', 'refusal', 'success'],
      statRefusals: 2,
    });
  });
});

describe('a reviewer that finds the request genuinely disallowed (issue #4036)', () => {
  const disallowed = (): Promise<ReviewRun> =>
    runReviewScenario({
      profile: PROFILE,
      reviewer: () =>
        verdictReply({
          verdict: 'disallowed',
          explanation: 'The summary asks for a working credential stealer.',
          rewrites: [],
        }),
    });

  it('rewrites nothing and never calls the refused model again', async () => {
    const run = await disallowed();

    expect({
      foregroundRequests: run.foreground.length,
      rewrites: journal(run, 'refusal_rewrite').length,
      stillOriginal: historyText(run.historyAfter).includes(ORIGINAL_PHRASE),
    }).toStrictEqual({
      foregroundRequests: 2,
      rewrites: 0,
      stillOriginal: true,
    });
  });

  it('shows the reviewer explanation and ends with done refusal', async () => {
    const run = await disallowed();

    expect({
      reasons: doneReasons(run),
      explained: notices(run).some((n) =>
        n.includes('The summary asks for a working credential stealer.'),
      ),
    }).toStrictEqual({ reasons: ['refusal'], explained: true });
  });
});

describe('a reviewer that finds nothing to change (issue #4036)', () => {
  it('stops with its explanation when the context is insufficient', async () => {
    const run = await runReviewScenario({
      profile: PROFILE,
      reviewer: () =>
        verdictReply({
          verdict: 'no_change',
          explanation: 'insufficient_context: the window holds only a summary.',
          rewrites: [],
        }),
    });

    expect({
      foregroundRequests: run.foreground.length,
      rewrites: journal(run, 'refusal_rewrite').length,
      reasons: doneReasons(run),
      explained: notices(run).some((n) =>
        n.includes('insufficient_context: the window holds only a summary.'),
      ),
    }).toStrictEqual({
      foregroundRequests: 2,
      rewrites: 0,
      reasons: ['refusal'],
      explained: true,
    });
  });
});

describe('a request cancelled while the reviewer works (issue #4036)', () => {
  it('ends as aborted, rewrites nothing and sends nothing more', async () => {
    const run = await runReviewScenario({
      profile: PROFILE,
      abortDuringReview: true,
    });

    expect({
      reasons: doneReasons(run),
      foregroundRequests: run.foreground.length,
      rewrites: journal(run, 'refusal_rewrite').length,
    }).toStrictEqual({
      reasons: ['aborted'],
      foregroundRequests: 2,
      rewrites: 0,
    });
  });
});

describe('a rewrite that is refused again (issue #4036)', () => {
  const stubborn = (): Promise<ReviewRun> =>
    runReviewScenario({
      profile: PROFILE,
      foreground: () => emptyRefusalReply(),
    });

  it('reviews once, retries the rewritten request once, and stops', async () => {
    const run = await stubborn();

    expect({
      foregroundRequests: run.foreground.length,
      reviews: run.reviews.length,
      reasons: doneReasons(run),
    }).toStrictEqual({
      foregroundRequests: 4,
      reviews: 1,
      reasons: ['refusal'],
    });
  });

  it('summarizes everything that was tried', async () => {
    const run = await stubborn();

    const stop = notices(run).filter((n) => n.endsWith('Stopping.'));
    expect(stop).toStrictEqual([
      `Model scripted-model refused 4 times (2 retries with backoff 1 ms, 1 ms; reviewer ${REVIEWER_MODEL} rewrote 1 message(s) and the model refused again). Stopping.`,
    ]);
  });
});

describe('a reviewer on the session model', () => {
  it('is used when no review or compression profile is configured', async () => {
    const run = await runReviewScenario({});

    expect({
      reviewedOn: run.reviews.map((r) => r.model),
      reviewsOnForeground: run.foregroundEndpoint.filter((r) =>
        wireIncludes(r, 'session_data'),
      ).length,
      recovered: doneReasons(run),
    }).toStrictEqual({
      reviewedOn: ['scripted-model'],
      reviewsOnForeground: 1,
      recovered: ['stop'],
    });
  });

  it('names the session model as the reviewer in the rewrite notice', async () => {
    const run = await runReviewScenario({});

    expect(
      notices(run).some((n) =>
        n.startsWith('Refusal review by scripted-model: rewrote 1 message(s)'),
      ),
    ).toBe(true);
  });
});

describe('review profile selection', () => {
  it('falls back to compression.profile when refusal.review-profile is unset', async () => {
    const run = await runReviewScenario({
      profile: { name: 'compress-profile', setting: 'compression.profile' },
    });

    expect({
      onProfileEndpoint: run.profileEndpoint.length,
      onForeground: run.foregroundEndpoint.filter((r) =>
        wireIncludes(r, 'session_data'),
      ).length,
      model: run.reviews[0]?.model,
    }).toStrictEqual({
      onProfileEndpoint: 1,
      onForeground: 0,
      model: REVIEWER_MODEL,
    });
  });

  it('prefers refusal.review-profile over compression.profile', async () => {
    const run = await runReviewScenario({
      profile: PROFILE,
      settings: { 'compression.profile': 'unrelated-profile-name' },
    });

    expect({
      onProfileEndpoint: run.profileEndpoint.length,
      recovered: doneReasons(run),
    }).toStrictEqual({ onProfileEndpoint: 1, recovered: ['stop'] });
  });

  it('stops with an actionable message for an unknown explicit profile', async () => {
    const run = await runReviewScenario({
      settings: { 'refusal.review-profile': 'no-such-profile' },
    });

    const message = notices(run).find((n) => n.includes('no-such-profile'));
    expect({
      reviews: run.reviews.length,
      foregroundRequests: run.foreground.length,
      reasons: doneReasons(run),
      actionable:
        message?.includes('refusal.review-profile') === true &&
        message.includes('profile list'),
    }).toStrictEqual({
      reviews: 0,
      foregroundRequests: 2,
      reasons: ['refusal'],
      actionable: true,
    });
  });
});

describe('reviewer replies that must not change the history (issue #4036)', () => {
  const broken = (
    reviewer: NonNullable<ReviewScenario['reviewer']>,
    history?: ReviewScenario['history'],
  ): Promise<ReviewRun> =>
    runReviewScenario({ profile: PROFILE, reviewer, history });

  /** What a stop without a rewrite leaves behind, with the user's explanation. */
  function stoppedWithout(run: ReviewRun, explanation: string) {
    return {
      foregroundRequests: run.foreground.length,
      rewrites: journal(run, 'refusal_rewrite').length,
      stillOriginal: historyText(run.historyAfter).includes(ORIGINAL_PHRASE),
      reasons: doneReasons(run),
      explained: notices(run).some((n) => n.includes(explanation)),
    };
  }

  const NO_REWRITE = {
    foregroundRequests: 2,
    rewrites: 0,
    stillOriginal: true,
    reasons: ['refusal'],
    explained: true,
  };

  it('stops on malformed JSON', async () => {
    const run = await broken(() => stopReply('{"verdict": "rewri'));

    expect(stoppedWithout(run, 'not valid JSON')).toStrictEqual(NO_REWRITE);
  });

  it('stops on an id the window does not contain', async () => {
    const run = await broken(() =>
      verdictReply({
        verdict: 'rewrite',
        explanation: 'x',
        rewrites: [{ id: 'c999.0', newText: SUMMARY_REWRITTEN }],
      }),
    );

    expect(stoppedWithout(run, 'unknown entry id c999.0')).toStrictEqual(
      NO_REWRITE,
    );
  });

  it('stops when the edit targets a message it may not edit', async () => {
    const run = await broken(
      (request) => {
        const user = reviewEntries(request).find((e) => e.kind === 'user');
        return verdictReply({
          verdict: 'rewrite',
          explanation: 'x',
          rewrites: [{ id: user?.id ?? 'none', newText: 'A different goal.' }],
        });
      },
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'my own goal: fit the mesh' }],
        },
        ...seedHistory(SUMMARY_ORIGINAL),
      ],
    );

    expect(stoppedWithout(run, 'is not editable')).toStrictEqual(NO_REWRITE);
  });

  it('stops when the rewrite drops a path or number', async () => {
    const run = await broken((request) =>
      summaryRewriteReply(
        request,
        `State snapshot: the agent will ${REWRITTEN_PHRASE} in the fitting module and terminates some surviving mutants.`,
      ),
    );

    expect(stoppedWithout(run, 'drops')).toStrictEqual(NO_REWRITE);
  });

  it('stops when the reviewer is itself refused and recommends another review profile', async () => {
    const run = await broken(() => emptyRefusalReply());

    expect(stoppedWithout(run, 'refusal.review-profile')).toStrictEqual(
      NO_REWRITE,
    );
    expect(notices(run).some((n) => n.includes('itself refused'))).toBe(true);
  });

  it('keeps the reviewer refusal out of the foreground attempts and logs it under its purpose', async () => {
    const run = await broken(() => emptyRefusalReply());

    expect({
      foregroundOutcomes: turnRecords(run.tokenRecords).map(
        (r) => r['attempt_outcome'],
      ),
      reviewRecords: run.tokenRecords
        .filter((r) => r['record_type'] === 'refusal_review')
        .map((r) => [r['purpose'], r['verdict'], r['model']]),
      // /stats counts the reviewer's own refusal under the reviewer's model.
      statRefusals: run.stats.apiRefusals,
    }).toStrictEqual({
      foregroundOutcomes: ['refusal', 'refusal'],
      reviewRecords: [['refusal-review', 'refused', REVIEWER_MODEL]],
      statRefusals: 3,
    });
  });

  it('stops when the reviewer endpoint fails', async () => {
    const run = await broken(() => httpErrorReply(400));

    expect(stoppedWithout(run, 'failed')).toStrictEqual(NO_REWRITE);
  });
});

describe('history that changes while the reviewer thinks (issue #4036)', () => {
  it('rewrites nothing and keeps the entry that was appended', async () => {
    const run = await runReviewScenario({
      profile: PROFILE,
      duringReview: async (agent) => {
        await agent.addHistory({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'appended while reviewing' }],
        });
      },
    });

    const text = historyText(run.historyAfter);
    expect({
      rewrites: journal(run, 'refusal_rewrite').length,
      foregroundRequests: run.foreground.length,
      appended: text.includes('appended while reviewing'),
      stillOriginal: text.includes(ORIGINAL_PHRASE),
      reasons: doneReasons(run),
    }).toStrictEqual({
      rewrites: 0,
      foregroundRequests: 2,
      appended: true,
      stillOriginal: true,
      reasons: ['refusal'],
    });
  });
});
