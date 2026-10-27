/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TurnProcessor } from './TurnProcessor.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { processorFixture } from './__tests__/support/streamprocessor-source-fixture.js';

const root = sourceRootSetup();

function directProcessor(
  setup: Awaited<ReturnType<typeof processorFixture>>,
): TurnProcessor {
  return new TurnProcessor(
    setup.runtime,
    setup.compression,
    () => setup.provider,
    (_source, metadata) => ({ ...setup.runtime.providerRuntime, metadata }),
    setup.generation,
    setup.history,
    setup.processor,
    () => setup.runtime.state.baseUrl,
  );
}

describe('direct provider response arrivals', () => {
  for (const includeThoughts of [false, true])
    it(`publishes AFC and reasoning context policy (${includeThoughts}) behind a receipt`, async () => {
      const setup = await processorFixture(
        root(),
        'http://127.0.0.1:1/v1',
        false,
        0,
      );
      setup.settings.set('reasoning.includeInContext', includeThoughts);
      setup.provider.generateChatCompletion = async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'thinking', thought: 'private reasoning' }],
        };
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'answer' }],
          metadata: {
            finishReason: 'stop',
            providerMetadata: {
              automaticFunctionCallingHistory: [
                {
                  speaker: 'tool',
                  blocks: [
                    {
                      type: 'tool_response',
                      callId: 'afc',
                      toolName: 'lookup',
                      result: 'found',
                    },
                  ],
                },
              ],
            },
          },
        };
      };
      try {
        const receipt = await directProcessor(setup).sendMessage(
          { message: 'question' },
          'context-policy',
        );
        expect(receipt.status).toBe('published');
        expect(receipt.finishReason).toBe('stop');
        expect('content' in receipt).toBe(false);
        expect('afcHistory' in receipt).toBe(false);
        const rows = await Array.fromAsync(setup.history.streamRawHistory());
        expect(rows.map((row) => row.speaker)).toStrictEqual([
          'human',
          'tool',
          'ai',
        ]);
        expect(rows[1].blocks).toStrictEqual([
          {
            type: 'tool_response',
            callId: 'afc',
            toolName: 'lookup',
            result: 'found',
          },
        ]);
        const expectedBlocks: ContentBlock[] = includeThoughts
          ? [
              { type: 'thinking', thought: 'private reasoning' },
              { type: 'text', text: 'answer' },
            ]
          : [{ type: 'text', text: 'answer' }];
        expect(rows[2].blocks).toStrictEqual(expectedBlocks);
      } finally {
        await setup.history.dispose();
        await setup.config.dispose();
      }
    });
  it('releases accepted blocks during generation and returns a payload-free publication receipt', async () => {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    const processor = directProcessor(setup);
    const references: Array<WeakRef<ContentBlock>> = [];
    let living = 0;
    let visibleDuringArrival = -1;
    setup.provider.generateChatCompletion = async function* () {
      for (let index = 0; index < 128; index++) {
        const block: ContentBlock = {
          type: 'text',
          text: `${index}:` + 'x'.repeat(65536),
        };
        references.push(new WeakRef(block));
        yield {
          speaker: 'ai',
          blocks: [block],
          ...(index === 64
            ? {
                metadata: {
                  usage: {
                    promptTokens: 11,
                    completionTokens: 17,
                    totalTokens: 28,
                  },
                },
              }
            : {}),
        };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
      living = references.filter(
        (reference) => reference.deref() !== undefined,
      ).length;
      visibleDuringArrival = await setup.history.countCuratedRows();
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: {
          finishReason: 'stop',
        },
      };
    };
    try {
      const response = await processor.sendMessage(
        { message: 'test' },
        'direct-arrival',
      );
      expect(living).toBeLessThan(4);
      expect(visibleDuringArrival).toBe(1);
      expect(response.usage?.totalTokens).toBe(28);
      expect(response.status).toBe('published');
      expect(response.promptId).toBe('direct-arrival');
      expect('content' in response).toBe(false);
      const sealed = await setup.history.getLastContent();
      expect(
        sealed?.blocks.reduce(
          (size, block) =>
            size + (block.type === 'text' ? block.text.length : 0),
          0,
        ),
      ).toBeGreaterThan(8 * 1024 * 1024);
      expect(await setup.history.countCuratedRows()).toBe(2);
    } finally {
      await setup.history.dispose();
      await setup.config.dispose();
    }
  });
  it('keeps failed response arrivals outside context and can accept the following turn', async () => {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    const processor = directProcessor(setup);
    let promptPublished = false;
    setup.provider.generateChatCompletion = async function* () {
      promptPublished = await setup.history.hasPromptSubmission('failure');
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'abandoned response' }],
      };
      throw new Error('provider interrupted');
    };
    try {
      await expect(
        processor.sendMessage({ message: 'first' }, 'failure'),
      ).rejects.toThrow('provider interrupted');
      expect(await setup.history.countCuratedRows()).toBe(0);
      expect(promptPublished).toBe(true);
      setup.provider.generateChatCompletion = async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'accepted response' }],
          metadata: { finishReason: 'stop' },
        };
      };
      const output = await processor.sendMessage(
        { message: 'second' },
        'success',
      );
      expect(output.status).toBe('published');
      const rows = await Array.fromAsync(setup.history.streamRawHistory());
      expect(rows[rows.length - 1]?.blocks).toStrictEqual([
        { type: 'text', text: 'accepted response' },
      ]);
      expect(rows.filter((row) => row.speaker === 'ai')).toHaveLength(1);
      expect(rows).toHaveLength(2);
    } finally {
      await setup.history.dispose();
      await setup.config.dispose();
    }
  });
});
