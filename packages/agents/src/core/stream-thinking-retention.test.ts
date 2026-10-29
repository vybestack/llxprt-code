/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  processorFixture,
  sourcePending,
} from './__tests__/support/streamprocessor-source-fixture.js';

async function liveSnapshots(
  refs: Array<WeakRef<ContentBlock>>,
): Promise<number> {
  for (let round = 0; round < 8; round++) {
    await Bun.sleep(0);
    Bun.gc(true);
  }
  return refs.filter((ref) => ref.deref() !== undefined).length;
}

async function measure(retainAll: boolean): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), 'thinking-retention-'));
  const refs: Array<WeakRef<ContentBlock>> = [];
  const control: ContentBlock[] = [];
  const setup = await processorFixture(root, 'http://127.0.0.1:1/v1', false, 0);
  async function* snapshots(): AsyncGenerator<ModelStreamChunk> {
    for (let index = 0; index < 64; index++) {
      const block: ContentBlock = {
        type: 'thinking',
        thought: 'x'.repeat((index + 1) * 32),
        streamId: 'thinking-span',
        streamStatus: 'delta',
      };
      refs.push(new WeakRef(block));
      if (retainAll) control.push(block);
      yield { content: { speaker: 'ai', blocks: [block] } };
    }
  }
  const stream = setup.processor.processStreamResponse(
    snapshots(),
    sourcePending,
  );
  try {
    for (let index = 0; index < 64; index++) await stream.next();
    const live = await liveSnapshots(refs);
    expect(refs).toHaveLength(64);
    expect(control).toHaveLength(retainAll ? 64 : 0);
    return live;
  } finally {
    await stream.return(undefined);
    await rm(root, { recursive: true, force: true });
  }
}

describe('stream thinking snapshot ownership', () => {
  it('commits the newest thinking snapshot and every ordinary response piece', async () => {
    const root = await mkdtemp(join(tmpdir(), 'thinking-commit-'));
    const setup = await processorFixture(
      root,
      'http://127.0.0.1:1/v1',
      false,
      0,
    );
    async function* chunks(): AsyncGenerator<ModelStreamChunk> {
      for (let index = 0; index < 4; index++) {
        yield {
          content: {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'thought'.repeat(index + 1),
                streamId: 'span',
                streamStatus: 'delta',
              },
              { type: 'text', text: `${index}` },
            ],
          },
        };
      }
      yield { content: { speaker: 'ai', blocks: [] }, finishReason: 'stop' };
    }
    try {
      for await (const chunk of setup.processor.processStreamResponse(
        chunks(),
        sourcePending,
      )) {
        expect(chunk.content.speaker).toBe('ai');
      }
      const saved = await setup.history.getLastAIContent();
      expect(
        saved?.blocks
          .filter((block) => block.type === 'thinking')
          .map((block) => block.thought),
      ).toStrictEqual(['thought'.repeat(4)]);
      expect(
        saved?.blocks
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join(''),
      ).toBe('0123');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('retains only the current cumulative thinking snapshot while the production loop is paused', async () => {
    expect(await measure(false)).toBeLessThanOrEqual(2);
  });

  it('rejects a control that retains every admission snapshot', async () => {
    expect(await measure(true)).toBeGreaterThan(2);
  });
});
