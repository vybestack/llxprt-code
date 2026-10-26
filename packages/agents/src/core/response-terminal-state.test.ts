/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { StreamTerminalState } from './streamTerminalState.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

describe('journal-backed response finalization', () => {
  const root = sourceRootSetup();
  it('counts trimmed text across chunk boundaries without retaining response text', () => {
    const terminal = new StreamTerminalState();
    const parts = ['  ', '\nalpha  ', ' \n', 'beta ', '\t'];
    for (const text of parts)
      terminal.add(
        { content: { speaker: 'ai', blocks: [{ type: 'text', text }] } },
        false,
      );
    expect(terminal.responseTextLength).toBe(parts.join('').trim().length);
    expect(terminal.outcome).toStrictEqual({
      hasVisibleText: true,
      hasThinking: false,
      hasToolCalls: false,
      isActionable: true,
    });
  });
  it('drops abandoned attempt outcomes and usage when the provider epoch changes', () => {
    const terminal = new StreamTerminalState();
    terminal.add(
      {
        content: {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'abandoned' }],
          responseAttemptId: 'first',
        },
        finishReason: 'error',
        usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
      },
      false,
    );
    terminal.add(
      { content: { speaker: 'ai', blocks: [], responseAttemptId: 'second' } },
      false,
    );
    expect(terminal.responseTextLength).toBe(0);
    expect(terminal.outcome.isActionable).toBe(false);
    expect(terminal.usage).toBeUndefined();
    expect(terminal.finishReason).toBeUndefined();
  });
  it('releases accepted response blocks before the provider finishes', async () => {
    const setup = await processorFixture(
      root(),
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    const references: Array<WeakRef<ContentBlock>> = [];
    let living = 0;
    setup.provider.generateChatCompletion = async function* () {
      for (let index = 0; index < 128; index++) {
        const block: ContentBlock = {
          type: 'text',
          text: `${index}:` + 'x'.repeat(65536),
        };
        references.push(new WeakRef(block));
        yield { speaker: 'ai', blocks: [block] };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
      living = references.filter(
        (reference) => reference.deref() !== undefined,
      ).length;
      yield {
        speaker: 'ai',
        blocks: [],
        metadata: {
          finishReason: 'stop',
          usage: { promptTokens: 11, completionTokens: 17, totalTokens: 28 },
        },
      };
    };
    try {
      const stream = await setup.processor.makeApiCallAndProcessStream(
        { message: 'test', config: {} },
        'release',
        sourcePending,
      );
      for await (const _chunk of stream) {
        /* Consume without retaining output. */
      }
      expect(living).toBeLessThan(4);
      const rows = await Array.fromAsync(setup.history.streamRawHistory());
      const response = rows.find((row) => row.speaker === 'ai');
      expect(response?.metadata?.usage?.totalTokens).toBe(28);
      expect(response?.metadata?.providerBaseURL).toBe(
        setup.runtime.state.baseUrl,
      );
      expect(
        response?.blocks[0].type === 'text' && response.blocks[0].text.length,
      ).toBeGreaterThan(8 * 1024 * 1024);
    } finally {
      await setup.history.dispose();
      await setup.config.dispose();
    }
  });
});
