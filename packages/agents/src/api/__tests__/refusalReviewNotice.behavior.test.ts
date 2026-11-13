/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036 review round 1 (L11): the host is told that a reviewer is being
 * asked before the reviewer call starts, so a slow reviewer does not leave the
 * user looking at a silent session.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';
import { isNoticeEvent } from './helpers/agentHarness.js';
import {
  REVIEWER_MODEL,
  runReviewScenario,
} from './helpers/refusal-review-harness.js';

// Each case runs a whole agent, two local endpoints and a journal replay.
setDefaultTimeout(90_000);

const PROFILE = {
  name: 'mesh-reviewer',
  setting: 'refusal.review-profile',
} as const;

const ASKING = `Model scripted-model refused 2 time(s); asking ${REVIEWER_MODEL} to review the recent context.`;

function notices(events: readonly AgentEvent[]): string[] {
  return events.filter(isNoticeEvent).map((notice) => notice.message);
}

describe('the notice before a refusal review (issue #4036)', () => {
  it('reaches the host before the reviewer is called', async () => {
    let shownBeforeReview: string[] = [];

    await runReviewScenario({
      profile: PROFILE,
      duringReview: (_agent, eventsSoFar) => {
        shownBeforeReview = notices(eventsSoFar);
        return Promise.resolve();
      },
    });

    expect(shownBeforeReview).toStrictEqual([
      'Model scripted-model refused the request; retrying in 1 ms (retry 1 of 1).',
      ASKING,
    ]);
  });

  it('is followed by the rewrite notice and the recovery notice', async () => {
    const run = await runReviewScenario({ profile: PROFILE });

    const all = notices(run.events);
    expect({
      asking: all.indexOf(ASKING),
      rewrote: all.findIndex((n) => n.startsWith('Refusal review by')),
      recovered: all.findIndex((n) => n.startsWith('Refusal recovered')),
    }).toStrictEqual({ asking: 1, rewrote: 2, recovered: 3 });
  });

  it('names the session model when no review profile is configured', async () => {
    const run = await runReviewScenario();

    expect(notices(run.events)).toContain(
      'Model scripted-model refused 2 time(s); asking scripted-model to review the recent context.',
    );
  });

  it('is not shown when the review profile cannot be used', async () => {
    const run = await runReviewScenario({
      settings: { 'refusal.review-profile': 'no-such-profile' },
    });

    expect(notices(run.events).some((n) => n.includes('asking'))).toBe(false);
  });
});
