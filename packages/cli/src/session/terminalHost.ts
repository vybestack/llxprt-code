/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  cleanupInstanceAndOwner,
  type InteractiveInstanceCapability,
  type InteractiveOwnerCapability,
} from './interactiveUiLifecycle.js';

export function createTerminalHost() {
  let instance: InteractiveInstanceCapability | undefined;
  let owner: InteractiveOwnerCapability | null = null;
  return {
    cleanupRegistered: false,
    syncCleanupRegistered: false,
    titleResetExitListenerRegistered: false,
    publish(
      nextInstance: InteractiveInstanceCapability | undefined,
      nextOwner: InteractiveOwnerCapability | null,
    ): void {
      instance = nextInstance;
      owner = nextOwner;
    },
    release(): void {
      instance = undefined;
      owner = null;
    },
    async cleanup(): Promise<void> {
      const previousInstance = instance;
      const previousOwner = owner;
      instance = undefined;
      owner = null;
      await cleanupInstanceAndOwner(previousInstance, previousOwner);
    },
  };
}

export type TerminalHost = ReturnType<typeof createTerminalHost>;
