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

/**
 * Structural shapes matching the portions of the @google/genai SDK types used
 * by the agent-client contract surface. Defined locally so core does not
 * import @google/genai; the concrete AgentClient (agents package, #2349)
 * supplies objects that are structurally compatible with these shapes.
 *
 * These intentionally model only the fields the contract surface references;
 * they are NOT a full re-declaration of the SDK types.
 */

interface ContractFunctionCall {
  id?: string;
  args?: Record<string, unknown>;
  name?: string;
}

interface ContractFunctionResponse {
  id?: string;
  name?: string;
  response?: Record<string, unknown>;
}

export interface ContractPart {
  text?: string;
  inlineData?: { data?: string; mimeType?: string; displayName?: string };
  functionCall?: ContractFunctionCall;
  functionResponse?: ContractFunctionResponse;
  fileData?: { fileUri?: string; mimeType?: string; displayName?: string };
  thought?: boolean;
  thoughtSignature?: string;
}

export type ContractPartListUnion =
  | ContractPart
  | string
  | Array<ContractPart | string>;

export interface ContractContent {
  role?: string;
  parts?: ContractPart[];
}

export type ContractContentUnion =
  | ContractContent
  | ContractPart
  | string
  | Array<ContractPart | string>;

export interface ContractGenerateContentConfig {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  systemInstruction?: ContractContentUnion;
  abortSignal?: AbortSignal;
  tools?: unknown;
  toolConfig?: unknown;
}

export interface ContractGenerateContentResponse {
  text?: string;
  data: unknown | undefined;
  functionCalls: ContractFunctionCall[] | undefined;
  executableCode: unknown | undefined;
  codeExecutionResult: unknown | undefined;
  candidates?: Array<{
    content?: { role?: string; parts?: ContractPart[] };
    finishReason?: string;
    index?: number;
    safetyRatings?: unknown[];
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
    toolUsePromptTokenCount?: number;
  };
}

export interface ContractSendMessageParameters {
  message: ContractPartListUnion;
  config?: ContractGenerateContentConfig;
}

export interface AgentChatContract {
  sendMessageStream(
    params: ContractSendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>>;
  getHistory(): ContractContent[];
  setHistory(history: ContractContent[]): void;
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
  getHistory(): Promise<ContractContent[]>;
  getHistoryService(): HistoryService | null;
  storeHistoryServiceForReuse(service: HistoryService): void;
  storeHistoryForLaterUse(history: ContractContent[]): void;
  dispose(): void;
  setTools(): Promise<void>;
  clearTools(): void;
  updateSystemInstruction(): Promise<void>;
  addHistory(content: ContractContent): Promise<void>;
  resetChat(): Promise<void>;
  resumeChat(history: ContractContent[]): Promise<void>;
  setHistory(
    history: ContractContent[],
    options?: { stripThoughts?: boolean },
  ): Promise<void>;
  restoreHistory(historyItems: IContent[]): Promise<void>;
  addDirectoryContext(): Promise<void>;
  getContentGenerator(): ContentGenerator;
  startChat(extraHistory?: ContractContent[]): Promise<AgentChatContract>;
  generateDirectMessage(
    params: ContractSendMessageParameters,
    promptId: string,
  ): Promise<ContractGenerateContentResponse>;
  generateJson(
    contents: ContractContent[],
    schema: Record<string, unknown>,
    abortSignal: AbortSignal,
    model: string,
    config?: ContractGenerateContentConfig,
  ): Promise<Record<string, unknown>>;
  generateContent(
    contents: ContractContent[],
    generationConfig: ContractGenerateContentConfig,
    abortSignal: AbortSignal,
    model: string,
  ): Promise<ContractGenerateContentResponse>;
  generateEmbedding(texts: string[]): Promise<number[][]>;
  sendMessageStream(
    initialRequest: ContractPartListUnion,
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
