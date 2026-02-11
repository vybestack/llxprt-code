/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P02
 * @requirement REQ-CS-001.1, REQ-CS-001.4, REQ-CS-001.5, REQ-CS-001.6, REQ-CS-010.3
 *
 * Types and constants for the compression strategy module.
 */

import type { IContent } from '../../services/history/IContent.js';
import type { AgentRuntimeContext } from '../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../runtime/AgentRuntimeState.js';
import type { DebugLogger } from '../../debug/DebugLogger.js';
import type { IProvider } from '../../providers/IProvider.js';
import type { PromptResolver } from '../../prompt-config/prompt-resolver.js';
import type { PromptContext } from '../../prompt-config/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const COMPRESSION_STRATEGIES = [
  'middle-out',
  'top-down-truncation',
  'one-shot',
] as const;

export type CompressionStrategyName = (typeof COMPRESSION_STRATEGIES)[number];

// ---------------------------------------------------------------------------
// Core interfaces
// ---------------------------------------------------------------------------

export interface CompressionContext {
  readonly history: readonly IContent[];
  readonly runtimeContext: AgentRuntimeContext;
  readonly runtimeState: AgentRuntimeState;
  readonly estimateTokens: (contents: readonly IContent[]) => Promise<number>;
  readonly currentTokenCount: number;
  readonly logger: DebugLogger;
  readonly resolveProvider: (profileName?: string) => IProvider;
  readonly promptResolver: PromptResolver;
  readonly promptBaseDir: string;
  readonly promptContext: Readonly<Partial<PromptContext>>;
  readonly promptId: string;
}

export interface CompressionStrategy {
  readonly name: CompressionStrategyName;
  readonly requiresLLM: boolean;
  compress(context: CompressionContext): Promise<CompressionResult>;
}

export interface CompressionResult {
  newHistory: IContent[];
  metadata: CompressionResultMetadata;
}

export interface CompressionResultMetadata {
  originalMessageCount: number;
  compressedMessageCount: number;
  strategyUsed: CompressionStrategyName;
  llmCallMade: boolean;
  topPreserved?: number;
  bottomPreserved?: number;
  middleCompressed?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CompressionStrategyError extends Error {
  readonly code: string;
  readonly strategy?: string;
  readonly profile?: string;

  constructor(
    message: string,
    code: string,
    options?: { strategy?: string; profile?: string },
  ) {
    super(message);
    this.name = 'CompressionStrategyError';
    this.code = code;
    this.strategy = options?.strategy;
    this.profile = options?.profile;
  }
}

export class UnknownStrategyError extends CompressionStrategyError {
  constructor(strategyName: string) {
    super(`Unknown compression strategy: ${strategyName}`, 'UNKNOWN_STRATEGY', {
      strategy: strategyName,
    });
    this.name = 'UnknownStrategyError';
  }
}

export class PromptResolutionError extends CompressionStrategyError {
  constructor(promptId: string, cause?: string) {
    super(
      `Failed to resolve compression prompt "${promptId}"${cause ? `: ${cause}` : ''}`,
      'PROMPT_RESOLUTION_FAILED',
    );
    this.name = 'PromptResolutionError';
  }
}

export class CompressionExecutionError extends CompressionStrategyError {
  constructor(strategy: string, cause: string, profile?: string) {
    super(
      `Compression strategy "${strategy}" failed: ${cause}`,
      'EXECUTION_FAILED',
      { strategy, profile },
    );
    this.name = 'CompressionExecutionError';
  }
}
