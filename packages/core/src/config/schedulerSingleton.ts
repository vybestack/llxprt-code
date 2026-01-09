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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const schedulerInstances = new Map<string, any>();
const schedulerCallbacks = new Map<string, SchedulerCallbacks[]>();

export async function getOrCreateScheduler(
  config: Config,
  sessionId: string,
  callbacks: SchedulerCallbacks,
): // eslint-disable-next-line @typescript-eslint/no-explicit-any
Promise<any> {
  let scheduler = schedulerInstances.get(sessionId);

  if (!scheduler) {
    // Use dynamic import to avoid circular dependencies and work with ESM
    const { CoreToolScheduler: CoreToolSchedulerClass } =
      await import('../core/coreToolScheduler.js');
    scheduler = new CoreToolSchedulerClass({
      config,
      outputUpdateHandler: callbacks.outputUpdateHandler,
      onAllToolCallsComplete: callbacks.onAllToolCallsComplete,
      onToolCallsUpdate: callbacks.onToolCallsUpdate,
      getPreferredEditor: callbacks.getPreferredEditor,
      onEditorClose: callbacks.onEditorClose,
      onEditorOpen: callbacks.onEditorOpen,
    });
    schedulerInstances.set(sessionId, scheduler);
    schedulerCallbacks.set(sessionId, [callbacks]);
  } else {
    const existingCallbacks = schedulerCallbacks.get(sessionId) || [];
    existingCallbacks.push(callbacks);
    schedulerCallbacks.set(sessionId, existingCallbacks);
  }

  return scheduler;
}

export function disposeScheduler(sessionId: string): void {
  const scheduler = schedulerInstances.get(sessionId);
  if (scheduler) {
    scheduler.dispose();
    schedulerInstances.delete(sessionId);
    schedulerCallbacks.delete(sessionId);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSchedulerInstance(sessionId: string): any {
  return schedulerInstances.get(sessionId);
}

export function clearAllSchedulers(): void {
  for (const [_sessionId, scheduler] of schedulerInstances.entries()) {
    try {
      scheduler.dispose();
    } catch (_error) {
      // Ignore errors during cleanup
    }
  }
  schedulerInstances.clear();
  schedulerCallbacks.clear();
}
