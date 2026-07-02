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

import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  PartListUnion,
  SendMessageParameters,
} from '@google/genai';
import type { UserTierId } from '../code_assist/types.js';
import type { ContentGeneratorConfig } from './contentGenerator.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import type { CompletedToolCall } from '../scheduler/types.js';
import type {
  PerformCompressionResult,
  ServerGeminiStreamEvent,
} from './turn.js';
import type { StreamEvent } from './chatSessionTypes.js';
import type { Config } from '../config/config.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { ToolSchedulerFactory } from './toolSchedulerContract.js';
import type { TaskToolRegistration } from '../config/toolRegistryFactory.js';

export interface AgentChatContract {
  sendMessageStream(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>>;
  getHistory(): Content[];
  setHistory(history: Content[]): void;
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
  getHistory(): Promise<Content[]>;
  getHistoryService(): HistoryService | null;
  storeHistoryServiceForReuse(service: HistoryService): void;
  storeHistoryForLaterUse(history: Content[]): void;
  dispose(): void;
  setTools(): Promise<void>;
  clearTools(): void;
  updateSystemInstruction(): Promise<void>;
  addHistory(content: Content): Promise<void>;
  resetChat(): Promise<void>;
  resumeChat(history: Content[]): Promise<void>;
  setHistory(
    history: Content[],
    options?: { stripThoughts?: boolean },
  ): Promise<void>;
  restoreHistory(historyItems: IContent[]): Promise<void>;
  addDirectoryContext(): Promise<void>;
  getContentGenerator(): ContentGenerator;
  startChat(extraHistory?: Content[]): Promise<AgentChatContract>;
  generateDirectMessage(
    params: SendMessageParameters,
    promptId: string,
  ): Promise<GenerateContentResponse>;
  generateJson(
    contents: Content[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config?: GenerateContentConfig,
  ): Promise<Record<string, unknown>>;
  generateContent(
    contents: Content[],
    generationConfig: GenerateContentConfig,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<GenerateContentResponse>;
  generateEmbedding(texts: string[]): Promise<number[][]>;
  sendMessageStream(
    initialRequest: PartListUnion,
    signal: AbortSignal,
    prompt_id: string,
    turns?: number,
    isInvalidStreamRetry?: boolean,
    is413Retry?: boolean,
  ): AsyncGenerator<ServerGeminiStreamEvent, unknown>;
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
