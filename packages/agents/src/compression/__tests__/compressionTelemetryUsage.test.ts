/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4067: a compression record must carry the usage of the compression
 * that just ran, never the usage stored on an earlier summary that the
 * strategy kept at the head of history. The same stale summary must not be
 * handed to the session recording as this compression's summary either.
 *
 * Real CompressionHandler, real HistoryService, real strategies and a real
 * TokenUsageLogger writing JSONL. The only double is an in-process provider
 * that returns a distinct summary and distinct usage on every call.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { RuntimeModel } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeModel.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { TokenUsageLogger } from '../../core/TokenUsageLogger.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';

const historyScratchRoots = createTestScratchOwner();

/** Each call returns `summary <n>` and usage that encodes `n`. */
class CountingSummaryProvider {
  readonly name = 'counting-provider';
  calls = 0;

  async getModels(): Promise<RuntimeModel[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'counting-model';
  }

  async *generateChatCompletion(
    options: RuntimeGenerateChatOptions | AsyncIterable<IContent>,
  ): AsyncGenerator<IContent, void, unknown> {
    if (!('contents' in options)) throw new Error('Expected chat options');
    // Drain the streamed request like a real transport would.
    for await (const _row of options.contents) {
      /* consumed */
    }
    this.calls += 1;
    const n = this.calls;
    yield {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: `<state_snapshot>summary ${n}</state_snapshot>` },
      ],
      metadata: {
        usage: {
          promptTokens: n * 1000 + 7,
          completionTokens: n * 100 + 3,
          totalTokens: n * 1100 + 10,
        },
      },
    };
  }
}

const tempDirs: string[] = [];
const histories: HistoryService[] = [];

interface Harness {
  readonly historyService: HistoryService;
  readonly logPath: string;
  readonly endedSummaries: IContent[];
  handler(strategy: string): CompressionHandler;
}

async function createHarness(): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'compression-usage-'));
  tempDirs.push(dir);
  const logPath = path.join(dir, 'usage.jsonl');
  const logger = new TokenUsageLogger('summary', logPath);
  const historyService = new HistoryService({
    scratchRoots: historyScratchRoots,
  });
  histories.push(historyService);
  const endedSummaries: IContent[] = [];
  historyService.on('compressionEnded', (summary: IContent) => {
    endedSummaries.push(summary);
  });
  const provider = new CountingSummaryProvider();

  return {
    historyService,
    logPath,
    endedSummaries,
    handler(strategy: string): CompressionHandler {
      const runtime = buildRuntimeContext(historyService, {
        compressionStrategy: strategy,
        contextLimit: 200_000,
        compressionThreshold: 0.85,
      });
      const handler = new CompressionHandler(
        runtime,
        undefined,
        historyService,
        undefined,
        undefined,
        undefined,
        undefined,
        {},
        async () => ({
          provider,
          runtime: runtime.providerRuntime,
          invocation: runtime.prepareProviderInvocation(provider.name),
        }),
        () => Promise.resolve(undefined),
      );
      handler.tokenUsageLogger = logger;
      return handler;
    },
  };
}

async function addTurns(
  historyService: HistoryService,
  label: string,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    historyService.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: `${label} user ${i}` }],
    });
    historyService.add({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `${label} ai ${i}` }],
    });
  }
  await historyService.waitForCommit();
  await historyService.waitForTokenUpdates();
}

function summaryText(entry: IContent): string | undefined {
  if (entry.metadata?.reason !== 'compression-state-snapshot') return undefined;
  return entry.blocks[0].type === 'text' ? entry.blocks[0].text : '';
}

function summaryTexts(history: readonly IContent[]): string[] {
  return history.flatMap((entry) => summaryText(entry) ?? []);
}

/** Summary texts in curated history, read row by row from the journal. */
async function curatedSummaryTexts(
  historyService: HistoryService,
): Promise<string[]> {
  const texts: string[] = [];
  for await (const entry of historyService.streamCuratedHistory()) {
    const text = summaryText(entry);
    if (text !== undefined) texts.push(text);
  }
  return texts;
}

async function compressionRecords(
  logPath: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(logPath, 'utf8');
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record.record_type === 'compression');
}

async function compress(handler: CompressionHandler): Promise<void> {
  expect(
    await handler.performCompression('prompt', { trigger: 'manual' }),
  ).toBe(PerformCompressionResult.COMPRESSED);
}

describe('compression telemetry usage comes from the compression that ran (#4067)', () => {
  afterEach(async () => {
    await Promise.all(histories.splice(0).map((history) => history.dispose()));
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('reports each compression its own usage when the first summary stays at the head of history', async () => {
    const harness = await createHarness();
    const middleOut = harness.handler('middle-out');

    await addTurns(harness.historyService, 'seed', 20);
    await compress(middleOut);
    await addTurns(harness.historyService, 'later', 30);
    await compress(middleOut);

    // Precondition: the second compression kept the first summary ahead of
    // its own, which is the shape that made telemetry repeat old usage.
    expect(await curatedSummaryTexts(harness.historyService)).toStrictEqual([
      '<state_snapshot>summary 1</state_snapshot>',
      '<state_snapshot>summary 2</state_snapshot>',
    ]);

    const [first, second] = await compressionRecords(harness.logPath);
    expect(first.compression_prompt_tokens).toBe(1007);
    expect(first.compression_output_tokens).toBe(103);
    expect(second.compression_prompt_tokens).toBe(2007);
    expect(second.compression_output_tokens).toBe(203);
    for (const record of [first, second]) {
      expect(record.compression_strategy).toBe('middle-out');
      expect(record.llm_call_made).toBe(true);
      expect(record.compression_attempts).toBe(1);
      expect(Object.values(record).some((value) => Array.isArray(value))).toBe(
        false,
      );
    }
  });

  it('hands the session recording the summary this compression produced, not the retained one', async () => {
    const harness = await createHarness();
    const middleOut = harness.handler('middle-out');

    await addTurns(harness.historyService, 'seed', 20);
    await compress(middleOut);
    await addTurns(harness.historyService, 'later', 30);
    await compress(middleOut);

    expect(summaryTexts(harness.endedSummaries)).toStrictEqual([
      '<state_snapshot>summary 1</state_snapshot>',
      '<state_snapshot>summary 2</state_snapshot>',
    ]);
  });

  it('leaves usage absent for a compression that made no LLM call, even with an earlier summary in history', async () => {
    const harness = await createHarness();

    await addTurns(harness.historyService, 'seed', 20);
    await compress(harness.handler('middle-out'));
    await addTurns(harness.historyService, 'later', 30);
    await compress(harness.handler('high-density'));

    // The high-density pass kept the earlier summary in history.
    expect(await curatedSummaryTexts(harness.historyService)).toContain(
      '<state_snapshot>summary 1</state_snapshot>',
    );

    const records = await compressionRecords(harness.logPath);
    expect(records).toHaveLength(2);
    const deterministic = records[1];
    expect(deterministic.compression_strategy).toBe('high-density');
    expect(deterministic.llm_call_made).toBe(false);
    expect(deterministic.compression_attempts).toBe(1);
    expect(Object.keys(deterministic)).not.toContain(
      'compression_prompt_tokens',
    );
    expect(Object.keys(deterministic)).not.toContain(
      'compression_output_tokens',
    );

    // No new summary was produced, so the recording is not told that history
    // collapsed to the old summary.
    expect(summaryTexts(harness.endedSummaries)).toStrictEqual([
      '<state_snapshot>summary 1</state_snapshot>',
    ]);
  });
});
