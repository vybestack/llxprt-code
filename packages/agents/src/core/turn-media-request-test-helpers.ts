/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { CompressionHandler } from '../compression/CompressionHandler.js';
import { buildRuntimeContext } from './__tests__/chatSession-density-helpers.js';
const provider: RuntimeProvider = {
  name: 'test-provider',
  getModels: async () => [],
  generateChatCompletion: () => {
    throw new Error('unexpected send');
  },
};

export function mediaRequestFixture(history: HistoryService): {
  runtimeContext: ReturnType<typeof buildRuntimeContext>;
  compressionHandler: CompressionHandler;
  provider: RuntimeProvider;
} {
  const base = buildRuntimeContext(history, { contextLimit: 1_000_000 });
  const runtimeContext = {
    ...base,
    telemetry: { ...base.telemetry, logApiRequest: () => {} },
  };
  const compressionHandler = new CompressionHandler(
    runtimeContext,
    history,
    {},
    () => {
      throw new Error('unexpected compression');
    },
    async () => {},
  );
  return { runtimeContext, compressionHandler, provider };
}
