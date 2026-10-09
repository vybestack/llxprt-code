/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi, expect } from 'bun:test';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
export function makeLogger(): DebugLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as DebugLogger;
}

export interface EnforcerHarness {
  enforcer: ProviderContentEnforcer;
  deps: ProviderContentEnforcementDeps;
  historyService: HistoryService;
  runtimeContext: AgentRuntimeContext;
}

export function buildEnforcerHarness(
  historyService: HistoryService,
  runtimeContext: AgentRuntimeContext,
  overrides: Partial<ProviderContentEnforcementDeps> = {},
): EnforcerHarness {
  const performCompression = vi.fn();
  const performFallbackCompression = vi.fn().mockResolvedValue(false);
  const ensureDensityOptimized = vi.fn().mockResolvedValue(undefined);
  const deps: ProviderContentEnforcementDeps = {
    historyService,
    runtimeContext,
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger: makeLogger(),
    ensureDensityOptimized,
    performCompression,
    performFallbackCompression,
    getPromptTokenBaseline: () => null,
    resetPromptTokenBaseline: () => {},
    restorePromptTokenBaseline: () => {},
    ...overrides,
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    deps,
    historyService,
    runtimeContext,
  };
}

export async function expectRestoredStreamingHistory(
  suite0_historyService: HistoryService,
): Promise<void> {
  await collectRowsForAssertions(
    suite0_historyService.getComprehensive(),
    async (contentsForAssertions) => {
      const texts = contentsForAssertions.map((entry) => {
        const block = entry.blocks[0];
        return block.type === 'text' ? block.text : `<${block.type}>`;
      });
      expect(texts).toStrictEqual([
        'restored-1',
        'restored-2',
        'late stream after restore',
      ]);
      // The truncation restore explicitly reset the post-truncation cache anchor.
      expect(suite0_historyService.getCacheAnchorSeq()).toBe(0);
    },
  );
}
