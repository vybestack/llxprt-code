/**
 * @plan:PLAN-20260608-ISSUE1585.P03
 * @requirement:REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolErrorType } from '../types/tool-error.js';

/** Request to execute a subagent. */
export interface SubagentRequest {
  /** Name of the subagent to execute. */
  name: string;
  /** Prompt or instruction for the subagent. */
  prompt: string;
  /** Optional working directory. */
  cwd?: string;
  /** Additional behavioural prompts to append after the primary prompt. */
  behaviourPrompts?: string[];
  /** American-spelling alias for behaviourPrompts. */
  behaviorPrompts?: string[];
  /** Optional tool whitelist for the subagent runtime. */
  toolWhitelist?: string[];
  /** Whether the request included an explicit whitelist even if it was empty. */
  hasExplicitToolWhitelist?: boolean;
  /** Expected variables the subagent should emit. */
  outputSpec?: Record<string, unknown>;
  /** Optional execution timeout in seconds. */
  timeoutSeconds?: number;
  /** Whether the caller requested background execution. */
  async?: boolean;
  /** Extra key/value context exposed to the subagent. */
  context?: Record<string, unknown>;
}

/** Runtime options supplied by the Task tool invocation. */
export interface SubagentExecutionOptions {
  /** Signal used to cancel foreground execution. */
  signal?: AbortSignal;
  /** Optional streaming callback for subagent progress output. */
  updateOutput?: (output: string) => void;
}

/** Result of a subagent execution. */
export interface SubagentResult {
  /** The output text from the subagent. */
  output: string;
  /** Whether the execution succeeded. */
  success: boolean;
  /** Error message if execution failed. */
  error?: string;
  /** Runtime agent id when execution launched. */
  agentId?: string;
  /** Termination reason from the subagent runtime. */
  terminateReason?: string;
  /** Variables emitted by the subagent runtime. */
  emittedVars?: Record<string, unknown>;
  /** Exact LLM content when the service owns legacy-compatible formatting. */
  llmContent?: string;
  /** Exact return display when the service owns legacy-compatible formatting. */
  returnDisplay?: string;
  /** Tool metadata produced by the service. */
  metadata?: Record<string, unknown>;
  /** Specific tool error type for failures. */
  errorType?: ToolErrorType;
}

/** Information about a discovered subagent. */
export interface SubagentInfo {
  /** Name of the subagent. */
  name: string;
  /** Description of the subagent. */
  description?: string;
  /** Associated profile name. */
  profile?: string;
  /** Last update timestamp. */
  updatedAt?: string;
}

/** Configuration for a subagent. */
export interface SubagentConfig {
  /** Name of the subagent. */
  name: string;
  /** Instructions or system prompt for the subagent. */
  instructions?: string;
  /** System prompt for the subagent. */
  systemPrompt?: string;
  /** The model to use. */
  model?: string;
  /** Associated profile name. */
  profile?: string;
  /** Last update timestamp. */
  updatedAt?: string;
  /** Additional configuration properties. */
  [key: string]: unknown;
}

export interface ISubagentService {
  /**
   * Execute a subagent with the given request.
   * @param request - The subagent execution request.
   * @returns The execution result.
   */
  executeSubagent(
    request: SubagentRequest,
    options?: SubagentExecutionOptions,
  ): Promise<SubagentResult>;

  /**
   * List all available subagents.
   * @returns Array of subagent information.
   */
  listSubagents(): Promise<SubagentInfo[]>;

  /**
   * Get configuration for a specific subagent.
   * @param name - The subagent name.
   * @returns The subagent configuration, or undefined if not found.
   */
  getSubagentConfig(name: string): Promise<SubagentConfig | undefined>;
}
