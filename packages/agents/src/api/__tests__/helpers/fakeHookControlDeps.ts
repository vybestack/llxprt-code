/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DefaultHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
/**
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-015
 *
 * Focused infra fake for {@link HookControl}'s dependency bundle. Lives under
 * __tests__/helpers/ so deep core imports + a single isolated cast are
 * permitted while staying excluded from the T17 boundary scan.
 *
 * Provides:
 *  - a REAL {@link MessageBus} so the bus-mediated request/response correlation
 *    path can be exercised by publishing genuine HOOK_EXECUTION messages;
 *  - a configurable fake {@link Config} whose lifecycle hook system returns a
 *    caller-supplied aggregated output, so the lifecycle-trigger → toHookOutput
 *    projection branches run against real `SessionStart/SessionEndHookOutput`
 *    instances (no mock theater — the control's real merge logic runs).
 */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import {
  MessageBusType,
  type HookExecutionRequest as BusHookExecutionRequest,
  type HookExecutionResponse as BusHookExecutionResponse,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  SessionStartHookOutput,
  SessionEndHookOutput,
  type HookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import { HookControl } from '../../control/hooks.js';

/**
 * A configurable aggregated lifecycle output. When `finalOutput` is undefined,
 * the lifecycle trigger returns undefined (the "no command hook ran" path);
 * otherwise the supplied fields are wrapped in the matching core output class
 * so HookControl.toHookOutput merges REAL output fields.
 */
export interface FakeLifecycleResult {
  readonly start?: Partial<HookOutput>;
  readonly end?: Partial<HookOutput>;
}

/**
 * A minimal HookSystem duck-type. The lifecycle triggers only call
 * `initialize()` then `fireSessionStartEvent`/`fireSessionEndEvent`, reading
 * `result.finalOutput`. This fake returns the caller-supplied aggregate.
 */

export interface HookControlDepsHandle {
  readonly control: HookControl;
  readonly messageBus: MessageBus;
  /** Publish a bus HOOK_EXECUTION_REQUEST for the given correlation id. */
  publishBusRequest(eventName: string, correlationId: string): void;
  /** Publish a bus HOOK_EXECUTION_RESPONSE for the given correlation id. */
  publishBusResponse(
    correlationId: string,
    options?: { success?: boolean; error?: { code?: string; message: string } },
  ): void;
  /** The session id the fake reports (constant). */
  readonly sessionId: string;
  /** The cwd the fake reports (constant). */
  readonly cwd: string;
}

export interface CreateHookControlDepsOptions {
  /** Whether the fake Config reports hooks enabled (default true). */
  readonly enableHooks?: boolean;
  /** Whether the fake Config exposes a hook system (default true). */
  readonly withHookSystem?: boolean;
  /** Aggregated lifecycle outputs the fake hook system returns. */
  readonly lifecycle?: FakeLifecycleResult;
  readonly sessionId?: string;
  readonly cwd?: string;
}

/**
 * Builds a {@link HookControl} over a real MessageBus and a configurable fake
 * Config. Returns a handle exposing publish helpers and the wiring constants.
 */
export function createHookControlDeps(
  options: CreateHookControlDepsOptions = {},
): HookControlDepsHandle {
  const enableHooks = options.enableHooks ?? true;
  const withHookSystem = options.withHookSystem ?? true;
  const sessionId = options.sessionId ?? 'sess-test';
  const cwd = options.cwd ?? '/work/dir';
  const lifecycle = options.lifecycle ?? {};

  const messageBus = new MessageBus();

  let disabled: readonly string[] = [];
  const aggregate = (output: Partial<HookOutput> | undefined) => ({
    success: true,
    finalOutput:
      output === undefined ? undefined : new DefaultHookOutput(output),
    allOutputs: output === undefined ? [] : [new DefaultHookOutput(output)],
    errors: [],
    totalDuration: 0,
  });
  const hookOperations = {
    execution(
      identity: Pick<
        HookExecutionOwner,
        'sessionId' | 'transcriptPath' | 'signal'
      >,
    ): HookExecutionOwner {
      return {
        ...identity,
        sessionStart: async () =>
          enableHooks && withHookSystem
            ? aggregate(lifecycle.start)
            : undefined,
        sessionEnd: async () =>
          enableHooks && withHookSystem ? aggregate(lifecycle.end) : undefined,
      };
    },
    closeAdmission: () => {},
    finishSession: async () => aggregate(lifecycle.end),
    listHooks: () => [],
    getDisabledHooks: () => [...disabled],
    setDisabledHooks: (names: readonly string[]) => {
      disabled = [...names];
    },
  };

  const control = new HookControl({
    hookOperations,
    messageBus,
    sessionId: () => sessionId,
    cwd: () => cwd,
  });

  return {
    control,
    messageBus,
    sessionId,
    cwd,
    publishBusRequest(eventName: string, correlationId: string): void {
      const message: BusHookExecutionRequest = {
        type: MessageBusType.HOOK_EXECUTION_REQUEST,
        payload: { eventName, correlationId },
      };
      messageBus.publish(message);
    },
    publishBusResponse(
      correlationId: string,
      options?: {
        success?: boolean;
        error?: { code?: string; message: string };
      },
    ): void {
      const message: BusHookExecutionResponse = {
        type: MessageBusType.HOOK_EXECUTION_RESPONSE,
        payload: {
          correlationId,
          success: options?.success ?? true,
          error: options?.error,
        },
      };
      messageBus.publish(message);
    },
  };
}

export { SessionStartHookOutput, SessionEndHookOutput };
