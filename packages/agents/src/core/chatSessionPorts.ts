/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  PrepareProviderInvocation,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { ProfileDefinitionReads } from '@vybestack/llxprt-code-core/services/workspace-definition-owner.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { StreamTimeoutPolicy } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { ConversationRuntime } from './ConversationManager.js';
import {
  directMessagePorts,
  type DirectMessagePorts,
} from './directMessagePorts.js';

type RuntimeEphemerals = AgentRuntimeContext['ephemerals'];

/**
 * What ChatSession reads itself: session identity, the history it manages, the
 * provider adapter used for routing, the tool view it reports, and the few
 * session-level settings it answers for its callers.
 */
export interface ChatSessionRuntime {
  readonly state: AgentRuntimeState;
  readonly history: HistoryService;
  readonly provider: AgentRuntimeProviderAdapter;
  readonly tools: ToolRegistryView;
  readonly ephemerals: Pick<
    RuntimeEphemerals,
    'semanticMediaPurge' | 'contextLimit'
  >;
  readonly profileDefinitions?: Pick<ProfileDefinitionReads, 'loadProfile'>;
  readonly providerRuntime: ProviderRequestCollaborators;
  readonly prepareProviderInvocation: PrepareProviderInvocation;
  readonly mediaAdmission?: MediaAdmissionService;
  readonly readStreamTimeoutPolicy: () => StreamTimeoutPolicy;
  readonly readPromptCachingPolicy: () => unknown;
  readonly showCitations: () => boolean;
  readonly tokenUsageLoggingEnabled: boolean;
}

/**
 * What the streaming path reads: the runtime state for model and base URL, the
 * telemetry adapter, the history it admits output into, invocation
 * preparation, prompt estimation, request diagnostics, the media admission
 * gate and the reasoning inclusion policy.
 */
export interface StreamProcessorRuntime {
  readonly state: AgentRuntimeState;
  readonly provider: Pick<AgentRuntimeProviderAdapter, 'getActiveProvider'>;
  readonly telemetry: AgentRuntimeTelemetryAdapter;
  readonly history: HistoryService;
  readonly prepareProviderInvocation: PrepareProviderInvocation;
  readonly promptEstimator?: AgentRuntimeContext['promptEstimator'];
  readonly requestDiagnostics?: ProviderRequestDiagnostics;
  readonly mediaAdmission?: MediaAdmissionService;
  readonly ephemerals: Pick<RuntimeEphemerals, 'reasoning'>;
}

/**
 * What the non-streaming turn path reads: the streaming path's reads plus the
 * active-provider fallback used for generating-model attribution and the
 * stream idle-timeout policy.
 */
export interface TurnProcessorRuntime {
  readonly state: AgentRuntimeState;
  readonly telemetry: AgentRuntimeTelemetryAdapter;
  readonly history: HistoryService;
  readonly provider: Pick<AgentRuntimeProviderAdapter, 'getActiveProvider'>;
  readonly prepareProviderInvocation: PrepareProviderInvocation;
  readonly promptEstimator?: AgentRuntimeContext['promptEstimator'];
  readonly mediaAdmission?: MediaAdmissionService;
  readonly readStreamTimeoutPolicy: () => StreamTimeoutPolicy;
  readonly ephemerals: Pick<RuntimeEphemerals, 'reasoning'>;
}

/**
 * What compression reads: the model for budgeting, the history it compacts,
 * the compression and density ephemerals the strategies resolve through the
 * built context, the provider runtime snapshot and invocation preparation used
 * by verification calls, and the completion-budget setting.
 */
export interface CompressionHandlerRuntime {
  readonly state: AgentRuntimeState;
  readonly history: HistoryService;
  readonly ephemerals: Pick<
    RuntimeEphemerals,
    | 'compressionThreshold'
    | 'contextLimit'
    | 'preserveThreshold'
    | 'topPreserveThreshold'
    | 'compressionProfile'
    | 'compressionStrategy'
    | 'compressionVerification'
    | 'densityOptimizeThreshold'
    | 'densityReadWritePruning'
    | 'densityFileDedupe'
    | 'densityRecencyPruning'
    | 'densityRecencyRetention'
    | 'densityCompressHeadroom'
    | 'reasoning'
  >;
  readonly providerRuntime: ProviderRequestCollaborators;
  readonly prepareProviderInvocation: PrepareProviderInvocation;
  readonly readCompletionBudgetSetting: () => unknown;
}

/**
 * The collaborators a ChatSession is composed from. The factory projects the
 * runtime context onto each of them so the session and its processors never
 * hold the wider context.
 */
export interface ChatSessionPorts {
  readonly runtime: ChatSessionRuntime;
  readonly stream: StreamProcessorRuntime;
  readonly turn: TurnProcessorRuntime;
  readonly compression: CompressionHandlerRuntime;
  readonly direct: DirectMessagePorts;
  readonly conversation: ConversationRuntime;
}

/**
 * Project the agent runtime context onto the ChatSession ports. This is the
 * composition edge; every projected member is a reference the port declares,
 * never a call, so the projection cannot throw where the consumer would not
 * have read it anyway.
 */
export function chatSessionPorts(
  context: AgentRuntimeContext,
): ChatSessionPorts {
  return {
    runtime: {
      state: context.state,
      history: context.history,
      provider: context.provider,
      tools: context.tools,
      ephemerals: context.ephemerals,
      profileDefinitions: context.profileDefinitions,
      providerRuntime: context.providerRuntime,
      prepareProviderInvocation: context.prepareProviderInvocation,
      mediaAdmission: context.mediaAdmission,
      readStreamTimeoutPolicy: context.readStreamTimeoutPolicy,
      readPromptCachingPolicy: context.readPromptCachingPolicy,
      showCitations: context.showCitations,
      tokenUsageLoggingEnabled: context.tokenUsageLoggingEnabled,
    },
    stream: {
      state: context.state,
      provider: context.provider,
      telemetry: context.telemetry,
      history: context.history,
      prepareProviderInvocation: context.prepareProviderInvocation,
      promptEstimator: context.promptEstimator,
      requestDiagnostics: context.requestDiagnostics,
      mediaAdmission: context.mediaAdmission,
      ephemerals: context.ephemerals,
    },
    turn: {
      state: context.state,
      telemetry: context.telemetry,
      history: context.history,
      provider: context.provider,
      prepareProviderInvocation: context.prepareProviderInvocation,
      promptEstimator: context.promptEstimator,
      mediaAdmission: context.mediaAdmission,
      readStreamTimeoutPolicy: context.readStreamTimeoutPolicy,
      ephemerals: context.ephemerals,
    },
    compression: {
      state: context.state,
      history: context.history,
      ephemerals: context.ephemerals,
      providerRuntime: context.providerRuntime,
      prepareProviderInvocation: context.prepareProviderInvocation,
      readCompletionBudgetSetting: context.readCompletionBudgetSetting,
    },
    direct: directMessagePorts(context),
    conversation: {
      history: context.history,
      state: context.state,
      provider: context.provider,
      ephemerals: context.ephemerals,
    },
  };
}

/**
 * Rebuild the ports against a replacement history after a session rebind. Each
 * port is a plain projection of runtime values, so replacing the single
 * history member keeps every consumer pointed at the live service.
 */
export function rebindChatSessionPorts(
  ports: ChatSessionPorts,
  history: HistoryService,
): ChatSessionPorts {
  return {
    runtime: { ...ports.runtime, history },
    stream: { ...ports.stream, history },
    turn: { ...ports.turn, history },
    compression: { ...ports.compression, history },
    direct: { ...ports.direct, history },
    conversation: { ...ports.conversation, history },
  };
}
