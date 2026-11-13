/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 review round 1 (H1): the reviewer runs on the route its own
 * profile resolves to. It never inherits the refused request's admitted model
 * parameters; only the no-profile fallback reuses the foreground route. Every
 * test drives the PUBLIC `agent.stream()`; the foreground model and the
 * reviewer are local Anthropic or OpenAI endpoints that record wire requests.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { isDoneEvent } from './helpers/agentHarness.js';
import {
  REVIEWER_MODEL,
  REWRITTEN_PHRASE,
  runReviewScenario,
  wireIncludes,
  type ReviewRun,
  type ReviewScenario,
} from './helpers/refusal-review-harness.js';

// Each case runs a whole agent, two local endpoints and a journal replay.
setDefaultTimeout(90_000);

const OPUS = 'claude-opus-5-5';
const SONNET = 'claude-sonnet-5-5';
const FOREGROUND_TOP_P = 0.2;
const REVIEWER_TOP_P = 0.7;

const ANTHROPIC_FOREGROUND = {
  foregroundProtocol: 'anthropic',
  foregroundModel: OPUS,
  foregroundParams: { top_p: FOREGROUND_TOP_P },
} as const satisfies ReviewScenario;

function lastOf<T>(items: readonly T[]): T {
  return items[items.length - 1];
}

function doneReasons(run: ReviewRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

describe('a reviewer profile on another provider (issue #4036)', () => {
  const crossProvider = (): Promise<ReviewRun> =>
    runReviewScenario({
      ...ANTHROPIC_FOREGROUND,
      profile: {
        name: 'openai-reviewer',
        setting: 'refusal.review-profile',
        protocol: 'openai',
        model: REVIEWER_MODEL,
        modelParams: { top_p: REVIEWER_TOP_P },
      },
    });

  it('reviews an Anthropic refusal on the OpenAI reviewer endpoint', async () => {
    const run = await crossProvider();

    expect({
      reviewerRequests: run.profileEndpoint.map((r) => r.model),
      reviewerTopP: run.profileEndpoint.map((r) => r['top_p']),
    }).toStrictEqual({
      reviewerRequests: [REVIEWER_MODEL],
      reviewerTopP: [REVIEWER_TOP_P],
    });
  });

  it('rewrites the context and lets the Anthropic model answer', async () => {
    const run = await crossProvider();

    expect({
      reasons: doneReasons(run),
      rewritten: wireIncludes(lastOf(run.foreground), REWRITTEN_PHRASE),
    }).toStrictEqual({ reasons: ['stop'], rewritten: true });
  });
});

describe('a reviewer profile on the same provider (issue #4036)', () => {
  const sameProvider = (): Promise<ReviewRun> =>
    runReviewScenario({
      ...ANTHROPIC_FOREGROUND,
      profile: {
        name: 'sonnet-reviewer',
        setting: 'refusal.review-profile',
        protocol: 'anthropic',
        model: SONNET,
        modelParams: { top_p: REVIEWER_TOP_P },
      },
    });

  it('sends the reviewer profile model and parameters, not the refused request ones', async () => {
    const run = await sameProvider();

    const [review] = run.profileEndpoint;
    expect({ model: review.model, topP: review['top_p'] }).toStrictEqual({
      model: SONNET,
      topP: REVIEWER_TOP_P,
    });
  });

  it('keeps the foreground requests on their own model and parameters', async () => {
    const run = await sameProvider();

    expect(
      run.foreground.map((r) => ({ model: r.model, topP: r['top_p'] })),
    ).toStrictEqual(
      run.foreground.map(() => ({ model: OPUS, topP: FOREGROUND_TOP_P })),
    );
  });

  it('recovers the request after the rewrite', async () => {
    const run = await sameProvider();

    expect(doneReasons(run)).toStrictEqual(['stop']);
  });
});

describe('a reviewer without a profile (issue #4036)', () => {
  it('reviews on the refused request route with its model and parameters', async () => {
    const run = await runReviewScenario({ ...ANTHROPIC_FOREGROUND });

    expect({
      reviews: run.reviews.map((r) => ({
        model: r.model,
        topP: r['top_p'],
      })),
      reviewedOnForegroundEndpoint: run.foregroundEndpoint.filter((r) =>
        run.reviews.includes(r),
      ).length,
    }).toStrictEqual({
      reviews: [{ model: OPUS, topP: FOREGROUND_TOP_P }],
      reviewedOnForegroundEndpoint: 1,
    });
  });
});
