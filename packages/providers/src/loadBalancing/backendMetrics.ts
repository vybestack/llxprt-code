/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 4/5
 * Backend metrics collection and token extraction for load-balancer
 * backends. Extracted from LoadBalancingProvider.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { BackendMetrics } from '../LoadBalancingProvider.js';

export class BackendMetricsCollector {
  constructor(private readonly metrics: Map<string, BackendMetrics>) {}

  static createInitialMetrics(): BackendMetrics {
    return {
      requests: 0,
      successes: 0,
      failures: 0,
      timeouts: 0,
      tokens: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
    };
  }

  recordRequestStart(profileName: string): number {
    let entry = this.metrics.get(profileName);
    if (!entry) {
      entry = BackendMetricsCollector.createInitialMetrics();
      this.metrics.set(profileName, entry);
    }
    entry.requests++;
    return Date.now();
  }

  recordRequestSuccess(
    profileName: string,
    startTime: number,
    tokensUsed: number,
  ): void {
    const entry = this.metrics.get(profileName);
    if (!entry) {
      return;
    }

    const latency = Date.now() - startTime;
    entry.successes++;
    entry.tokens += tokensUsed;
    entry.totalLatencyMs += latency;
    entry.avgLatencyMs = entry.totalLatencyMs / entry.requests;
  }

  recordRequestFailure(
    profileName: string,
    startTime: number,
    isTimeout: boolean,
  ): void {
    const entry = this.metrics.get(profileName);
    if (!entry) {
      return;
    }

    const latency = Date.now() - startTime;
    entry.failures++;
    entry.totalLatencyMs += latency;
    entry.avgLatencyMs = entry.totalLatencyMs / entry.requests;

    if (isTimeout) {
      entry.timeouts++;
    }
  }

  /**
   * Extract token count from response chunks across Gemini, Anthropic, and
   * OpenAI usage-metadata formats.
   */
  static extractTokenCount(chunks: IContent[]): number {
    // Runtime-widen to handle potential null/undefined from provider edge cases
    const chunksRuntime: unknown = chunks;
    if (!Array.isArray(chunksRuntime) || chunksRuntime.length === 0) {
      return 0;
    }

    // Look for usage information in the last chunk (common pattern)
    const lastChunk = chunksRuntime[
      chunksRuntime.length - 1
    ] as unknown as Record<string, unknown>;

    const geminiTokens = extractGeminiTokens(lastChunk);
    if (geminiTokens > 0) {
      return geminiTokens;
    }

    const anthropicTokens = extractAnthropicTokens(lastChunk);
    if (anthropicTokens > 0) {
      return anthropicTokens;
    }

    return extractOpenAITokens(lastChunk);
  }
}

function extractGeminiTokens(lastChunk: Record<string, unknown>): number {
  const usageMetadataRuntime: unknown = lastChunk.usageMetadata;
  if (
    typeof usageMetadataRuntime !== 'object' ||
    usageMetadataRuntime === null
  ) {
    return 0;
  }
  const usageMetadata = usageMetadataRuntime as Record<string, unknown>;
  const promptTokenCount =
    typeof usageMetadata.promptTokenCount === 'number'
      ? usageMetadata.promptTokenCount
      : 0;
  const candidatesTokenCount =
    typeof usageMetadata.candidatesTokenCount === 'number'
      ? usageMetadata.candidatesTokenCount
      : 0;
  if (promptTokenCount > 0 || candidatesTokenCount > 0) {
    return promptTokenCount + candidatesTokenCount;
  }
  return 0;
}

function extractAnthropicTokens(lastChunk: Record<string, unknown>): number {
  const usageRuntime: unknown = lastChunk.usage;
  if (typeof usageRuntime !== 'object' || usageRuntime === null) {
    return 0;
  }
  const usage = usageRuntime as Record<string, unknown>;
  const inputTokens =
    typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
  const outputTokens =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
  if (inputTokens > 0 || outputTokens > 0) {
    return inputTokens + outputTokens;
  }
  return 0;
}

function extractOpenAITokens(lastChunk: Record<string, unknown>): number {
  const usageRuntime: unknown = lastChunk.usage;
  if (typeof usageRuntime !== 'object' || usageRuntime === null) {
    return 0;
  }
  const usage = usageRuntime as Record<string, unknown>;
  const promptTokens =
    typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
  const completionTokens =
    typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
  if (promptTokens > 0 || completionTokens > 0) {
    return promptTokens + completionTokens;
  }
  return 0;
}
