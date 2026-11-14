/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { FallbackTransactionDeps } from '../../providerFallbackTransaction.js';
import { buildHandlerHarness } from './handler-harness.js';
import { enforceProviderSourceForTest } from './enforce-provider-source.js';

interface FallbackTransactionHost {
  fallbackTransactionDeps: () => FallbackTransactionDeps;
}

export interface EnforceWithHandlerOptions {
  history: HistoryService;
  runtimeContext: AgentRuntimeContext;
  pending: IContent[];
  promptId: string;
  generationConfig?: Record<string, unknown>;
  performCompression?: () => Promise<PerformCompressionResult>;
  /** Replaces the fallback transaction's dependencies (fallback stage, baseline ownership). */
  fallbackDeps?: Partial<FallbackTransactionDeps>;
  /** Measures every candidate over its materialised rows. */
  estimateRows?: (rows: IContent[]) => Promise<number>;
}

/**
 * Drives a real CompressionHandler source ladder for body-evidence tests that
 * assert the rows (and wire bytes) the ladder hands to the provider.
 */
export async function enforceWithHandler(
  options: EnforceWithHandlerOptions,
): Promise<IContent[]> {
  const harness = buildHandlerHarness(options.history, options.runtimeContext, {
    realDiskFallback: true,
    generationConfig: options.generationConfig,
  });
  if (options.performCompression !== undefined)
    harness.performCompression.mockImplementation(options.performCompression);
  if (options.fallbackDeps !== undefined) {
    const host = harness.handler as unknown as FallbackTransactionHost;
    const base = host.fallbackTransactionDeps.bind(harness.handler);
    const overrides = options.fallbackDeps;
    host.fallbackTransactionDeps = () => ({ ...base(), ...overrides });
  }
  return enforceProviderSourceForTest(
    harness.handler,
    options.history,
    options.pending,
    options.promptId,
    undefined,
    options.estimateRows,
  );
}
