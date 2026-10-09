import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import {
  curatedFixtureRow,
  fixtureIncluded,
} from '../../../../core/src/services/history/curated-stream-test-helpers.js';

export type AttemptHook = ConstructorParameters<typeof CompressionHandler>[4];

export class AttemptHistory extends HistoryService {
  private strategiesStarted = false;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'Compression attempt materialized curated history',
      () => !this.strategiesStarted,
    );
  }

  override getStatistics(): ReturnType<HistoryService['getStatistics']> {
    throw new Error('Compression attempt materialized statistics');
  }

  override startCompression(): void {
    this.strategiesStarted = true;
    super.startCompression();
  }
}

export function attemptHandler(
  service: HistoryService,
  hook: AttemptHook,
): CompressionHandler {
  const runtime = buildRuntimeContext(service, {
    compressionStrategy: 'top-down-truncation',
  });
  return new CompressionHandler(
    runtime,
    service,
    {},
    () => {
      throw new Error('No-op truncation must not resolve a provider');
    },
    hook,
  );
}

export function expectedCuratedDigest(size: number, payload: number): string {
  const hash = createHash('sha256');
  for (let index = 0; index < size; index++) {
    if (fixtureIncluded(index)) {
      hash.update(JSON.stringify(curatedFixtureRow(index, payload)));
    }
  }
  return hash.digest('hex');
}
