/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.1, REQ-STAT6-002.2
 * @pseudocode agent-runtime-context.md lines 5-17
 *
 * Immutable snapshot of ephemeral settings for agent runtime.
 * These settings can change frequently and are not part of core runtime state.
 */
export interface ReadonlySettingsSnapshot {
  /** Compression threshold for history (0.0-1.0), default 0.8 */
  compressionThreshold?: number;
  /** Context window limit in tokens (provider default when unspecified) */
  contextLimit?: number;
  /** Preserve threshold for compression (0.0-1.0), default 0.2 */
  preserveThreshold?: number;
  /** Preserve threshold for top of conversation (0.0-1.0), default 0.2 */
  topPreserveThreshold?: number;
  /** Override for tool format string, optional */
  toolFormatOverride?: string;
  /** Telemetry configuration */
  telemetry?: {
    enabled: boolean;
    target: TelemetryTarget | null;
    redaction?: TelemetryRedactionConfig;
  };
  /** Tool governance derived from profile ephemerals */
  tools?: {
    allowed?: string[];
    disabled?: string[];
  };
  /** Emoji filter mode for subagent output */
  emojifilter?: 'allowed' | 'auto' | 'warn' | 'error';
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.1 */
  'reasoning.enabled'?: boolean;
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.2 */
  'reasoning.includeInContext'?: boolean;
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.3 */
  'reasoning.includeInResponse'?: boolean;
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.4 */
  'reasoning.format'?: 'native' | 'field';
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.5 */
  'reasoning.stripFromContext'?: 'all' | 'allButLast' | 'none';
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.6 */
  'reasoning.effort'?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  /** @plan PLAN-20251202-THINKING.P03b @requirement REQ-THINK-006.7 */
  'reasoning.maxTokens'?: number;
  /** @issue #1307 - Anthropic adaptive thinking toggle for Opus 4.6+ */
  'reasoning.adaptiveThinking'?: boolean;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-002.3
 *
 * Redaction configuration for telemetry data.
 */
export interface TelemetryRedactionConfig {
  redactPrompts?: boolean;
  redactToolParams?: boolean;
  redactToolResults?: boolean;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-002.3
 *
 * Telemetry target enumeration.
 */
export enum TelemetryTarget {
  GCP = 'gcp',
  LOCAL = 'local',
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.1
 * @pseudocode agent-runtime-context.md lines 20-26
 *
 * Read-only view of tool registry.
 * Provides immutable access to tool metadata without exposing full registry.
 */
export interface ToolRegistryView {
  /** List all registered tool names */
  listToolNames(): string[];
  /** Get metadata for a specific tool by name */
  getToolMetadata(name: string): ToolMetadata | undefined;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.1
 *
 * Tool metadata interface.
 */
export interface ToolMetadata {
  name: string;
  description: string;
  parameterSchema?: Record<string, unknown>;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-002.3
 *
 * API request event metadata for telemetry.
 */
export interface ApiRequestEvent {
  model: string;
  promptId?: string;
  requestText?: string;
  sessionId?: string;
  runtimeId?: string;
  provider?: string;
  timestamp?: number;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-002.3
 *
 * API response event metadata for telemetry.
 */
export interface ApiResponseEvent {
  model: string;
  promptId?: string;
  durationMs: number;
  sessionId?: string;
  runtimeId?: string;
  provider?: string;
  timestamp?: number;
  usageMetadata?: GenerateContentResponseUsageMetadata;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  responseText?: string;
  error?: string;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-002.3
 *
 * API error event metadata for telemetry.
 */
export interface ApiErrorEvent {
  model: string;
  promptId?: string;
  durationMs: number;
  error: string;
  errorType?: string;
  statusCode?: number | string;
  sessionId?: string;
  runtimeId?: string;
  provider?: string;
  timestamp?: number;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.2, REQ-STAT6-002.2, REQ-STAT6-002.3
 * @pseudocode agent-runtime-context.md lines 28-49
 *
 * Immutable runtime context for agent execution.
 * Provides all runtime data and adapters without Config dependency.
 * All nested objects are frozen for deep immutability.
 */
export interface AgentRuntimeContext {
  /** Immutable runtime state (provider, model, auth, session) */
  readonly state: AgentRuntimeState;

  /** Isolated history service instance */
  readonly history: HistoryService;

  /** Ephemeral settings with fallback defaults */
  readonly ephemerals: {
    compressionThreshold(): number;
    contextLimit(): number;
    preserveThreshold(): number;
    topPreserveThreshold(): number;
    toolFormatOverride(): string | undefined;
    /**
     * @plan PLAN-20251202-THINKING.P03b
     * @requirement REQ-THINK-006
     */
    reasoning: {
      enabled(): boolean;
      includeInContext(): boolean;
      includeInResponse(): boolean;
      format(): 'native' | 'field';
      stripFromContext(): 'all' | 'allButLast' | 'none';
      effort(): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
      maxTokens(): number | undefined;
      adaptiveThinking(): boolean | undefined;
    };
  };

  /** Telemetry logging adapter with metadata enrichment */
  readonly telemetry: AgentRuntimeTelemetryAdapter;

  /** Provider adapter (read-only or mutable based on context) */
  readonly provider: AgentRuntimeProviderAdapter;

  /** Tool registry read-only view */
  readonly tools: ToolRegistryView;

  /** Provider runtime snapshot for downstream provider calls */
  readonly providerRuntime: ProviderRuntimeContext;
}

/**
 * @plan PLAN-20251028-STATELESS6.P06
 * @requirement REQ-STAT6-001.1
 * @pseudocode agent-runtime-context.md lines 52-62
 *
 * Factory options for creating agent runtime contexts.
 * Supports both foreground (Config-backed) and subagent (isolated) modes.
 */
export interface AgentRuntimeContextFactoryOptions {
  /** Required: immutable runtime state */
  state: AgentRuntimeState;

  /** Required: snapshot of ephemeral settings */
  settings: ReadonlySettingsSnapshot;

  /** Required: provider adapter for active provider access */
  provider: AgentRuntimeProviderAdapter;

  /** Required: telemetry adapter */
  telemetry: AgentRuntimeTelemetryAdapter;

  /** Required: tools view */
  tools: ToolRegistryView;

  /** Optional: history service (creates isolated instance if not provided) */
  history?: HistoryService;

  /** Required: provider runtime context */
  providerRuntime: ProviderRuntimeContext;
}

// Type imports (these will be resolved from existing modules)
import type { AgentRuntimeState } from './AgentRuntimeState.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IProvider } from '../providers/IProvider.js';
import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import type { ProviderRuntimeContext } from './providerRuntimeContext.js';

/**
 * Provider adapter interface supplied to runtime context.
 */
export interface AgentRuntimeProviderAdapter {
  getActiveProvider(): IProvider;
  setActiveProvider(name: string): void;
  getProviderByName?(name: string): IProvider | undefined;
}

/**
 * Telemetry adapter interface supplied to runtime context.
 */
export interface AgentRuntimeTelemetryAdapter {
  logApiRequest(event: ApiRequestEvent): void;
  logApiResponse(event: ApiResponseEvent): void;
  logApiError(event: ApiErrorEvent): void;
}
