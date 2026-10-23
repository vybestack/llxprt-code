/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { setActiveStdin } from './ink-stub.js';

/**
 * Registry of live test renders and their teardown.
 *
 * It is separate from ink-testing-library.ts so the workspace test preload can
 * tear down renders after every test without importing the real Ink renderer
 * in test files that never render.
 */
export interface RegisteredRender {
  unmount(): void;
  cleanup(): void;
}

const activeInstances = new Map<RegisteredRender, NodeJS.ReadStream>();

function restoreMostRecentStdin(): void {
  const remaining = Array.from(activeInstances.values());
  setActiveStdin(remaining.at(-1) ?? null);
}

export function registerRender(
  instance: RegisteredRender,
  stdin: NodeJS.ReadStream,
): void {
  activeInstances.set(instance, stdin);
}

export function releaseRender(instance: RegisteredRender): void {
  activeInstances.delete(instance);
  restoreMostRecentStdin();
}

/**
 * Tears down every live render. Each render gets both teardown steps even if
 * the first throws, and a failure is reported once all renders have been
 * handled: a render that cannot be disposed is still holding its listeners and
 * timers, which is the kind of leftover that keeps a finished test file from
 * exiting.
 */
export const cleanup = () => {
  const failures: unknown[] = [];
  for (const instance of Array.from(activeInstances.keys())) {
    activeInstances.delete(instance);

    for (const teardown of [
      () => instance.unmount(),
      () => instance.cleanup(),
    ]) {
      try {
        teardown();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  setActiveStdin(null);

  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Multiple Ink render teardowns failed');
  }
};
