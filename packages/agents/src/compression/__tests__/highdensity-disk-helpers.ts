import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  middleoutSetup,
  middleoutRow,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
export class HighdensityDiskHistory extends MiddleoutDiskHistory {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager high-density getAll forbidden',
    );
  }
}

export class HighdensityPreparationHistory extends HighdensityDiskHistory {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager high-density preparation materialization forbidden',
    );
  }
}

export function highdensityRow(index: number, bytes = 2048): IContent {
  const row = middleoutRow(index, bytes);
  return index === 1
    ? { ...row, metadata: { ...row.metadata, cacheAnchor: true } }
    : row;
}

export function highdensitySetup(
  ...args: Parameters<typeof middleoutSetup>
): ReturnType<typeof middleoutSetup> {
  return middleoutSetup(args[0], args[1], args[2], {
    contextLimit: 30000,
    ...args[3],
    compressionStrategy: 'high-density',
  });
}

export async function highdensityOracle(
  history: HistoryService,
  size: number,
  bytes = 2048,
  makeRow: (index: number, bytes: number) => IContent = highdensityRow,
  overrides: Parameters<typeof middleoutSetup>[3] = {},
): Promise<readonly IContent[]> {
  const { runtime, transport } = highdensitySetup(
    history,
    undefined,
    undefined,
    overrides,
  );
  const logger = new DebugLogger('test:highdensity-oracle');
  const raw = Array.from({ length: size }, (_, index) => makeRow(index, bytes));
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    undefined,
    undefined,
    logger,
  );
  const result = await new HighDensityStrategy().compress({
    ...metadata,
    history: buildCuratedHistory(logger, raw, false),
  });
  if (result.kind !== 'applied') return raw;
  return invalidateResponsesStatefulChain(
    annotateCompressionSpan(raw, result.newHistory).map((row) => {
      const metadata = { ...row.metadata };
      delete metadata.cacheAnchor;
      return { ...row, metadata };
    }),
  );
}
