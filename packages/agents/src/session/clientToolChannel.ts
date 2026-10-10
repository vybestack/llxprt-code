import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ApprovalMode } from '@vybestack/llxprt-code-core/config/configTypes.js';

import type {
  ToolExecutionPolicy,
  ToolGovernance,
  ToolLookup,
} from '@vybestack/llxprt-code-tools';
import { isValidEditorType } from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import type { AgentDisplayCallbacks, AgentToolControl } from '../api/agent.js';
import type { EditorCallbacks } from '../api/config-types.js';
import {
  assembleSchedulerOwner,
  type SchedulerConstruction,
} from './assembleSchedulerOwner.js';
import type { SessionSchedulerOwner } from './sessionSchedulerOwner.js';

type ClientChannel = ReturnType<AgentToolControl['openClientChannel']>;

export function createClientToolChannel(
  config: Config,
  messageBus: MessageBus,
  editorCallbacks: () => EditorCallbacks,
  onComplete: NonNullable<Parameters<AgentToolControl['openClientChannel']>[0]>,
  toolRegistry: ToolLookup,
  construct: SchedulerConstruction | undefined,
  readExecutionPolicy: () => ToolExecutionPolicy,
  getToolGovernance: () => ToolGovernance,
  readApprovalMode: (() => ApprovalMode) | undefined,
  telemetry: RootTelemetry,
): ClientChannel {
  const observers = new Set<AgentDisplayCallbacks>();
  const completions = new Set<Promise<void>>();
  let controller = new AbortController();
  let closing: Promise<void> | undefined;
  const owner = assembleSchedulerOwner(
    config.getSessionId(),
    {
      config,
      telemetry,
      readExecutionPolicy,
      readApprovalMode,
      getToolGovernance,
      messageBus,
      toolRegistry,
      toolContextInteractiveMode: true,
      getPreferredEditor: () => {
        const editor = editorCallbacks().getPreferredEditor?.();
        return editor !== undefined && isValidEditorType(editor)
          ? editor
          : undefined;
      },
      onEditorOpen: () => editorCallbacks().onEditorOpen?.(),
      onEditorClose: () => editorCallbacks().onEditorClose?.(),
      onToolCallsUpdate: (calls) => {
        for (const observer of observers) observer.onToolCallsUpdate?.(calls);
      },
      outputUpdateHandler: (callId, update) => {
        for (const observer of observers)
          observer.outputUpdateHandler?.(callId, update);
      },
      onAllToolCallsComplete: (calls) =>
        deliverClientCompletion(calls, onComplete, observers, completions),
    },
    construct,
  );
  const lease = owner.acquire();
  return {
    ready: lease.ready,
    schedule: (request, signal) =>
      lease.schedule(request, AbortSignal.any([signal, controller.signal])),
    cancelAll: () => {
      controller.abort();
      controller = new AbortController();
    },
    subscribe: (callbacks) => {
      if (closing) throw new Error('Client tool channel released');
      observers.add(callbacks);
      return () => {
        observers.delete(callbacks);
      };
    },
    release: () => {
      if (!closing) {
        observers.clear();
        closing = closeClientExecution(owner, completions);
      }
      return closing;
    },
  };
}

async function closeClientExecution(
  owner: SessionSchedulerOwner,
  completions: ReadonlySet<Promise<void>>,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await owner.dispose();
  } catch (error) {
    errors.push(error);
  }
  for (const result of await Promise.allSettled(completions)) {
    if (result.status === 'rejected') errors.push(result.reason);
  }
  if (errors.length > 0)
    throw new AggregateError(errors, 'Client tool channel release failed');
}

async function deliverClientCompletion(
  calls: Parameters<
    NonNullable<AgentDisplayCallbacks['onAllToolCallsComplete']>
  >[0],
  onComplete: NonNullable<Parameters<AgentToolControl['openClientChannel']>[0]>,
  observers: ReadonlySet<AgentDisplayCallbacks>,
  completions: Set<Promise<void>>,
): Promise<void> {
  const completion = Promise.resolve().then(async () => {
    await onComplete(calls);
    for (const observer of observers)
      await observer.onAllToolCallsComplete?.(calls);
  });
  completions.add(completion);
  try {
    await completion;
  } finally {
    completions.delete(completion);
  }
}
