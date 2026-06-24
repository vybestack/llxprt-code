/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 * @requirement:REQ-017
 *
 * Helper re-export surface for the pure agentBootstrap helper functions so the
 * consumer-facing behavioral spec can exercise them WITHOUT a deep import in
 * the spec itself (helpers/ is excluded from the boundary deep-import scan).
 * These are the genuine production functions — no re-implementation.
 */

import {
  wrapSchedulerFactory as wrapSchedulerFactoryImpl,
  resolveAuthType,
  generateRuntimeId,
  wrapApprovalHandler,
  deriveDisplayCallbacks,
  toPartListUnion,
  recordOwnership,
  drainToResult,
  buildAgentResult,
  buildProviderInfos,
  buildToolInfos,
  AgentBootstrapError,
} from '../../agentBootstrap.js';
import type {
  AgentSchedulerFactory,
  AgentSchedulerHandle,
} from '../../config-types.js';
import {
  MessageBusType,
  type ToolConfirmationRequest,
  type SerializableConfirmationDetails,
} from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';

export { ToolConfirmationOutcome };

export {
  resolveAuthType,
  generateRuntimeId,
  wrapApprovalHandler,
  deriveDisplayCallbacks,
  toPartListUnion,
  recordOwnership,
  drainToResult,
  buildAgentResult,
  buildProviderInfos,
  buildToolInfos,
  AgentBootstrapError,
};
export type {
  ResolvedAuth,
  OwnershipRecord,
  SessionLock,
} from '../../agentBootstrap.js';

/**
 * Observable outcome of exercising the production wrapSchedulerFactory. The
 * core ToolScheduler types are intentionally faked HERE (helpers/ is exempt
 * from the boundary deep-import + cast rules); the SPEC asserts only on these
 * plain observable values.
 */
export interface WrapSchedulerProbeResult {
  readonly returnedScheduler: unknown;
  readonly observedSessionId: string;
  readonly interactiveModeForwarded: boolean;
  readonly observedInteractiveMode: boolean | undefined;
  readonly retainedHandles: readonly AgentSchedulerHandle[];
}

/**
 * Drives the genuine wrapSchedulerFactory with a fake real-scheduler builder
 * and a caller-owned AgentSchedulerFactory, then reports the observable
 * behavior: which scheduler was returned, what session/interactive context the
 * caller factory saw, and which handle was retained.
 */
export function runWrapSchedulerFactory(opts: {
  readonly sessionId: string;
  readonly toolContextInteractiveMode?: boolean;
}): WrapSchedulerProbeResult {
  const realScheduler = { kind: 'real-scheduler' } as const;
  const buildRealScheduler = ((): unknown => realScheduler) as never;

  const handle: AgentSchedulerHandle = { dispose: (): void => {} };
  let observedSessionId = '';
  let interactiveModeForwarded = false;
  let observedInteractiveMode: boolean | undefined;
  const callerFactory: AgentSchedulerFactory = (factoryOpts) => {
    observedSessionId = factoryOpts.sessionId;
    interactiveModeForwarded = 'interactiveMode' in factoryOpts;
    observedInteractiveMode = factoryOpts.interactiveMode;
    return handle;
  };

  const createdHandles: AgentSchedulerHandle[] = [];
  const wrapped = wrapSchedulerFactoryImpl(
    callerFactory,
    buildRealScheduler,
    createdHandles,
  );

  const factoryOptions = {
    config: { getSessionId: (): string => opts.sessionId },
    ...(opts.toolContextInteractiveMode !== undefined
      ? { toolContextInteractiveMode: opts.toolContextInteractiveMode }
      : {}),
  } as never;

  const returnedScheduler = wrapped(factoryOptions) as unknown;
  return {
    returnedScheduler,
    observedSessionId,
    interactiveModeForwarded,
    observedInteractiveMode,
    retainedHandles: createdHandles,
  };
}

/** Simple confirmation shape the production wrapApprovalHandler maps onto. */
export interface ObservedConfirmation {
  readonly confirmationId: string;
  readonly toolCallId: string;
  readonly name: string;
  readonly details: unknown;
}

/** Observable outcome of driving the production wrapApprovalHandler. */
export interface WrapApprovalProbeResult {
  readonly observed: ObservedConfirmation;
  readonly result: { readonly outcome: ToolConfirmationOutcome };
}

/**
 * Drives the genuine wrapApprovalHandler with a real {@link
 * ToolConfirmationRequest}, capturing the simple confirmation object the inner
 * handler received and the {outcome} result it returned. The request is fully
 * typed against the production ApprovalHandler contract (no `any`); helpers/ is
 * exempt from the boundary deep-import rule so this is the genuine seam.
 */
export async function runWrapApprovalHandler(input: {
  readonly request: ToolConfirmationRequest;
  readonly outcome: ToolConfirmationOutcome;
}): Promise<WrapApprovalProbeResult> {
  let observed: ObservedConfirmation | undefined;
  const wrapped = wrapApprovalHandler((confirmation) => {
    observed = confirmation;
    return input.outcome;
  });
  const result = await wrapped(input.request);
  if (observed === undefined) {
    throw new Error('wrapApprovalHandler did not invoke the inner handler');
  }
  return { observed, result };
}

/** Builds a real ToolConfirmationRequest for the approval-handler probe. */
export function makeConfirmationRequest(fields: {
  readonly correlationId: string;
  readonly toolCall: { readonly id?: string; readonly name?: string };
  readonly details?: SerializableConfirmationDetails;
}): ToolConfirmationRequest {
  return {
    type: MessageBusType.TOOL_CONFIRMATION_REQUEST,
    correlationId: fields.correlationId,
    toolCall: fields.toolCall,
    ...(fields.details !== undefined ? { details: fields.details } : {}),
  };
}
