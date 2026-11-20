/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers/fake/FakeProvider.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import {
  publishProviderFallbackCandidate,
  type ProviderFallbackCandidate,
} from '../providerFallbackCandidate.js';

export function fallbackRow(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `fallback row ${index}` }],
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: Math.floor(index / 2) + 1,
        step: (index % 2) + 1,
        recordedAt: 0,
      },
      ...(index % 2 === 1
        ? { responsesStored: true, id: `stored-${index}` }
        : {}),
    },
  };
}

export function nativeFallback(
  history: HistoryService,
  targetTokenCount: number,
  applyResult: (candidate: ProviderFallbackCandidate) => Promise<void> = (
    candidate,
  ) => publishProviderFallbackCandidate(history, candidate, 'test-model'),
): ReturnType<typeof runDiskProviderFallback> {
  const runtime = buildRuntimeContext(history);
  const provider = new FakeProvider('/dev/null');
  return runDiskProviderFallback(
    applyResult,
    'indexed-fallback',
    runtime,
    undefined,
    history,
    () => Promise.resolve({ provider, runtime: runtime.providerRuntime }),
    undefined,
    undefined,
    new DebugLogger('native-fallback-test'),
    { targetTokenCount },
  );
}
