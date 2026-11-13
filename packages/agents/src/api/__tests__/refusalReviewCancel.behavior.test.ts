/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 review round 1 (M6): cancelling a request while the reviewer
 * works must reach the reviewer's HTTP request. The reviewer endpoint is a
 * local server that notices when its client hangs up.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { isDoneEvent } from './helpers/agentHarness.js';
import { stopReply } from './helpers/refusal-endpoint.js';
import {
  runReviewScenario,
  type ReviewRun,
} from './helpers/refusal-review-harness.js';

// Each case runs a whole agent, two local endpoints and a journal replay.
setDefaultTimeout(90_000);

const PROFILE = {
  name: 'mesh-reviewer',
  setting: 'refusal.review-profile',
} as const;

/** Longest the endpoint waits for the client to hang up before it answers. */
const HANG_UP_GRACE_MS = 8000;

function doneReasons(run: ReviewRun): string[] {
  return run.events.filter(isDoneEvent).map((done) => done.reason);
}

describe('a request cancelled while the reviewer works (issue #4036)', () => {
  const abortedReview = (): Promise<ReviewRun> =>
    runReviewScenario({
      profile: PROFILE,
      abortDuringReview: true,
      reviewer: async (_request, _env, connection) => {
        await Promise.race([
          connection.clientClosed,
          new Promise<void>((resolve) => setTimeout(resolve, HANG_UP_GRACE_MS)),
        ]);
        return stopReply('{}');
      },
    });

  it('hangs up the reviewer HTTP request', async () => {
    const run = await abortedReview();

    expect(run.abandonedReviews).toBe(1);
  });

  it('ends the request as aborted without sending the refused request again', async () => {
    const run = await abortedReview();

    expect({
      reasons: doneReasons(run),
      foregroundRequests: run.foreground.length,
    }).toStrictEqual({ reasons: ['aborted'], foregroundRequests: 2 });
  });
});
