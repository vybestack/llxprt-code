/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildAgent,
  internalConfig,
} from '../api/__tests__/helpers/agentHarness.js';
import { LocalMediaStore } from '../../../core/src/storage/local-media-store.js';
import { MediaAdmissionService } from '../../../core/src/storage/media-admission-service.js';
import { exactTokenizer } from '../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedRow,
  type DetachedFixture,
} from '../../../core/src/services/history/detached-rollback-test-helpers.js';
import type { IContent } from '../../../core/src/services/history/IContent.js';
import type { AgentClientContract } from '../../../core/src/core/clientContract.js';

export interface ClientArrayFixture {
  readonly client: AgentClientContract;
  readonly store: LocalMediaStore;
}
export async function withArrayClient<T>(
  fixture: DetachedFixture,
  action: (client: ClientArrayFixture) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'client-array-media-'));
  const store = new LocalMediaStore({
    rootDirectory: root,
    quotaBytes: 16 * 1024 * 1024,
  });
  const { agent, cleanup } = await buildAgent('plain-text.jsonl');
  try {
    const config = internalConfig(agent);
    Object.defineProperty(config, 'getLocalMediaStore', {
      value: () => store,
      configurable: true,
    });
    const client = config.getAgentClient();
    client.storeHistoryServiceForReuse(fixture.history);
    await client.startChat([]);
    fixture.history.setTokenizerFactory(exactTokenizer());
    return await action({ client, store });
  } finally {
    await cleanup();
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
}
export function forbidClientArrayRollback(fixture: DetachedFixture): void {
  const reject = async (): Promise<never> => {
    throw new Error('Client restore entered legacy array rollback');
  };
  fixture.history.replaceAll = reject;
  fixture.history.replaceBatch = reject;
}
export function clientArrayRows(size: number, bytes = 2048): IContent[] {
  return Array.from({ length: size }, (_, index) => detachedRow(index, bytes));
}
export async function withClientOracle<T>(
  store: LocalMediaStore,
  rows: readonly IContent[],
  action: (rows: readonly IContent[]) => Promise<T>,
): Promise<T> {
  const admission = new MediaAdmissionService(store);
  const context = {
    turnId: 'client-array-oracle',
    source: 'client-array-oracle',
  };
  const admitted = await admission.admitContents(rows, context);
  try {
    return await action(admitted);
  } finally {
    await admission.releaseContents(admitted, context);
  }
}
export async function* clientRows(
  rows: readonly IContent[],
): AsyncGenerator<IContent, void, unknown> {
  yield* rows;
}
export function recordClientProof(value: object): void {
  const output = process.env.CLIENT_ARRAY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}
