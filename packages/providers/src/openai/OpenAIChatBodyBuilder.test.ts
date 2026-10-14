/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { OutputLimitConfig } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { createInMemoryToolIdStore } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import { KeyedRowToolIdStore } from '../utils/keyed-row-tool-id-store.js';
import {
  createCorpus,
  type Corpus,
} from '../__tests__/support/wireBodyCorpus.js';
import {
  streamChatMessages,
  writeChatMessages,
  type ChatBodyOptions,
  type ChatBodyRows,
} from './OpenAIChatBodyBuilder.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import {
  blocklessRow,
  seededHistory,
} from './__tests__/support/chatBodyCorpus.js';

type StripPolicy = 'none' | 'all' | 'allButLast';

interface Settings {
  readonly toolFormat: ToolFormat | undefined;
  readonly strip: StripPolicy;
  readonly include: boolean;
  readonly config?: OutputLimitConfig;
}

const FORMATS: ReadonlyArray<ToolFormat | undefined> = [
  undefined,
  'openai',
  'kimi',
  'mistral',
];
const POLICIES: readonly StripPolicy[] = ['none', 'all', 'allButLast'];

function allSettings(config?: OutputLimitConfig): Settings[] {
  return FORMATS.flatMap((toolFormat) =>
    POLICIES.flatMap((strip) =>
      [true, false].map((include) => ({ toolFormat, strip, include, config })),
    ),
  );
}

function reasoningOptions(settings: Settings): ChatBodyOptions['reasoning'] {
  return {
    invocation: {
      ephemerals: {
        'reasoning.stripFromContext': settings.strip,
        'reasoning.includeInContext': settings.include,
      },
    },
  };
}

function sourceOf(rows: readonly IContent[]): ChatBodyRows {
  return {
    async *rows(): AsyncIterable<IContent> {
      for (const row of rows) yield structuredClone(row);
    },
  };
}

function oracleBytes(rows: readonly IContent[], settings: Settings): Buffer {
  const messages = buildMessagesWithReasoning(
    structuredClone([...rows]),
    reasoningOptions(settings),
    settings.toolFormat,
    settings.config,
  );
  return Buffer.from(JSON.stringify(messages), 'utf8');
}

async function builderBytes(
  rows: readonly IContent[],
  settings: Settings,
  extra: Partial<ChatBodyOptions> = {},
): Promise<Buffer> {
  const index = KeyedRowIndex.create('chat-body-test');
  try {
    const parts: Buffer[] = [Buffer.from('[')];
    let messages = 0;
    const count = await writeChatMessages(
      sourceOf(rows),
      {
        reasoning: reasoningOptions(settings),
        toolFormat: settings.toolFormat,
        config: settings.config,
        toolIdStore: new KeyedRowToolIdStore(index),
        ...extra,
      },
      {
        message(chunks): void {
          if (messages++ > 0) parts.push(Buffer.from(','));
          for (const chunk of chunks) parts.push(Buffer.from(chunk));
        },
      },
    );
    expect(count).toBe(messages);
    parts.push(Buffer.from(']'));
    return Buffer.concat(parts);
  } finally {
    index.close();
  }
}

/** What differs, or undefined when the builder and the array route agree to the byte. */
async function firstDifference(
  label: string,
  rows: readonly IContent[],
  settings: Settings,
  extra: Partial<ChatBodyOptions> = {},
  oracleRows: readonly IContent[] = rows,
): Promise<string | undefined> {
  const actual = await builderBytes(rows, settings, extra);
  const expected = oracleBytes(oracleRows, settings);
  if (actual.equals(expected)) return undefined;
  let offset = 0;
  while (offset < actual.length && actual[offset] === expected[offset])
    offset++;
  const excerpt = (bytes: Buffer): string =>
    bytes.subarray(Math.max(0, offset - 40), offset + 80).toString('latin1');
  return `${label} ${JSON.stringify({ ...settings, config: undefined })}: first difference at byte ${offset} (builder ${actual.length} bytes, array ${expected.length} bytes)\nbuilder: ${excerpt(actual)}\narray:   ${excerpt(expected)}`;
}

function scratchNames(): Set<string> {
  return new Set(readdirSync(getScratchRoot()));
}

describe('chat body builder against buildMessagesWithReasoning', () => {
  it('matches every setting over 40 seeded histories', async () => {
    const differences: string[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const rows = seededHistory(seed);
      for (const settings of allSettings()) {
        const difference = await firstDifference(
          `seed ${seed}`,
          rows,
          settings,
        );
        if (difference !== undefined) differences.push(difference);
      }
    }
    expect(differences).toStrictEqual([]);
  }, 180_000);

  it('matches when tool output is limited', async () => {
    const config = parseOutputLimits({
      'tool-output-max-tokens': 12,
      'tool-output-truncate-mode': 'truncate',
    });
    const differences: string[] = [];
    for (let seed = 100; seed < 112; seed++) {
      const rows = seededHistory(seed);
      for (const settings of allSettings(config)) {
        const difference = await firstDifference(
          `seed ${seed}`,
          rows,
          settings,
        );
        if (difference !== undefined) differences.push(difference);
      }
    }
    expect(differences).toStrictEqual([]);
  }, 180_000);

  it('seeded histories reach every conversion rule', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      for (const row of seededHistory(seed)) {
        if (!Array.isArray(row.blocks)) {
          seen.add('blockless');
          continue;
        }
        for (const block of row.blocks)
          seen.add(`${row.speaker}:${block.type}`);
        if (
          row.speaker === 'tool' &&
          row.blocks.some((b) => b.type === 'media')
        )
          seen.add('tool-media');
      }
    }
    for (const rule of [
      'blockless',
      'tool-media',
      'ai:thinking',
      'ai:tool_call',
      'tool:tool_response',
      'human:media',
    ])
      expect(seen.has(rule)).toBe(true);
  });

  it('keeps the thinking of the last thinking row when rows have no blocks', async () => {
    const thinking = (thought: string): IContent => ({
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought, sourceField: 'thinking' },
        { type: 'text', text: `answer after ${thought}` },
      ],
    });
    const rows: IContent[] = [
      blocklessRow('human'),
      thinking('first'),
      blocklessRow('ai'),
      blocklessRow('ai'),
      { speaker: 'human', blocks: [{ type: 'text', text: 'again' }] },
      thinking('last'),
      blocklessRow('ai'),
    ];
    const settings: Settings = {
      toolFormat: 'openai',
      strip: 'allButLast',
      include: true,
    };
    expect(
      await firstDifference('last thinking', rows, settings),
    ).toBeUndefined();
    const body: Array<{ reasoning_content?: string }> = JSON.parse(
      (await builderBytes(rows, settings)).toString('utf8'),
    );
    expect(body.map((message) => message.reasoning_content)).toStrictEqual([
      undefined,
      undefined,
      'last',
    ]);
  });

  it('matches for orphan calls, orphan results and block-less rows with ids from other providers', async () => {
    const call = (id: string, name: string): ContentBlock => ({
      type: 'tool_call',
      id,
      name,
      parameters: { id },
    });
    const result = (callId: string, toolName: string): ContentBlock => ({
      type: 'tool_response',
      callId,
      toolName,
      result: `result of ${callId}`,
    });
    const rows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] },
      {
        speaker: 'ai',
        blocks: [call('toolu_01ABC', 'read_file'), call('call_xyz', 'search')],
      },
      {
        speaker: 'tool',
        blocks: [
          result('toolu_01ABC', 'read_file'),
          result('never_called', 'search'),
        ],
      },
      blocklessRow('tool'),
      { speaker: 'ai', blocks: [call('toolu_01ABC', 'read_file')] },
      {
        speaker: 'tool',
        blocks: [
          result('toolu_01ABC', 'read_file'),
          result('call_xyz', 'search'),
        ],
      },
      { speaker: 'ai', blocks: [call('functions.read_file:7', 'read_file')] },
    ];
    const differences: string[] = [];
    for (const settings of allSettings()) {
      const difference = await firstDifference('shapes', rows, settings);
      if (difference !== undefined) differences.push(difference);
    }
    expect(differences).toStrictEqual([]);
  });

  it('matches a message larger than one output chunk', async () => {
    const big = 'ø'.repeat(150_000);
    const rows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: big }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'c1', name: 'n', parameters: {} }],
      },
      {
        speaker: 'tool',
        blocks: [
          { type: 'tool_response', callId: 'c1', toolName: 'n', result: big },
        ],
      },
    ];
    const chunkCounts: number[] = [];
    await writeChatMessages(
      sourceOf(rows),
      {
        reasoning: reasoningOptions({
          toolFormat: 'openai',
          strip: 'none',
          include: false,
        }),
        toolFormat: 'openai',
      },
      {
        message(chunks): void {
          chunkCounts.push([...chunks].length);
        },
      },
    );
    expect(chunkCounts[0]).toBeGreaterThan(1);
    expect(chunkCounts[2]).toBeGreaterThan(1);
    expect(
      await firstDifference('large', rows, {
        toolFormat: 'openai',
        strip: 'none',
        include: false,
      }),
    ).toBeUndefined();
  });
});

describe('chat body builder over the golden histories', () => {
  let corpus: Corpus;
  beforeAll(async () => {
    corpus = await createCorpus();
  });
  afterAll(async () => {
    await corpus.dispose();
  });

  function inlineReferences(row: IContent): IContent {
    return {
      ...row,
      blocks: row.blocks.map((block) =>
        block.type === 'media' && block.encoding === 'reference'
          ? {
              type: 'media',
              mimeType: block.mimeType,
              encoding: 'base64',
              data: 'AQID',
            }
          : block,
      ),
    };
  }

  async function* resolveStage(
    rows: AsyncIterable<IContent>,
  ): AsyncGenerator<IContent> {
    for await (const row of rows) yield inlineReferences(row);
  }

  it('has all 22 histories', () => {
    expect(corpus.histories).toHaveLength(22);
  });

  it('matches every setting for every history, resolving media in the stage', async () => {
    const differences: string[] = [];
    for (const history of corpus.histories) {
      const resolved = history.rows.map(inlineReferences);
      for (const settings of allSettings()) {
        const difference = await firstDifference(
          history.id,
          history.rows,
          settings,
          { mediaStage: resolveStage },
          resolved,
        );
        if (difference !== undefined) differences.push(difference);
      }
    }
    expect(differences).toStrictEqual([]);
  }, 180_000);

  it('reads the media-reference history through the stage', async () => {
    const history = corpus.histories.find(
      (candidate) => candidate.id === 'media-reference-image',
    );
    if (history === undefined) throw new Error('missing history');
    const body = (
      await builderBytes(
        history.rows,
        { toolFormat: 'openai', strip: 'none', include: false },
        { mediaStage: resolveStage },
      )
    ).toString('utf8');
    expect(body).toContain('data:image/png;base64,AQID');
  });
});

describe('chat body builder contract', () => {
  const settings: Settings = {
    toolFormat: 'kimi',
    strip: 'none',
    include: false,
  };
  const rows = seededHistory(7);

  it('is sensitive to the settings it is compared under', async () => {
    const thinkingRows: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'why', sourceField: 'thinking' },
          { type: 'text', text: 'a' },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'q2' }] },
    ];
    const keep: Settings = {
      toolFormat: 'openai',
      strip: 'none',
      include: true,
    };
    const drop: Settings = { ...keep, strip: 'all' };
    const kept = await builderBytes(thinkingRows, keep);
    expect(kept.equals(oracleBytes(thinkingRows, drop))).toBe(false);
    expect(kept.equals(oracleBytes(thinkingRows, keep))).toBe(true);
  });

  it('numbers Kimi ids differently from the generic format, so the id rules are exercised', async () => {
    const withCalls = seededHistory(3).concat(seededHistory(4));
    const kimi = await builderBytes(withCalls, { ...settings });
    const generic = oracleBytes(withCalls, {
      ...settings,
      toolFormat: 'openai',
    });
    expect(kimi.equals(generic)).toBe(false);
    expect(kimi.equals(oracleBytes(withCalls, settings))).toBe(true);
  });

  it('gives the same bytes over an in-memory id store and the disk store', async () => {
    for (const toolFormat of ['kimi', 'mistral'] as const)
      for (let seed = 1; seed <= 10; seed++) {
        const current = { ...settings, toolFormat };
        const memory = await builderBytes(seededHistory(seed), current, {
          toolIdStore: createInMemoryToolIdStore(),
        });
        expect(
          memory.equals(await builderBytes(seededHistory(seed), current)),
        ).toBe(true);
      }
  });

  it('requires an id store for Kimi and Mistral and none for other formats', async () => {
    for (const toolFormat of ['kimi', 'mistral'] as const) {
      const failing = streamChatMessages(sourceOf(rows), {
        reasoning: reasoningOptions({ ...settings, toolFormat }),
        toolFormat,
      });
      await expect(failing.next()).rejects.toThrow(
        `A tool id store is required for the ${toolFormat} format`,
      );
    }
    const openai = streamChatMessages(sourceOf(rows), {
      reasoning: reasoningOptions(settings),
      toolFormat: 'openai',
    });
    await openai.next();
    await openai.return(undefined);
  });

  it('runs the media stage once, on the conversion pass only', async () => {
    const seenByStage: number[] = [];
    let stageRuns = 0;
    const history = [
      ...seededHistory(5),
      blocklessRow('ai'),
      ...seededHistory(6),
    ];
    await builderBytes(history, settings, {
      async *mediaStage(input) {
        stageRuns++;
        let seen = 0;
        for await (const row of input) {
          seen++;
          yield row;
        }
        seenByStage.push(seen);
      },
    });
    expect(stageRuns).toBe(1);
    expect(seenByStage).toStrictEqual([
      history.filter((row) => Array.isArray(row.blocks)).length,
    ]);
  });

  it('fails when the rows differ between the two passes', async () => {
    let passes = 0;
    const unstable: ChatBodyRows = {
      async *rows(): AsyncIterable<IContent> {
        passes++;
        yield* rows.slice(0, passes === 1 ? rows.length : rows.length - 1);
      },
    };
    await expect(
      writeChatMessages(
        unstable,
        {
          reasoning: reasoningOptions({ ...settings, toolFormat: 'openai' }),
          toolFormat: 'openai',
        },
        { message(): void {} },
      ),
    ).rejects.toThrow('Chat body rows changed between passes');
  });

  it('propagates a failing sink and removes its scratch files', async () => {
    const before = scratchNames();
    const withMedia = [
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c',
            toolName: 'n',
            result: 'r',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'AQID',
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
    ] satisfies IContent[];
    await expect(
      writeChatMessages(
        sourceOf(withMedia),
        {
          reasoning: reasoningOptions({ ...settings, toolFormat: 'openai' }),
          toolFormat: 'openai',
        },
        {
          message(): void {
            throw new Error('sink refused');
          },
        },
      ),
    ).rejects.toThrow('sink refused');
    expect(scratchNames()).toStrictEqual(before);
  });

  it('removes its scratch files when the consumer stops early and when it finishes', async () => {
    const before = scratchNames();
    const stream = streamChatMessages(sourceOf(seededHistory(9)), {
      reasoning: reasoningOptions({ ...settings, toolFormat: 'openai' }),
      toolFormat: 'openai',
    });
    await stream.next();
    expect(scratchNames().size).toBeGreaterThan(before.size);
    await stream.return(undefined);
    expect(scratchNames()).toStrictEqual(before);
    await builderBytes(seededHistory(9), settings);
    expect(scratchNames()).toStrictEqual(before);
  });
});
