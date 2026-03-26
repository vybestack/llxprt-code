/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Foundational types, interfaces, enums, and simple value classes
 * for the subagent subsystem. This is the leaf of the dependency graph — all
 * other subagent modules depend on this, but it depends on none of them.
 *
 * Extracted from subagent.ts as part of Issue #1581.
 */

import type { Content, FunctionDeclaration, Part } from '@google/genai';
import type {
  AgentRuntimeContext,
  ReadonlySettingsSnapshot,
} from '../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '../runtime/AgentRuntimeLoader.js';
import type { ToolRegistry } from '../tools/tool-registry.js';

/**
 * Describes the possible termination modes for a subagent.
 * This enum provides a clear indication of why a subagent's execution might have ended.
 */
export enum SubagentTerminateMode {
  /**
   * Indicates that the subagent's execution terminated due to an unrecoverable error.
   */
  ERROR = 'ERROR',
  /**
   * Indicates that the subagent's execution terminated because it exceeded the maximum allowed working time.
   */
  TIMEOUT = 'TIMEOUT',
  /**
   * Indicates that the subagent's execution successfully completed all its defined goals.
   */
  GOAL = 'GOAL',
  /**
   * Indicates that the subagent's execution terminated because it exceeded the maximum number of turns.
   */
  MAX_TURNS = 'MAX_TURNS',
}

/**
 * Represents the output structure of a subagent's execution.
 * This interface defines the data that a subagent will return upon completion,
 * including any emitted variables and the reason for its termination.
 */
export interface OutputObject {
  /**
   * A record of key-value pairs representing variables emitted by the subagent
   * during its execution. These variables can be used by the calling agent.
   */
  emitted_vars: Record<string, string>;
  /**
   * The final natural language response produced by the subagent (if any).
   */
  final_message?: string;
  /**
   * The reason for the subagent's termination, indicating whether it completed
   * successfully, timed out, or encountered an error.
   */
  terminate_reason: SubagentTerminateMode;
}

/**
 * Configures the initial prompt for the subagent.
 */
export interface PromptConfig {
  /**
   * A single system prompt string that defines the subagent's persona and instructions.
   * Note: Use either `systemPrompt` or `initialMessages`, but not both.
   */
  systemPrompt?: string;

  /**
   * An array of user/model content pairs to seed the chat history for few-shot prompting.
   * Note: Use either `systemPrompt` or `initialMessages`, but not both.
   */
  initialMessages?: Content[];
}

/**
 * Configures the tools available to the subagent during its execution.
 */
export interface ToolConfig {
  /**
   * A list of tool names (from the tool registry) or full function declarations
   * that the subagent is permitted to use.
   */
  tools: Array<string | FunctionDeclaration>;
}

/**
 * Configures the expected outputs for the subagent.
 */
export interface OutputConfig {
  /**
   * A record describing the variables the subagent is expected to emit.
   * The subagent is prompted to generate these values before terminating.
   */
  outputs: Record<string, string>;
}

export interface SubAgentRuntimeOverrides {
  settingsSnapshot?: ReadonlySettingsSnapshot;
  toolRegistry?: ToolRegistry;
  environmentContextLoader?: (runtime: AgentRuntimeContext) => Promise<Part[]>;
  runtimeBundle?: AgentRuntimeLoaderResult;
  messageBus?: import('../index.js').MessageBus;
}

export type EnvironmentContextLoader = (
  runtime: AgentRuntimeContext,
) => Promise<Part[]>;

export const defaultEnvironmentContextLoader: EnvironmentContextLoader =
  async () => [];

/**
 * Configures the generative model parameters for the subagent.
 * This interface specifies the model to be used and its associated generation settings,
 * such as temperature and top-p values, which influence the creativity and diversity of the model's output.
 */
export interface ModelConfig {
  /**
   * The name or identifier of the model to use (e.g., 'gemini-2.5-pro').
   *
   * Routing-capable model selection can expand this contract later with a distinct sentinel value such as 'auto'.
   */
  model: string;
  /**
   * The temperature for the model's sampling process.
   */
  temp: number;
  /**
   * The top-p value for nucleus sampling.
   */
  top_p: number;
}

/**
 * Configures the execution environment and constraints for the subagent.
 * This interface defines parameters that control the subagent's runtime behavior,
 * such as maximum execution time, to prevent infinite loops or excessive resource consumption.
 *
 * Token-budget controls fit this interface without changing the current execution contract.
 */
export interface RunConfig {
  /** The maximum execution time for the subagent in minutes. */
  max_time_minutes: number;
  /**
   * The maximum number of conversational turns (a user message + model response)
   * before the execution is terminated. Helps prevent infinite loops.
   */
  max_turns?: number;
}

/**
 * Manages the runtime context state for the subagent.
 * This class provides a mechanism to store and retrieve key-value pairs
 * that represent the dynamic state and variables accessible to the subagent
 * during its execution.
 */
export class ContextState {
  private state: Record<string, unknown> = {};

  /**
   * Retrieves a value from the context state.
   *
   * @param key - The key of the value to retrieve.
   * @returns The value associated with the key, or undefined if the key is not found.
   */
  get(key: string): unknown {
    return this.state[key];
  }

  /**
   * Sets a value in the context state.
   *
   * @param key - The key to set the value under.
   * @param value - The value to set.
   */
  set(key: string, value: unknown): void {
    this.state[key] = value;
  }

  /**
   * Retrieves all keys in the context state.
   *
   * @returns An array of all keys in the context state.
   */
  get_keys(): string[] {
    return Object.keys(this.state);
  }
}

/**
 * Performs template string interpolation using ${var} syntax.
 * Throws if any required template variable is missing from the context.
 */
export function templateString(
  template: string,
  context: ContextState,
): string {
  const templateTokenRegex = /\$\{(\w+)\}/g;

  // First, find all unique keys required by the template.
  const requiredKeys = new Set(
    Array.from(template.matchAll(templateTokenRegex), (match) => match[1]),
  );

  // Check if all required keys exist in the context.
  const contextKeys = new Set(context.get_keys());
  const missingKeys = Array.from(requiredKeys).filter(
    (key) => !contextKeys.has(key),
  );

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing context values for the following keys: ${missingKeys.join(
        ', ',
      )}`,
    );
  }

  // Perform the replacement using a replacer function.
  return template.replace(templateTokenRegex, (_match, key) =>
    String(context.get(key)),
  );
}
