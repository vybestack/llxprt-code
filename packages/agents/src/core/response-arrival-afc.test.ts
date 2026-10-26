/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

async function seal(stream: AsyncGenerator<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    /* Seal. */
  }
}

describe('AFC arrival ownership', () => {
  const root = sourceRootSetup();
  for (const complete of [false, true]) {
    it(`keeps AFC rows out of context until the response seals (complete=${complete})`, async () => {
      const setup = await processorFixture(
        root(),
        'http://127.0.0.1:1/v1',
        false,
        0,
      );
      const afc: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'afc-call',
            toolName: 'lookup',
            result: 'found',
          },
        ],
      };
      setup.provider.generateChatCompletion = async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Answer' }],
          metadata: {
            providerMetadata: { automaticFunctionCallingHistory: [afc] },
          },
        };
        yield { speaker: 'ai', blocks: [], metadata: { finishReason: 'stop' } };
      };
      try {
        const stream = await setup.processor.makeApiCallAndProcessStream(
          { message: 'test', config: {} },
          'afc',
          sourcePending,
        );
        await stream.next();
        expect(await setup.history.countCuratedRows()).toBe(1);
        if (complete) await seal(stream);
        else await stream.return(undefined);
        const rows = await Array.fromAsync(setup.history.streamRawHistory());
        expect(
          rows.some((row) =>
            row.blocks.some((block) => block.type === 'tool_response'),
          ),
        ).toBe(complete);
      } finally {
        await setup.history.dispose();
        await setup.config.dispose();
      }
    });
  }
});
