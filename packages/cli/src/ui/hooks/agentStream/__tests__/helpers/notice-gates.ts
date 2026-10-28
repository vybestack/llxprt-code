/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';

/**
 * The notification subscription the hook registers is the only public place
 * where background completion becomes observable, so the gates come from it.
 * `arrived(n)` resolves once the owner has handed n notices to the hook's
 * `deliver` (a suppressed or busy hook holds the notice, so it has not settled
 * yet); `delivered(n)` resolves once n of those calls have settled (returned
 * or thrown); `evaluated()` resolves the next time the owner asks the hook
 * whether the agent is busy, which it does when a completion arrives. The
 * gates wrap the subscription on the instance and delegate to the real one.
 */
export interface NoticeGates {
  readonly arrived: (count: number) => Promise<void>;
  readonly delivered: (count: number) => Promise<void>;
  readonly evaluated: () => Promise<void>;
}

export function observeNotices(agent: Agent): NoticeGates {
  const subscribe = agent.tasks.subscribeNotifications.bind(agent.tasks);
  const handed = counter();
  const settled = counter();
  const evaluationWaiters: Array<() => void> = [];
  agent.tasks.subscribeNotifications = (isBusy, deliver) =>
    subscribe(
      () => {
        for (const resolve of evaluationWaiters.splice(0)) resolve();
        return isBusy();
      },
      async (message) => {
        handed.increment();
        try {
          return await deliver(message);
        } finally {
          settled.increment();
        }
      },
    );
  return {
    arrived: handed.reached,
    delivered: settled.reached,
    evaluated: () =>
      new Promise<void>((resolve) => evaluationWaiters.push(resolve)),
  };
}

function counter(): {
  readonly increment: () => void;
  readonly reached: (count: number) => Promise<void>;
} {
  let value = 0;
  const waiters: Array<{ count: number; resolve: () => void }> = [];
  return {
    increment: () => {
      value += 1;
      for (const waiter of waiters) if (waiter.count <= value) waiter.resolve();
    },
    reached: (count) =>
      value >= count
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiters.push({ count, resolve })),
  };
}
