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

export const cleanup = () => {
  for (const instance of Array.from(activeInstances.keys())) {
    activeInstances.delete(instance);

    try {
      instance.unmount();
    } catch {
      // Ignore teardown failures in test cleanup.
    }

    try {
      instance.cleanup();
    } catch {
      // Ignore teardown failures in test cleanup.
    }
  }
  setActiveStdin(null);
};
