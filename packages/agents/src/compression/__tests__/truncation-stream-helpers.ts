import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

export class TruncationStreamHistory extends HistoryService {
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager strategy preparation is forbidden',
    );
  }

  override replaceAll(): Promise<void> {
    throw new Error('eager strategy candidate is forbidden');
  }
}

export function truncationHandler(
  history: HistoryService,
  hook: ConstructorParameters<typeof CompressionHandler>[4] = async () => {},
): CompressionHandler {
  history.setTokenizerFactory(exactTokenizer());
  return new CompressionHandler(
    buildRuntimeContext(history, {
      compressionStrategy: 'top-down-truncation',
      contextLimit: 100,
      compressionThreshold: 0.5,
    }),
    history,
    {},
    () => {
      throw new Error('Truncation cannot use a summarizing provider');
    },
    hook,
  );
}

export function truncationRow(index: number, bytes = 2048): IContent {
  const row = suffixRow(index, bytes);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      cacheAnchor: index === 0,
      ...(index === 0
        ? { semanticMediaPurgeFrontier: { contentIndex: 1, blockIndex: 0 } }
        : {}),
    },
  };
}

export async function collectRows(
  history: HistoryService,
): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of history.getComprehensive()) rows.push(row);
  return rows;
}
