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
