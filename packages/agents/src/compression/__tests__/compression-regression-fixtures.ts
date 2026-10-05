/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';

export function regressionHistory(label = 'turn'): IContent[] {
  return Array.from({ length: 24 }, (_, index) => ({
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${label} ${index}` }],
  }));
}

export function installSummaryTransport(
  provider: RuntimeProvider,
  send: () => Promise<string> = async () =>
    '<state_snapshot>summary</state_snapshot>',
): ReturnType<typeof vi.spyOn<RuntimeProvider, 'generateChatCompletion'>> {
  return vi
    .spyOn(provider, 'generateChatCompletion')
    .mockImplementation(async function* () {
      const text = await send();
      yield { speaker: 'ai', blocks: [{ type: 'text', text }] };
    });
}

export function observeDiskFallback(): ReturnType<
  typeof vi.spyOn<TopDownTruncationStrategy, 'compressDisk'>
> {
  return vi.spyOn(TopDownTruncationStrategy.prototype, 'compressDisk');
}

export function failDiskFallbackEstimation(
  history: HistoryService,
  failure: () => Error | undefined,
): void {
  vi.spyOn(history, 'estimateTokensForContents').mockImplementation(
    async () => {
      const error = failure();
      if (error !== undefined) throw error;
      return 0;
    },
  );
}

let clockNow = 0;

export function useCompressionClock(): void {
  clockNow = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clockNow);
}

export function advanceCompressionClock(milliseconds: number): void {
  clockNow += milliseconds;
}
