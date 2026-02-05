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
import type {
  CompletedToolCall,
  CoreToolScheduler,
  ToolCall,
} from '../core/coreToolScheduler.js';
import type { EditorType } from '../utils/editor.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';

export interface SchedulerCallbacks {
  outputUpdateHandler?: (
    toolCallId: string,
    outputChunk: string | AnsiOutput,
  ) => void;
  onAllToolCallsComplete?: (
    completedToolCalls: CompletedToolCall[],
  ) => Promise<void>;
  onToolCallsUpdate?: (toolCalls: ToolCall[]) => void;
  getPreferredEditor: () => EditorType | undefined;
  onEditorClose: () => void;
  onEditorOpen?: () => void;
}

type SchedulerEntry = {
  scheduler: CoreToolScheduler;
  refCount: number;
  callbacks?: SchedulerCallbacks;
};

type SchedulerInitState = {
  promise: Promise<CoreToolScheduler>;
  callbacks: SchedulerCallbacks;
  refCount: number;
};

const schedulerEntries = new Map<string, SchedulerEntry>();
const schedulerInitStates = new Map<string, SchedulerInitState>();

const createCombinedCallbacks = (
  callbackList: SchedulerCallbacks[],
): SchedulerCallbacks => {
  const outputHandlers = callbackList
    .map((callbacks) => callbacks.outputUpdateHandler)
    .filter(
      (handler): handler is NonNullable<typeof handler> =>
        typeof handler === 'function',
    );
  const completionHandlers = callbackList
    .map((callbacks) => callbacks.onAllToolCallsComplete)
    .filter(
      (handler): handler is NonNullable<typeof handler> =>
        typeof handler === 'function',
    );
  const updateHandlers = callbackList
    .map((callbacks) => callbacks.onToolCallsUpdate)
    .filter(
      (handler): handler is NonNullable<typeof handler> =>
        typeof handler === 'function',
    );
  const preferredEditorSelectors = callbackList
    .map((callbacks) => callbacks.getPreferredEditor)
    .filter(
      (handler): handler is NonNullable<typeof handler> =>
        typeof handler === 'function',
    );

  return {
    outputUpdateHandler: outputHandlers.length
      ? (toolCallId, outputChunk) => {
          for (const handler of outputHandlers) {
            handler(toolCallId, outputChunk);
          }
        }
      : undefined,
    onAllToolCallsComplete: completionHandlers.length
      ? async (completedToolCalls) => {
          for (const handler of completionHandlers) {
            await handler(completedToolCalls);
          }
        }
      : undefined,
    onToolCallsUpdate: updateHandlers.length
      ? (toolCalls) => {
          for (const handler of updateHandlers) {
            handler(toolCalls);
          }
        }
      : undefined,
    getPreferredEditor: () => {
      const preferredEditor = preferredEditorSelectors
        .map((handler) => handler())
        .find((result) => result !== undefined);
      return preferredEditor;
    },
    onEditorClose: () => {
      for (const callbacks of callbackList) {
        callbacks.onEditorClose();
      }
    },
    onEditorOpen: () => {
      for (const callbacks of callbackList) {
        callbacks.onEditorOpen?.();
      }
    },
  };
};

const shouldRefreshCallbacks = (
  entryCallbacks: SchedulerCallbacks | undefined,
  callbacks: SchedulerCallbacks,
): boolean =>
  !entryCallbacks ||
  entryCallbacks.outputUpdateHandler !== callbacks.outputUpdateHandler ||
  entryCallbacks.onAllToolCallsComplete !== callbacks.onAllToolCallsComplete ||
  entryCallbacks.onToolCallsUpdate !== callbacks.onToolCallsUpdate ||
  entryCallbacks.getPreferredEditor !== callbacks.getPreferredEditor ||
  entryCallbacks.onEditorClose !== callbacks.onEditorClose ||
  entryCallbacks.onEditorOpen !== callbacks.onEditorOpen;

export async function getOrCreateScheduler(
  config: Config,
  sessionId: string,
  callbacks: SchedulerCallbacks,
): Promise<CoreToolScheduler> {
  const entry = schedulerEntries.get(sessionId);

  if (entry) {
    entry.refCount += 1;
    if (shouldRefreshCallbacks(entry.callbacks, callbacks)) {
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

  const inFlight = schedulerInitStates.get(sessionId);
  if (inFlight) {
    inFlight.refCount += 1;
    const combinedCallbacks = createCombinedCallbacks([
      inFlight.callbacks,
      callbacks,
    ]);
    inFlight.callbacks = combinedCallbacks;
    const scheduler = await inFlight.promise;
    scheduler.setCallbacks?.({
      config,
      outputUpdateHandler: combinedCallbacks.outputUpdateHandler,
      onAllToolCallsComplete: combinedCallbacks.onAllToolCallsComplete,
      onToolCallsUpdate: combinedCallbacks.onToolCallsUpdate,
      getPreferredEditor: combinedCallbacks.getPreferredEditor,
      onEditorClose: combinedCallbacks.onEditorClose,
      onEditorOpen: combinedCallbacks.onEditorOpen,
    });
    const existingEntry = schedulerEntries.get(sessionId);
    if (existingEntry) {
      existingEntry.refCount += 1;
      existingEntry.callbacks = combinedCallbacks;
      return existingEntry.scheduler;
    }
    schedulerEntries.set(sessionId, {
      scheduler,
      refCount: 1,
      callbacks: combinedCallbacks,
    });
    return scheduler;
  }

  const creationPromise = (async () => {
    const { CoreToolScheduler: CoreToolSchedulerClass } = await import(
      '../core/coreToolScheduler.js'
    );
    return new CoreToolSchedulerClass({
      config,
      outputUpdateHandler: callbacks.outputUpdateHandler,
      onAllToolCallsComplete: callbacks.onAllToolCallsComplete,
      onToolCallsUpdate: callbacks.onToolCallsUpdate,
      getPreferredEditor: callbacks.getPreferredEditor,
      onEditorClose: callbacks.onEditorClose,
      onEditorOpen: callbacks.onEditorOpen,
    });
  })();

  const initState: SchedulerInitState = {
    promise: creationPromise,
    callbacks,
    refCount: 1,
  };
  schedulerInitStates.set(sessionId, initState);

  try {
    const scheduler = await creationPromise;
    schedulerEntries.set(sessionId, {
      scheduler,
      refCount: initState.refCount,
      callbacks: initState.callbacks,
    });
    return scheduler;
  } finally {
    schedulerInitStates.delete(sessionId);
  }
}

export function disposeScheduler(sessionId: string): void {
  const entry = schedulerEntries.get(sessionId);
  if (entry) {
    entry.refCount -= 1;
    if (entry.refCount > 0) {
      return;
    }

    schedulerEntries.delete(sessionId);
    try {
      entry.scheduler.dispose();
    } catch (_error) {
      // Ignore errors during cleanup
    } finally {
      schedulerInitStates.delete(sessionId);
    }
    return;
  }

  const inFlight = schedulerInitStates.get(sessionId);
  if (!inFlight) {
    return;
  }

  inFlight.refCount -= 1;
  if (inFlight.refCount > 0) {
    return;
  }
  schedulerInitStates.delete(sessionId);
}

export function getSchedulerInstance(
  sessionId: string,
): CoreToolScheduler | undefined {
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
  schedulerInitStates.clear();
}
