import { chatSessionPorts } from '../../../core/chatSessionPorts.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { ProviderFallbackCandidate } from '../../providerFallbackCandidate.js';
import { CompressionHandler } from '../../CompressionHandler.js';

type DiskFallback = (
  promptId: string,
  install: (candidate: ProviderFallbackCandidate) => Promise<void>,
  targetTokenCount?: number,
) => Promise<boolean>;

export interface HandlerHarness {
  handler: CompressionHandler;
  performCompression: ReturnType<typeof spyPerformCompression>;
  /** Replaces the disk fallback stage; the rest of the ladder stays real. */
  setDiskFallback: (fallback: DiskFallback) => void;
}

function spyPerformCompression(handler: CompressionHandler) {
  return vi
    .spyOn(handler, 'performCompression')
    .mockResolvedValue(PerformCompressionResult.NOOP);
}

/**
 * A real CompressionHandler over a real HistoryService. Compression itself is
 * a spy (default NOOP) so tests decide what it does to the history; density
 * optimisation is a no-op and the disk fallback defaults to "not applied"
 * unless `realDiskFallback` keeps the handler's own TopDownTruncation fallback.
 */
export function buildHandlerHarness(
  history: HistoryService,
  runtimeContext: AgentRuntimeContext,
  options: {
    realDiskFallback?: boolean;
    generationConfig?: Record<string, unknown>;
  } = {},
): HandlerHarness {
  const handler = new CompressionHandler(
    chatSessionPorts(runtimeContext).compression,
    undefined,
    history,
    undefined,
    undefined,
    undefined,
    undefined,
    options.generationConfig ?? {},
    () => {
      throw new Error(
        'This ladder fixture must not resolve a summary provider',
      );
    },
    async () => {},
  );
  vi.spyOn(handler, 'ensureDensityOptimized').mockResolvedValue(undefined);
  const performCompression = spyPerformCompression(handler);
  if (options.realDiskFallback !== true)
    handler['performProviderDiskFallback'] = async () => false;
  return {
    handler,
    performCompression,
    setDiskFallback: (fallback) => {
      handler['performProviderDiskFallback'] = fallback;
    },
  };
}
