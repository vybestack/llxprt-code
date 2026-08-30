/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { type IModel } from './IModel.js';
import { type ITool } from './ITool.js';
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { StructuredError } from '@vybestack/llxprt-code-core/core/turn.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { SystemPromptPlacement } from './utils/systemPromptPlacement.js';
import type {
  ProviderTelemetryContext,
  ResolvedAuthToken,
  SystemPromptAssembler,
  UserMemoryInput,
} from './types/providerRuntime.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';

export type ProviderToolset = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
    parameters?: unknown;
  }>;
}>;

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P06
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement REQ-SP2-001
 * @requirement:REQ-SP4-002
 * @requirement:REQ-SP4-003
 * @pseudocode base-provider-call-contract.md lines 1-3
 * @pseudocode provider-runtime-handling.md lines 10-16
 */
export interface GenerateChatOptions {
  contents: IContent[];
  tools?: ProviderToolset;
  settings?: SettingsService;
  config?: Config;
  runtime?: ProviderRuntimeContext;
  invocation?: RuntimeInvocationContext;
  onProviderError?: (error: StructuredError) => void;
  /**
   * Optional provider-neutral transport-liveness listener (issue #2607).
   * Providers that observe raw lifecycle evidence (e.g. an OpenAI Responses
   * `response.created` SSE event) invoke this to signal the connection is
   * alive even before any semantic IContent is produced.
   */
  onStreamLiveness?: (event: StreamLivenessEvent) => void;
  metadata?: Record<string, unknown>;
  promptEnvelopeTransportToken?: object;
  resolved?: {
    model?: string;
    baseURL?: string;
    authToken?: ResolvedAuthToken;
    telemetry?: ProviderTelemetryContext;
    temperature?: number;
    maxTokens?: number;
    streaming?: boolean;
  };
  userMemory?: UserMemoryInput;
  /**
   * Caller-supplied system instruction (e.g. a subagent persona/task prompt).
   * When present, providers SHOULD merge this into their system prompt so the
   * agent's directives reach the model. Issue #2410: without this field the
   * subagent persona built in generationConfig.systemInstruction never reaches
   * the provider, because the provider rebuilds its own generic core prompt.
   */
  systemInstruction?: string;
  /**
   * Caller-supplied re-renderer for the assembled system prompt (issue #3157).
   * A router provider (e.g. a load balancer) that overrides the model invokes
   * this after sub-profile selection so the rendered model matches
   * `resolved.model`. Assembly stays owned by the agent layer; this port only
   * re-invokes it.
   */
  systemPromptAssembler?: SystemPromptAssembler;
}

/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P06
 * @requirement REQ-SP2-001
 * @pseudocode base-provider-call-contract.md lines 3-5
 */
export interface IProvider {
  name: string;
  isDefault?: boolean;
  transportAttemptOwnership?: 'provider';
  getModels(): Promise<IModel[]>;
  /**
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 4-15
   */
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: ProviderToolset,
    signal?: AbortSignal,
  ): AsyncIterableIterator<IContent>;

  /**
   * Project the finalized prompt envelope for token estimation (issue #2817).
   *
   * The provider builds its real request representation using the same
   * preparation path transport consumes, then returns a pure projection of the
   * prompt-bearing fields. The agent layer derives an estimate without ever
   * reconstructing the provider payload.
   *
   * Providers that cannot project their finalized envelope resolve to
   * `undefined`, which signals the capability is unavailable for that
   * protocol. Callers must treat `undefined` as "no estimate", never as an
   * error.
   *
   * @requirement:REQ-PE-001 (issue #2817 acceptance A3, A4, A5)
   */
  projectPromptEnvelope?(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection | undefined>;
  getCurrentModel?(): string;
  getDefaultModel(): string;
  /**
   * Declares WHERE this provider can accept the assembled system prompt for
   * the given request (issue #3136/#3172).
   *
   * This is a declaration, not a decision: it is consumed by the shared
   * placement policy in `utils/systemPromptPlacement.ts` so that providers do
   * not re-derive placement from transport details. Callers resolve runtime
   * auth-token providers first and pass the resolved token string so placement
   * and transport share one credential fact.
   *
   * Omitting it means `system-field`. Anthropic returns `context-prefix` when
   * the resolved token is OAuth, because its `system` field may carry only the
   * Claude Code string and the real prompt must go at the top of the context.
   */
  getSystemPromptPlacement?(
    options: GenerateChatOptions,
  ): SystemPromptPlacement;
  // Methods for updating provider configuration
  getToolFormat?(): string;
  isPaidMode?(): boolean;

  /**
   * Set model parameters to be included in API calls
   * @param params Parameters to merge with existing, or undefined to clear all
   */
  getModelParams?(): Record<string, unknown> | undefined;

  /**
   * Return the effective context limit (token window) for this provider, or
   * undefined when it cannot be determined. Used by the agent layer to compute
   * proactive compression thresholds (e.g. for load-balancer pools).
   */
  getContextLimit?(): number | undefined;

  /**
   * Clear authentication cache (for OAuth logout)
   */
  clearAuthCache?(): void;

  /**
   * Clear authentication settings (keys and keyfiles)
   */
  clearAuth?(): void;
}

// Re-export the interfaces for convenience
export type { IModel, ITool };
