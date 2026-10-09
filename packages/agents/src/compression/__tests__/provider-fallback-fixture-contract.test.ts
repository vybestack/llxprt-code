/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import {
  buildRuntimeContext,
  makeUserMessage,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { runDiskProviderFallback } from '../diskProviderFallback.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import {
  installProviderDiskFixture,
  makeStoredAi,
} from './compression-provider-fallback-test-helpers.js';

async function publishFixture(
  history: HistoryService,
  observeRows: (rows: HistoryIndexedRows) => void,
): Promise<string> {
  const runtime = buildRuntimeContext(history, { contextLimit: 200_000 });
  const result = await runDiskProviderFallback(
    async (candidate) => {
      observeRows(candidate.rows);
      await publishProviderFallbackCandidate(history, candidate, 'test');
    },
    'fixture-contract',
    runtime,
    history,
    async () => {
      throw new Error('Truncation must not resolve an LLM');
    },
    undefined,
    undefined,
    new DebugLogger('test:fallback-fixture-contract'),
  );
  return result.outcome;
}

async function seededHistory(): Promise<HistoryService> {
  const history = new HistoryService();
  history.add(makeUserMessage('original history'));
  await history.waitForTokenUpdates();
  return history;
}

describe('provider fallback fixture through the real detached transaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes candidate values and closes their borrowed rows', async () => {
    const history = await seededHistory();
    installProviderDiskFixture([
      makeStoredAi('fixture-stored'),
      makeUserMessage('candidate summary'),
    ]);
    let rows: HistoryIndexedRows | undefined;

    expect(await publishFixture(history, (value) => (rows = value))).toBe(
      'applied',
    );

    const committed = await collectRawHistory(history);
    expect(committed).toHaveLength(2);
    expect(committed[0].metadata?.responsesStored).toBeUndefined();
    expect(committed[0].metadata?.id).toBe('fixture-stored');
    expect(committed[1].blocks).toStrictEqual([
      { type: 'text', text: 'candidate summary' },
    ]);
    expect(() => rows?.readRow(0)).toThrow(/closed/);
  });

  it('admits a valid individual candidate row larger than 10MiB', async () => {
    const history = await seededHistory();
    const candidate = makeUserMessage('x'.repeat(10 * 1024 * 1024 + 1));
    installProviderDiskFixture([candidate]);

    expect(await publishFixture(history, () => {})).toBe('applied');

    const [committed] = await collectRawHistory(history);
    expect(Buffer.byteLength(JSON.stringify(committed))).toBeGreaterThan(
      10 * 1024 * 1024,
    );
    expect(committed.blocks).toStrictEqual(candidate.blocks);
  }, 30_000);

  it('propagates publication failure, restores history and closes the candidate', async () => {
    const history = await seededHistory();
    const original = await collectRawHistory(history);
    const tokens = history.getTotalTokens();
    installProviderDiskFixture([makeUserMessage('rejected candidate')]);
    history.once('tokensUpdated', () => {
      throw new Error('fixture publication observer rejected');
    });
    let rows: HistoryIndexedRows | undefined;

    await expect(
      publishFixture(history, (value) => (rows = value)),
    ).rejects.toThrow('fixture publication observer rejected');

    const restored = await collectRawHistory(history);
    const restoredTokens = history.getTotalTokens();
    expect(restored).toStrictEqual(original);
    expect(restoredTokens).toBe(tokens);
    expect(() => rows?.readRow(0)).toThrow(/closed/);
  });
});
