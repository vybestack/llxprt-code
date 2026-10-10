/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export function initializeHookDefinitions(
  initialize: (signal: AbortSignal) => Promise<void>,
  lifecycleSignal: AbortSignal,
): Promise<void> {
  if (lifecycleSignal.aborted) return Promise.reject(lifecycleSignal.reason);
  const controller = new AbortController();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lifecycleSignal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = (): void => {
      controller.abort(lifecycleSignal.reason);
      finish(() => reject(lifecycleSignal.reason));
    };
    const timeout = setTimeout(() => {
      const error = new Error('Hook initialization timed out');
      controller.abort(error);
      finish(() => reject(error));
    }, 30_000);
    lifecycleSignal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return initialize(controller.signal);
      })
      .then(
        () => finish(resolve),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}
