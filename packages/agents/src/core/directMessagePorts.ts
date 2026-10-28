/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentRuntimeContext,
  AgentRuntimeTelemetryAdapter,
  PrepareProviderInvocation,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { StreamTimeoutPolicy } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';

/**
 * What the direct-message path reads from the agent runtime: the runtime state
 * for model and route fallbacks, the media admission gate for converted user
 * input, the invocation preparation and diagnostics handed to the provider,
 * and the stream idle-timeout policy.
 */
export interface DirectMessagePorts {
  readonly state: AgentRuntimeState;
  readonly telemetry: AgentRuntimeTelemetryAdapter;
  readonly history: HistoryService;
  readonly mediaAdmission?: MediaAdmissionService;
  readonly prepareProviderInvocation: PrepareProviderInvocation;
  readonly requestDiagnostics?: ProviderRequestDiagnostics;
  readonly readStreamTimeoutPolicy: () => StreamTimeoutPolicy;
}

/**
 * Project the agent runtime context onto the direct-message port. Called at
 * the composition edge so the processor never receives the wider context.
 */
export function directMessagePorts(
  context: AgentRuntimeContext,
): DirectMessagePorts {
  return {
    state: context.state,
    telemetry: context.telemetry,
    history: context.history,
    mediaAdmission: context.mediaAdmission,
    prepareProviderInvocation: context.prepareProviderInvocation,
    requestDiagnostics: context.requestDiagnostics,
    readStreamTimeoutPolicy: context.readStreamTimeoutPolicy,
  };
}
