/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { ProviderContentEnforcer } from '../providerContentEnforcement.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
const logger = new DebugLogger('test:provider-curated-recomposition');
export async function recomposeFixture(
  history: HistoryService,
  pending: IContent[],
): Promise<IContent[]> {
  let projection = 0;
  const enforcer = new ProviderContentEnforcer({
    historyService: history,
    runtimeContext: buildRuntimeContext(history, {
      contextLimit: 100_000,
      compressionThreshold: 0.5,
    }),
    generationConfig: {},
    providerRuntimeNullable: undefined,
    logger,
    ensureDensityOptimized: async () => {},
    performCompression: async () => {
      throw new Error('unexpected compression');
    },
    performFallbackCompression: async () => {
      throw new Error('unexpected fallback');
    },
    getPromptTokenBaseline: () => null,
    resetPromptTokenBaseline: () => {},
    restorePromptTokenBaseline: () => {},
    estimateFinalizedPromptTokens: async () =>
      ++projection === 1 ? 80_000 : 1,
  });
  return enforcer.enforce(
    { contents: [], pendingContents: pending },
    'curated-stream',
  );
}
