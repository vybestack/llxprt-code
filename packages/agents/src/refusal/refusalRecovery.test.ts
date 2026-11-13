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
