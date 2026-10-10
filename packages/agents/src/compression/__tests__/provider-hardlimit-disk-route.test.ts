import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { middleoutSetup, middleoutRow } from './middleout-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';

class HardlimitHistory extends HistoryService {
  eagerAccess = false;
  constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
    super(options);
    forbidHistoryMaterializationForTest(
      this,
      'eager hard-limit preparation forbidden',
      () => {
        this.eagerAccess = true;
        return true;
      },
    );
  }
  override replaceAll(): Promise<void> {
    throw new Error('eager hard-limit candidate forbidden');
  }
  override async *streamCuratedHistory(): AsyncGenerator<
    IContent,
    void,
    unknown
  > {
    yield await Promise.reject<IContent>(
      new Error('primary source read failed'),
    );
  }
}
function setup(history: HistoryService): ReturnType<typeof middleoutSetup> {
  return middleoutSetup(history, undefined, undefined, {
    contextLimit: 30000,
    'compression.density.readWritePruning': false,
    'compression.density.fileDedupe': false,
    'compression.density.recencyPruning': false,
  });
}
async function oracle(
  size: number,
  history: HistoryService,
  fixture: ReturnType<typeof middleoutSetup>,
): Promise<readonly IContent[]> {
  const { runtime, transport } = fixture;
  const raw = Array.from({ length: size }, (_, index) => middleoutRow(index));
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    undefined,
    undefined,
    new DebugLogger('test:hardlimit'),
    { targetTokenCount: 0 },
  );
  const legacy = await new TopDownTruncationStrategy().compress({
    ...metadata,
    history: buildCuratedHistory(metadata.logger, raw, false),
    estimateTokens: async (rows) => rows.length,
  });
  if (legacy.kind !== 'applied') throw new Error('Expected truncation oracle');
  return invalidateResponsesStatefulChain(legacy.newHistory);
}
async function compare(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const fixture = setup(history);
      history.syncTotalTokens(
        await history.estimateTokensForContents(history.streamRawHistory()),
      );
      await history.waitForTokenUpdates();
      const expected = await oracle(size, history, fixture);
      const pending: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'pending' }],
      };
      const result = await enforceProviderSourceForTest(
        fixture.handler,
        history,
        [pending],
        'hardlimit',
        undefined,
        async (rows) => {
          if (history instanceof HardlimitHistory && history.eagerAccess)
            throw new Error('eager hard-limit preparation reached');
          return rows.length < 30 ? 1 : history.getTotalTokens() + 200000;
        },
      );
      expect(await collectRows(history)).toStrictEqual([...expected]);
      expect(result[result.length - 1]?.blocks).toStrictEqual(pending.blocks);
      expect(history.getCacheAnchorSeq()).toBe(0);
      expect(fixture.handler.wasRecentlyCompressed()).toBe(true);
      expect(fixture.transport.requests).toHaveLength(0);
      return result.length;
    },
    2048,
    middleoutRow,
    undefined,
    (options) => new HardlimitHistory(options),
  );
}
describe('actual provider hard-limit disk fallback', () => {
  it.each([512, 8192])(
    'matches legacy truncation over %i mixed rows without eager preparation or installation',
    async (size) => {
      expect(await compare(size)).toBeGreaterThan(0);
    },
    180000,
  );
  it('preserves a valid surviving row over eight MiB on the actual route', async () => {
    const history = new HardlimitHistory();
    try {
      const { handler } = setup(history);
      await history.transformRows(async (_source, sink) => {
        for (let index = 0; index < 3; index++)
          sink.appendDetached({
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: `${index}:${'x'.repeat(index === 2 ? 9 * 1024 * 1024 : 64)}`,
              },
            ],
          });
      });
      const pending: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'pending' }],
      };
      const result = await enforceProviderSourceForTest(
        handler,
        history,
        [pending],
        'large-hardlimit',
        undefined,
        async (rows) => (rows.length === 3 ? 1 : 200000),
      );
      expect(JSON.stringify(result[1]).length).toBeGreaterThan(8 * 1024 * 1024);
      expect(await collectRows(history)).toHaveLength(2);
    } finally {
      history.dispose();
    }
  }, 180000);
});
