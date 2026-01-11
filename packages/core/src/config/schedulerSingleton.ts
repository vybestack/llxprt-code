/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CoreToolScheduler singleton factory
 * Separated from Config to avoid circular dependencies during module loading
 */

import type { Config } from './config.js';

export interface SchedulerCallbacks {
  outputUpdateHandler?: (toolCallId: string, outputChunk: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onAllToolCallsComplete?: (completedToolCalls: any[]) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onToolCallsUpdate?: (toolCalls: any[]) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPreferredEditor: () => any;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
}

type SchedulerEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: any;
  refCount: number;
  callbacks?: SchedulerCallbacks;
};

const schedulerEntries = new Map<string, SchedulerEntry>();

export async function getOrCreateScheduler(
  config: Config,
  sessionId: string,
  callbacks: SchedulerCallbacks,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
Promise<any> {
  const entry = schedulerEntries.get(sessionId);

  if (!entry) {
    // Use dynamic import to avoid circular dependencies and work with ESM
    const { CoreToolScheduler: CoreToolSchedulerClass } =
      await import('../core/coreToolScheduler.js');
    const scheduler = new CoreToolSchedulerClass({
      config,
      outputUpdateHandler: callbacks.outputUpdateHandler,
      onAllToolCallsComplete: callbacks.onAllToolCallsComplete,
      onToolCallsUpdate: callbacks.onToolCallsUpdate,
      getPreferredEditor: callbacks.getPreferredEditor,
      onEditorClose: callbacks.onEditorClose,
      onEditorOpen: callbacks.onEditorOpen,
    });
    schedulerEntries.set(sessionId, {
      scheduler,
      refCount: 1,
      callbacks,
    });
    return scheduler;
  }

  const entryCallbacks = entry.callbacks;
  const shouldRefreshCallbacks =
    !entryCallbacks ||
    entryCallbacks.outputUpdateHandler !== callbacks.outputUpdateHandler ||
    entryCallbacks.onAllToolCallsComplete !==
      callbacks.onAllToolCallsComplete ||
    entryCallbacks.onToolCallsUpdate !== callbacks.onToolCallsUpdate ||
    entryCallbacks.getPreferredEditor !== callbacks.getPreferredEditor ||
    entryCallbacks.onEditorClose !== callbacks.onEditorClose ||
    entryCallbacks.onEditorOpen !== callbacks.onEditorOpen;

  entry.refCount += 1;
  if (shouldRefreshCallbacks) {
    entry.scheduler.setCallbacks?.({
      config,
      outputUpdateHandler: callbacks.outputUpdateHandler,
      onAllToolCallsComplete: callbacks.onAllToolCallsComplete,
      onToolCallsUpdate: callbacks.onToolCallsUpdate,
      getPreferredEditor: callbacks.getPreferredEditor,
      onEditorClose: callbacks.onEditorClose,
      onEditorOpen: callbacks.onEditorOpen,
    });
    entry.callbacks = callbacks;
  }
  return entry.scheduler;
}

export function disposeScheduler(sessionId: string): void {
  const entry = schedulerEntries.get(sessionId);
  if (!entry) {
    return;
  }

  entry.refCount -= 1;
  if (entry.refCount > 0) {
    return;
  }

  entry.scheduler.dispose();
  schedulerEntries.delete(sessionId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSchedulerInstance(sessionId: string): any {
  return schedulerEntries.get(sessionId)?.scheduler;
}

export function clearAllSchedulers(): void {
  for (const [_sessionId, entry] of schedulerEntries.entries()) {
    try {
      entry.scheduler.dispose();
    } catch (_error) {
      // Ignore errors during cleanup
    }
  }
  schedulerEntries.clear();
}
