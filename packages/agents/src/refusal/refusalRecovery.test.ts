/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The coordinator waits through the function it is given (issue #4036), so a
 * test can see the full 15 s, 60 s, 180 s schedule without sleeping, and no
 * module-level state is needed to substitute the wait.
 */

import { describe, expect, it } from 'bun:test';
import { RefusalRecoveryCoordinator } from './refusalRecovery.js';
import type { RefusalPolicySource } from './refusalPolicy.js';
import type { RefusalAttempt, RefusalDecision } from './refusalTypes.js';
import type {
  RefusalReviewer,
  ReviewOutcome,
  ReviewRequest,
} from './reviewTypes.js';

function settings(retries: number): RefusalPolicySource {
  return {
    retries: () => retries,
    backoffMs: () => 15000,
    rewrite: () => false,
    reviewProfile: () => undefined,
    maxRewrites: () => 1,
  };
}

function refusal(attemptIndex: number): RefusalAttempt {
  return {
    finishReason: 'refusal',
    turnId: 'turn-1',
    promptId: 'prompt-1',
    attemptIndex,
    provider: 'openai',
    model: 'scripted-model',
  };
}

/** What the turn loop does with a decision: wait out a retry's backoff. */
async function waitOut(
  coordinator: RefusalRecoveryCoordinator,
  decision: RefusalDecision,
): Promise<void> {
  if (decision.action === 'retry') await coordinator.wait(decision.delayMs);
}

const REVIEWER = { provider: 'test', model: 'reviewer-model' };
const DROPPED: ReviewOutcome = {
  kind: 'dropped-literals',
  reviewer: REVIEWER,
  detail: 'the replacement for c21389.0 drops Casters/SSAO',
  dropped: [{ id: 'c21389.0', literals: ['Casters/SSAO'] }],
};
const REWRITTEN: ReviewOutcome = {
  kind: 'rewritten',
  reviewer: REVIEWER,
  operationId: 'rewrite-1',
  explanation: 'Plain wording.',
  changes: [
    {
      id: 'c21389.0',
      role: 'human',
      kind: 'summary',
      originalText: 'Original.',
      newText: 'Rewritten.',
    },
  ],
  pendingEdits: [],
};

function scriptedReviewer(
  outcomes: readonly ReviewOutcome[],
  requests: ReviewRequest[],
): RefusalReviewer {
  let call = 0;
  return {
    begin: async (request) => {
      requests.push(request);
      const outcome = outcomes[call];
      call += 1;
      return { reviewer: REVIEWER, run: () => Promise.resolve(outcome) };
    },
  };
}

describe('RefusalRecoveryCoordinator wait', () => {
  it('waits 15 s, 60 s and 180 s before the three retries, then stops', async () => {
    const requested: number[] = [];
    const coordinator = new RefusalRecoveryCoordinator({
      settings: settings(3),
      wait: (ms) => {
        requested.push(ms);
        return Promise.resolve();
      },
    });
    coordinator.admit('prompt-1');

    const decisions: RefusalDecision[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const decision = await coordinator.decide(refusal(attempt));
      decisions.push(decision);
      await waitOut(coordinator, decision);
    }

    expect({
      requested,
      actions: decisions.map((decision) => decision.action),
      notices: decisions.map((decision) =>
        'notice' in decision ? decision.notice : undefined,
      ),
    }).toStrictEqual({
      requested: [15000, 60000, 180000],
      actions: ['retry', 'retry', 'retry', 'stop'],
      notices: [
        'Model scripted-model refused the request; retrying in 15 s (retry 1 of 3).',
        'Model scripted-model refused the request; retrying in 60 s (retry 2 of 3).',
        'Model scripted-model refused the request; retrying in 180 s (retry 3 of 3).',
        'Model scripted-model refused 4 times (3 retries with backoff 15 s, 60 s, 180 s). Stopping.',
      ],
    });
  });

  it('re-reviews a dropped-literal answer when another review round remains', async () => {
    const requests: ReviewRequest[] = [];
    const coordinator = new RefusalRecoveryCoordinator({
      settings: {
        ...settings(0),
        rewrite: () => true,
        maxRewrites: () => 2,
      },
      wait: () => Promise.resolve(),
      reviewer: scriptedReviewer([DROPPED, REWRITTEN], requests),
    });
    coordinator.admit('prompt-1');

    const first = await coordinator.decide(refusal(0));
    if (first.action !== 'review') throw new Error('Expected initial review.');
    const second = await first.complete();
    if (second.action !== 'review') throw new Error('Expected second review.');
    const final = await second.complete();

    expect({
      action: final.action,
      rewrite: 'rewrite' in final ? final.rewrite : undefined,
      requests: requests.map((request) => request.keepLiterals),
      notices: [first.notice, second.notice],
    }).toStrictEqual({
      action: 'retry',
      rewrite: { pendingEdits: [], historyRewritten: true },
      requests: [undefined, [{ id: 'c21389.0', literals: ['Casters/SSAO'] }]],
      notices: [
        'Model scripted-model refused 1 time(s); asking reviewer-model to review the recent context.',
        'Refusal review by reviewer-model dropped Casters/SSAO from c21389.0; asking it again to keep them (review 2 of 2).',
      ],
    });
  });

  it('stops after a dropped-literal answer when the review budget is spent', async () => {
    const requests: ReviewRequest[] = [];
    const coordinator = new RefusalRecoveryCoordinator({
      settings: {
        ...settings(0),
        rewrite: () => true,
        maxRewrites: () => 1,
      },
      wait: () => Promise.resolve(),
      reviewer: scriptedReviewer([DROPPED], requests),
    });
    const first = await coordinator.decide(refusal(0));
    if (first.action !== 'review') throw new Error('Expected initial review.');

    const final = await first.complete();

    expect({
      action: final.action,
      notice: 'notice' in final ? final.notice : undefined,
      calls: requests.length,
    }).toStrictEqual({
      action: 'stop',
      notice:
        'Refusal review by reviewer-model gave an unusable answer (the replacement for c21389.0 drops Casters/SSAO), so nothing was rewritten. Stopping.',
      calls: 1,
    });
  });

  it('does not retry an invalid reply when a review round remains', async () => {
    const invalid: ReviewOutcome = {
      kind: 'stopped',
      reason: 'invalid-reply',
      reviewer: REVIEWER,
      detail: 'the reviewer reply was not valid JSON',
    };
    const requests: ReviewRequest[] = [];
    const coordinator = new RefusalRecoveryCoordinator({
      settings: {
        ...settings(0),
        rewrite: () => true,
        maxRewrites: () => 2,
      },
      wait: () => Promise.resolve(),
      reviewer: scriptedReviewer([invalid], requests),
    });
    const first = await coordinator.decide(refusal(0));
    if (first.action !== 'review') throw new Error('Expected initial review.');

    const final = await first.complete();

    expect({ action: final.action, calls: requests.length }).toStrictEqual({
      action: 'stop',
      calls: 1,
    });
  });

  it('hands the abort signal to the wait and passes its rejection on', async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const coordinator = new RefusalRecoveryCoordinator({
      settings: settings(1),
      wait: (_ms, signal) => {
        received = signal;
        return Promise.reject(signal?.reason ?? new Error('no signal'));
      },
    });
    const cancelled = new Error('cancelled during backoff');

    controller.abort(cancelled);

    await expect(coordinator.wait(15000, controller.signal)).rejects.toBe(
      cancelled,
    );
    expect(received).toBe(controller.signal);
  });
});
