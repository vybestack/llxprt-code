/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  MediaAdmissionService,
  type MediaAdmissionContext,
} from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';

class ObservedAdmission extends MediaAdmissionService {
  readonly admitted = new Map<string, string>();
  override async admitContent(
    content: IContent,
    context: MediaAdmissionContext,
  ): Promise<IContent> {
    const admitted = await super.admitContent(content, context);
    for (const block of admitted.blocks)
      if (block.type === 'text') this.admitted.set(block.text, context.turnId);
    return admitted;
  }
}
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

async function* textStream(prefix: string): AsyncGenerator<ModelStreamChunk> {
  yield {
    content: { speaker: 'ai', blocks: [{ type: 'text', text: `${prefix}-a` }] },
  };
  yield {
    content: { speaker: 'ai', blocks: [{ type: 'text', text: `${prefix}-b` }] },
    finishReason: 'stop',
  };
}
async function responseTexts(history: HistoryService): Promise<string[]> {
  const results: string[] = [];
  for await (const row of history.streamRawHistory()) {
    if (row.speaker === 'ai')
      results.push(
        row.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join(''),
      );
  }
  return results;
}
async function drain(stream: AsyncGenerator<ModelStreamChunk>): Promise<void> {
  for await (const _chunk of stream) {
    /* Consume through publication. */
  }
}

describe('StreamProcessor journal attempt lifetime', () => {
  const root = sourceRootSetup();
  for (const failure of ['cancelled', 'error']) {
    it(`does not publish ${failure} output or carry it into the next turn`, async () => {
      const setup = await processorFixture(
        root(),
        'http://127.0.0.1:1/v1',
        false,
        0,
      );
      async function* failedStream(): AsyncGenerator<ModelStreamChunk> {
        yield {
          content: {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'abandoned' }],
          },
        };
        throw new Error('provider exploded');
      }
      try {
        const abandoned = setup.processor.processStreamResponse(
          failedStream(),
          sourcePending,
        );
        await abandoned.next();
        const outcome =
          failure === 'error'
            ? abandoned.next().then(
                () => undefined,
                (error: unknown) =>
                  error instanceof Error ? error.message : String(error),
              )
            : abandoned.return(undefined).then(() => undefined);
        expect(await outcome).toBe(
          failure === 'error' ? 'provider exploded' : undefined,
        );
        expect(await setup.history.countCuratedRows()).toBe(0);
        await drain(
          setup.processor.processStreamResponse(
            textStream('fresh'),
            sourcePending,
          ),
        );
        expect(await responseTexts(setup.history)).toStrictEqual([
          'fresh-afresh-b',
        ]);
      } finally {
        await setup.history.dispose();
        await setup.config.dispose();
      }
    });
  }
  it('seals truncated nonempty responses without mixing turns', async () => {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    async function* truncated(text: string): AsyncGenerator<ModelStreamChunk> {
      yield { content: { speaker: 'ai', blocks: [{ type: 'text', text }] } };
    }
    try {
      await drain(
        setup.processor.processStreamResponse(truncated('one'), sourcePending),
      );
      await drain(
        setup.processor.processStreamResponse(truncated('two'), sourcePending),
      );
      expect(await responseTexts(setup.history)).toStrictEqual(['one', 'two']);
    } finally {
      await setup.history.dispose();
      await setup.config.dispose();
    }
  });
  it('keeps interleaved response writers and turn identities separate', async () => {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    const store = new LocalMediaStore({
      rootDirectory: `${root()}/media`,
      quotaBytes: 1024 * 1024,
    });
    const admission = new ObservedAdmission(store);
    setup.processor.rebindHistory({
      ...setup.runtime,
      mediaAdmission: admission,
    });
    try {
      const left = setup.processor.processStreamResponse(
        textStream('left'),
        sourcePending,
        undefined,
        'left-turn',
      );
      const right = setup.processor.processStreamResponse(
        textStream('right'),
        sourcePending,
        undefined,
        'right-turn',
      );
      await left.next();
      await drain(right);
      await drain(left);
      const rows = (
        await Array.fromAsync(setup.history.streamRawHistory())
      ).filter((row) => row.speaker === 'ai');
      expect(Object.fromEntries(admission.admitted)).toStrictEqual({
        'left-a': 'left-turn',
        'left-b': 'left-turn',
        'right-a': 'right-turn',
        'right-b': 'right-turn',
      });
      expect(rows.map((row) => row.metadata?.turnId)).toStrictEqual([
        'right-turn',
        'left-turn',
      ]);
      expect(await responseTexts(setup.history)).toStrictEqual([
        'right-aright-b',
        'left-aleft-b',
      ]);
    } finally {
      await store.close();
      await setup.history.dispose();
      await setup.config.dispose();
    }
  });
});
