/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { DebugLogger } from '../../debug/DebugLogger.js';
import { JournalArrivalRecorder } from '../../journal/arrival-recorder.js';
import { ROW_BLOCK_TYPE } from '../../journal/rowRecord.js';
import type { RuntimeTokenizer } from '../../runtime/contracts/RuntimeTokenizer.js';
import type { IContent } from './IContent.js';
import { JournalSession } from './journalSession.js';
import { decodeStoredRow, encodeContentRow } from './journalRowCodec.js';
import { estimateContentTokens } from './historyTokenEstimation.js';
import { estimateSealedTokens } from './sealed-token-estimation.js';

const logger = new DebugLogger('sealed-token-fallback');
const corpus: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'snow 雪 '.repeat(12000) },
    { type: 'thinking', thought: 'thought 😀 '.repeat(9000) },
    { type: 'code', code: 'const x = 42;\n'.repeat(6000) },
    {
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAAg',
      dimensions: { width: 123, height: 456 },
      caption: 'a picture',
    },
    {
      type: 'tool_call',
      id: 'call',
      name: 'shell',
      parameters: { x: '雪', value: [1, 2] },
    },
  ],
};

async function countCharacters(
  parts: AsyncIterable<Uint8Array>,
): Promise<number> {
  let length = 0;
  const decoder = new TextDecoder();
  for await (const part of parts)
    length += decoder.decode(part, { stream: true }).length;
  return length + decoder.decode().length;
}

describe('sealed token block fallback', () => {
  const directory = useTempDir('sealed-token-fallback-');

  async function compare(
    content: IContent,
    tokenizer: RuntimeTokenizer,
  ): Promise<readonly [number, number]> {
    const session = await JournalSession.create(
      join(directory(), 'session.llxj'),
    );
    const provider = { getTokenizerForModel: () => tokenizer };
    try {
      await session.append([content]);
      const snapshot = await session.store.snapshot();
      try {
        spyOn(snapshot, 'readRow').mockImplementation(() => {
          throw new Error('whole row hydration');
        });
        spyOn(snapshot, 'readBlock').mockImplementation(() => {
          throw new Error('whole block read');
        });
        const actual = await estimateSealedTokens(
          snapshot,
          await snapshot.entryAt(0),
          'custom',
          provider,
          logger,
        );
        const expected = await estimateContentTokens(
          content,
          'custom',
          provider,
          logger,
        );
        return [actual, expected];
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  }

  it('uses the injected codec one streamed block at a time without row hydration', async () => {
    const [actual, expected] = await compare(corpus, {
      countTokens: (text) => String(text).length * 3 + 7,
    });
    expect(actual).toBe(expected);
  });

  it('preserves inline media dimension precedence without whole-block reads', async () => {
    const [actual, expected] = await compare(corpus, {
      countTokens: (text) => String(text).length,
      countTokenStream: countCharacters,
    });
    expect(actual).toBe(expected);
  });

  it('does not invoke a failing streaming codec for empty text', async () => {
    const [actual, expected] = await compare(
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: '' },
          { type: 'thinking', thought: '' },
        ],
      },
      {
        fallbackPolicy: 'deny',
        countTokens: () => {
          throw new Error('empty tokenizer input');
        },
        countTokenStream: async () => {
          throw new Error('empty tokenizer input');
        },
      },
    );
    expect(actual).toBe(expected);
  });

  it('propagates cancellation during streaming even when tokenizer fallback is allowed', async () => {
    const session = await JournalSession.create(
      join(directory(), 'abort.llxj'),
    );
    const controller = new AbortController();
    const reason = new Error('stop counting');
    let bytes = 0;
    const provider = {
      getTokenizerForModel: () => ({
        countTokens: (text: unknown) => String(text).length,
        countTokenStream: async (parts: AsyncIterable<Uint8Array>) => {
          for await (const part of parts) {
            bytes += part.byteLength;
            controller.abort(reason);
          }
          return bytes;
        },
      }),
    };
    try {
      await session.append([corpus]);
      const snapshot = await session.store.snapshot();
      try {
        await expect(
          estimateSealedTokens(
            snapshot,
            await snapshot.entryAt(0),
            'custom',
            provider,
            logger,
            controller.signal,
          ),
        ).rejects.toBe(reason);
        expect(bytes).toBeGreaterThan(0);
        expect(bytes).toBeLessThanOrEqual(65536);
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });

  const failingCodec: RuntimeTokenizer = {
    countTokens: () => {
      throw new Error('codec failure');
    },
    countTokenStream: async () => {
      throw new Error('codec failure');
    },
  };
  it('preserves the allow tokenizer error policy', async () => {
    const [actual, expected] = await compare(corpus, {
      ...failingCodec,
      fallbackPolicy: 'allow',
    });
    expect(actual).toBe(expected);
  });
  it('preserves the deny tokenizer error policy', async () => {
    await expect(
      compare(corpus, { ...failingCodec, fallbackPolicy: 'deny' }),
    ).rejects.toThrow('codec failure');
  });

  it('normalizes named raw tool JSON exactly with a one-block fallback', async () => {
    const session = await JournalSession.create(join(directory(), 'raw.llxj'));
    const recorder = new JournalArrivalRecorder(session.store);
    const provider = {
      getTokenizerForModel: () => ({
        countTokens: (text: unknown) => String(text).length,
        countTokenStream: countCharacters,
      }),
    };
    try {
      const row = await recorder.beginRow(
        encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
        { id: 'attempt', submissionId: 'submission' },
      );
      const block = await recorder.beginNamedBlock(
        row,
        ROW_BLOCK_TYPE.tool_call,
      );
      await recorder.appendText(block, 'id', 'call');
      await recorder.appendText(block, 'name', 'lookup');
      await recorder.appendText(
        block,
        'parameters',
        ' { "z":1e2, "2":"two", "1":"one", "z":-0, "escaped":"\\u96ea" } ',
      );
      await recorder.endBlock(block);
      await recorder.sealRow(row);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const content = decodeStoredRow(await snapshot.readRow(entry));
        spyOn(snapshot, 'readRow').mockImplementation(() => {
          throw new Error('whole row hydration');
        });
        spyOn(snapshot, 'readBlock').mockImplementation(() => {
          throw new Error('whole block read');
        });
        expect(
          await estimateSealedTokens(
            snapshot,
            entry,
            'custom',
            provider,
            logger,
          ),
        ).toBe(
          await estimateContentTokens(content, 'custom', provider, logger),
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await recorder.close();
      await session.close();
    }
  });
});
