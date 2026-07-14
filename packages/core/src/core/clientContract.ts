/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-API-001
 * @requirement REQ-INV-001
 *
 * Core-owned structural contract for the agent client surface.
 * Stays in core when AgentClient class moves to the agents package.
 * Concrete AgentClient implements this interface.
 *
 * Member list derived mechanically from call sites:
 * - config/config.ts (initialize, initializeContentGeneratorConfig)
 * - config/configBaseCore.ts (getAgentClient return type)
 * - utils/summarizer.ts (generateContent)
 * - utils/llm-edit-fixer.ts (generateJson)
 * - utils/checkpointUtils.ts (getHistory)
 * - CLI consumers (14+ files: sendMessageStream, setTools, updateSystemInstruction, etc.)
 */

import type { UserTierId } from '../code_assist/types.js';
import type { ContentGeneratorConfig } from './contentGenerator.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import type { CompletedToolCall } from '../scheduler/types.js';
import type {
  PerformCompressionResult,
  ServerAgentStreamEvent,
} from './turn.js';
import type { StreamEvent } from './chatSessionTypes.js';
import type { Config } from '../config/config.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { ToolSchedulerFactory } from './toolSchedulerContract.js';
import type { TaskToolRegistration } from '../config/toolRegistryFactory.js';
import type { ModelOutput } from '../llm-types/modelEnvelope.js';
import type { AgentMessageInput } from '../llm-types/agentMessageInput.js';

/**
 * Neutral request-input type for the agent-client send surface.
 *
 * Aliases the neutral {@link AgentMessageInput} contract — accepts text,
 * neutral ContentBlock[], or pre-built IContent turn(s). Never a provider
 * Part/role shape; legacy input must be converted via
 * iContentFromLegacyInput at the boundary before reaching this type.
 */
export type AgentRequestInput = AgentMessageInput;

/**
 * Neutral message parameters for the agent-client send surface.
 *
 * Replaces the former ContractSendMessageParameters. The message field
 * accepts AgentRequestInput (neutral AgentMessageInput).
 */
export interface AgentClientMessageParams {
  message: AgentRequestInput;
  config?: AgentClientGenerateConfig;
}

/**
 * Neutral generation config for the agent-client surface. Carries only
 * the fields the contract surface references. Concrete AgentClient
 * implementations accept provider-native config objects that are
 * structurally wider (tools, toolConfig, abortSignal, etc.); those are
 * assignable to this minimal shape via structural typing.
 */
export interface AgentClientGenerateConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  abortSignal?: AbortSignal;
  tools?: unknown;
  toolConfig?: unknown;
  systemInstruction?: unknown;
}

export interface AgentChatContract {
  sendMessage(
    params: AgentClientMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput>;
  sendMessageStream(
    params: AgentClientMessageParams,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>>;
  generateDirectMessage(
    params: AgentClientMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput>;
  getHistory(): IContent[];
  setHistory(history: IContent[]): void;
  clearHistory(): void;
  getHistoryService(): HistoryService | null;
  wasRecentlyCompressed(): boolean;
  performCompression(promptId: string): Promise<PerformCompressionResult>;
  recordCompletedToolCalls(
    model: string,
    completedToolCalls: CompletedToolCall[],
  ): void;
}

/**
 * Structural contract for the agent client.
 * Core-owned; the concrete AgentClient class implements this.
 */
export interface AgentClientContract {
  initialize(config: ContentGeneratorConfig): Promise<void>;
  isInitialized(): boolean;
  hasChatInitialized(): boolean;
  getChat(): AgentChatContract;
  getHistory(): Promise<IContent[]>;
  getHistoryService(): HistoryService | null;
  storeHistoryServiceForReuse(service: HistoryService): void;
  storeHistoryForLaterUse(history: IContent[]): void;
  dispose(): void;
  setTools(): Promise<void>;
  clearTools(): void;
  updateSystemInstruction(): Promise<void>;
  addHistory(content: IContent): Promise<void>;
  resetChat(): Promise<void>;
  resumeChat(history: IContent[]): Promise<void>;
  setHistory(
    history: IContent[],
    options?: { stripThoughts?: boolean },
  ): Promise<void>;
  restoreHistory(historyItems: IContent[]): Promise<void>;
  addDirectoryContext(): Promise<void>;
  getContentGenerator(): ContentGenerator;
  startChat(extraHistory?: IContent[]): Promise<AgentChatContract>;
  generateDirectMessage(
    params: AgentClientMessageParams,
    promptId: string,
  ): Promise<ModelOutput>;
  generateJson(
    contents: IContent[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config?: AgentClientGenerateConfig,
  ): Promise<Record<string, unknown>>;
  generateContent(
    contents: IContent[],
    generationConfig: AgentClientGenerateConfig,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<ModelOutput>;
  generateEmbedding(texts: string[]): Promise<number[][]>;
  sendMessageStream(
    initialRequest: AgentRequestInput,
    signal: AbortSignal,
    prompt_id: string,
    turns?: number,
    isInvalidStreamRetry?: boolean,
    is413Retry?: boolean,
  ): AsyncGenerator<ServerAgentStreamEvent, unknown>;
  getUserTier(): UserTierId | undefined;
  getCurrentSequenceModel(): string | null;
}

/**
 * Factory type for creating AgentClient instances.
 * Injected into Config via ConfigParameters.agentClientFactory.
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-001
 */
export type AgentClientFactory = (
  config: Config,
  runtimeState: AgentRuntimeState,
) => AgentClientContract;

/**
 * Aggregation of the three agent-runtime factory primitives the composition
 * root wires into Config. Single source of truth — both agents and providers
 * import this from core (no duplicated structural re-declaration).
 */
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: AgentClientFactory;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}
