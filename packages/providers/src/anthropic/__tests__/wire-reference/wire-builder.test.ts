import { normalizedRows } from '../../../__tests__/support/frozenWire/normalizedRows.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createCorpus,
  type Corpus,
} from '../../../__tests__/support/wireBodyCorpus.js';
import {
  resolveRowsMedia,
  type RowsMediaInput,
} from '../../../openai-responses/responses-row-media.js';
import { resolveRequestMedia } from '../../../utils/request-media-resolution.js';
import type { MediaStage } from '../../native-anthropic-media-stage.js';
import {
  aiText,
  answerRow,
  callRow,
  text,
  thinkingOnly,
} from './support/wireBuilderRows.js';
import {
  CURRENT_BASE_URL,
  CURRENT_MODEL,
  pngOf,
  wireHistory,
} from './support/wireBuilderCorpus.js';
import {
  everyReasoningSetting,
  settingsFor,
} from './support/wireBuilderSettings.js';
import {
  candidateJson,
  describeDifference,
  oracleJson,
  type WireSettings,
} from './support/wireBuilderHarness.js';

async function differences(
  label: string,
  rows: readonly IContent[],
  settings: readonly WireSettings[],
): Promise<string[]> {
  const nativeRows = await normalizedRows(rows);
  const found: string[] = [];
  for (const [index, setting] of settings.entries()) {
    const difference = describeDifference(
      oracleJson(nativeRows, setting),
      await candidateJson(nativeRows, setting),
    );
    if (difference !== undefined)
      found.push(
        `${label} / ${index} ${JSON.stringify(setting)}: ${difference}`,
      );
  }
  return found;
}

describe('wire builder over seeded histories', () => {
  it('builds the messages convertToAnthropicMessages makes, byte for byte', async () => {
    const found: string[] = [];
    for (let seed = 0; seed < 700; seed++)
      found.push(
        ...(await differences(`seed ${seed}`, wireHistory(seed), [
          settingsFor(seed),
        ])),
      );
    expect(found).toStrictEqual([]);
  }, 180_000);

  it('agrees under every reasoning setting for histories rich in thinking runs', async () => {
    const found: string[] = [];
    const settings = everyReasoningSetting();
    for (let seed = 1000; seed < 1040; seed++)
      found.push(
        ...(await differences(`seed ${seed}`, wireHistory(seed), settings)),
      );
    expect(found).toStrictEqual([]);
  }, 180_000);

  it('draws histories that reach the repair paths and the thinking rules', () => {
    const json = Array.from({ length: 700 }, (_, seed) =>
      oracleJson(wireHistory(seed), settingsFor(seed)),
    ).join('\n');
    for (const feature of [
      '[tool execution interrupted]',
      '"type":"redacted_thinking"',
      '"type":"thinking"',
      '"type":"document"',
      '"type":"image"',
      'Image dropped',
      '[Empty message]',
      'Continue the conversation',
    ])
      expect(json).toContain(feature);
  });
});

describe('wire builder over targeted histories', () => {
  it('moves displaced, orphaned and interleaved tool results like the array route', async () => {
    const histories: Record<string, IContent[]> = {
      displaced: [
        text('start'),
        callRow('a'),
        text('interrupt'),
        callRow('b'),
        answerRow('a', 'b'),
        aiText('done'),
      ],
      'displaced to a message that survives': [
        callRow('a', 'c'),
        callRow('a'),
        text('later'),
        answerRow('a'),
        answerRow('c'),
      ],
      orphans: [
        answerRow('nobody'),
        text('q'),
        answerRow('ghost'),
        aiText('a'),
        callRow('x'),
        answerRow('x', 'ghost'),
      ],
      interleaved: [
        text('q'),
        callRow('a'),
        callRow('b'),
        answerRow('b'),
        text('mid'),
        answerRow('a'),
        callRow('c'),
      ],
      'unanswered at the end': [text('q'), callRow('a', 'b')],
      'calls before a non-user message': [
        callRow('a'),
        aiText('no results follow'),
        text('q'),
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await differences(label, rows, everyReasoningSetting())));
    expect(found).toStrictEqual([]);
    expect(
      oracleJson(histories['displaced'], { reasoningEnabled: false }),
    ).toContain('"tool_use_id":"toolu_a"');
    expect(
      oracleJson(histories['unanswered at the end'], {
        reasoningEnabled: false,
      }),
    ).toContain('[tool execution interrupted]');
  });

  it('merges thinking-only runs, redacts by policy and keeps results of chain rows', async () => {
    const chainWithResults: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'the report' },
        { type: 'tool_call', id: 'k', name: 'read_file', parameters: {} },
        {
          type: 'tool_response',
          callId: 'k',
          toolName: 'read_file',
          result: 'inline',
        },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: pngOf(10, 10),
        },
      ],
    };
    const histories: Record<string, IContent[]> = {
      'one run': [
        text('q'),
        thinkingOnly('first'),
        aiText('then text'),
        callRow('a'),
        answerRow('a'),
      ],
      'two runs, the last group keeps its thinking': [
        text('q'),
        thinkingOnly('one'),
        aiText('a1'),
        text('q2'),
        thinkingOnly('two'),
        callRow('b'),
        answerRow('b'),
        aiText('end'),
      ],
      'a run that ends where the next row is not an AI row': [
        thinkingOnly('lonely'),
        text('q'),
      ],
      'a run whose rows carry results and media': [
        text('q'),
        callRow('m'),
        answerRow('m'),
        thinkingOnly('t'),
        chainWithResults,
        text('after'),
      ],
      'a run with a row the model strip drops in the middle': [
        text('q'),
        thinkingOnly('t'),
        thinkingOnly('foreign', 'other-model'),
        aiText('visible'),
        text('q2'),
      ],
      'redacted thinking beside unsigned thinking': [
        text('q'),
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'unsigned', sourceField: 'thinking' },
            { type: 'thinking', thought: 'other', sourceField: 'reasoning' },
            { type: 'text', text: 'x' },
          ],
        },
        thinkingOnly('signed'),
        aiText('y'),
      ],
    };
    const found: string[] = [];
    for (const [label, rows] of Object.entries(histories))
      found.push(...(await differences(label, rows, everyReasoningSetting())));
    expect(found).toStrictEqual([]);
    const redacted = oracleJson(histories['one run'], {
      reasoningEnabled: true,
      strip: 'all',
      currentModel: CURRENT_MODEL,
    });
    expect(redacted).toContain('"type":"redacted_thinking"');
    expect(redacted).toContain('"data":"sig"');
  });

  it('converts images and documents in human rows and in tool results', async () => {
    const png = pngOf(10, 10);
    const rows: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'look' },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: png,
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            data: 'JVBERi0x',
            filename: 'spec.pdf',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'url',
            data: 'https://example.com/a.png',
          },
        ],
      },
      callRow('img'),
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'img',
            toolName: 'read_file',
            result: 'two files',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: png,
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            encoding: 'base64',
            data: 'JVBERi0x',
          },
          {
            type: 'media',
            mimeType: 'video/mp4',
            encoding: 'base64',
            data: 'AAAAGGZ0eXA=',
          },
        ],
      },
    ];
    const settings = [true, false, undefined].flatMap((supportsUrlImages) =>
      everyReasoningSetting({ supportsUrlImages }),
    );
    expect(await differences('media', rows, settings)).toStrictEqual([]);
    const json = oracleJson(rows, { reasoningEnabled: false });
    for (const feature of ['"type":"image"', '"type":"document"', 'spec.pdf'])
      expect(json).toContain(feature);
  });

  it('strips thinking of another model or endpoint, and only that', async () => {
    const stamped = (model?: string, providerBaseURL?: string): IContent => ({
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 't',
          sourceField: 'thinking',
          signature: 's',
        },
        { type: 'text', text: 'answer' },
      ],
      metadata: {
        ...(model === undefined ? {} : { model }),
        ...(providerBaseURL === undefined ? {} : { providerBaseURL }),
      },
    });
    const rows: IContent[] = [
      answerRow('leading'),
      text('q'),
      stamped(CURRENT_MODEL, CURRENT_BASE_URL),
      thinkingOnly('foreign only', 'other-model'),
      stamped('other-model'),
      stamped(CURRENT_MODEL, 'https://elsewhere.example/'),
      stamped(undefined, undefined),
      text('q2'),
    ];
    const settings = everyReasoningSetting().concat([
      { reasoningEnabled: true },
      { reasoningEnabled: true, currentModel: CURRENT_MODEL },
    ]);
    expect(await differences('strip', rows, settings)).toStrictEqual([]);
    const kept = oracleJson(rows, {
      reasoningEnabled: true,
      currentModel: CURRENT_MODEL,
      currentBaseURL: CURRENT_BASE_URL,
    });
    const without = oracleJson(rows, { reasoningEnabled: true });
    expect(kept.split('"type":"thinking"').length).toBeLessThan(
      without.split('"type":"thinking"').length,
    );
  });

  it('replaces oversized images by the budget and leaves the rest', async () => {
    const image = (width: number, height: number): IContent => ({
      speaker: 'human',
      blocks: [
        { type: 'text', text: `${width}x${height}` },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: pngOf(width, height),
        },
      ],
    });
    const rows = [
      image(10, 10),
      image(4096, 4096),
      aiText('ok'),
      image(3000, 20),
      image(1999, 2000),
    ];
    const budgets = [
      undefined,
      { maxDimension: 2000 },
      { maxPixels: 1_000_000 },
      { maxDimension: 100, maxPixels: 5000 },
    ];
    const settings = budgets.flatMap((imageBudget) =>
      everyReasoningSetting({ imageBudget }),
    );
    expect(await differences('budget', rows, settings)).toStrictEqual([]);
    const limited = oracleJson(rows, {
      reasoningEnabled: false,
      imageBudget: { maxDimension: 2000 },
    });
    expect(limited.split('Image dropped').length - 1).toBe(2);
  });

  it('applies the budget to the resolved bytes of an image in a thinking run', async () => {
    const stored = (data: string): IContent => ({
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'figure' },
        { type: 'media', mimeType: 'image/png', encoding: 'base64', data },
      ],
    });
    // The stored row holds a stub; the stage swaps in the real, oversized image.
    const big = pngOf(4096, 4096);
    const mediaStage: MediaStage = async function* (input) {
      for await (const row of input)
        yield {
          ...row,
          blocks: row.blocks.map(
            (block): ContentBlock =>
              block.type === 'media' && block.encoding === 'base64'
                ? { ...block, data: big }
                : block,
          ),
        };
    };
    const settings: WireSettings = {
      reasoningEnabled: true,
      imageBudget: { maxDimension: 2000 },
    };
    const history = [text('q'), thinkingOnly('t'), stored('stub'), text('q2')];
    const resolvedHistory = history.map((row) =>
      row.speaker === 'ai' && row.blocks.some((block) => block.type === 'media')
        ? stored(big)
        : row,
    );
    const expected = oracleJson(resolvedHistory, settings);
    expect(expected).toContain('Image dropped');
    expect(
      describeDifference(
        expected,
        await candidateJson(history, settings, { mediaStage }),
      ),
    ).toBeUndefined();
  });
});

describe('wire builder over the golden histories', () => {
  let corpus: Corpus;
  beforeAll(async () => {
    corpus = await createCorpus();
  });
  afterAll(async () => {
    await corpus.dispose();
  });

  function mediaInput(): RowsMediaInput {
    return {
      requestId: 'wire-builder-test',
      aggregateBudgetBytes: corpus.binding.budgetBytes,
      resolver: corpus.binding.resolver,
    };
  }

  async function oracleOnResolved(
    rows: readonly IContent[],
    settings: WireSettings,
  ): Promise<string> {
    const resolved = await resolveRequestMedia(
      mediaInput(),
      structuredClone([...rows]),
      undefined,
    );
    try {
      return resolved.withContents((contents) =>
        oracleJson(contents, settings),
      );
    } finally {
      await resolved.release();
    }
  }

  async function candidateOnStage(
    rows: readonly IContent[],
    settings: WireSettings,
  ): Promise<string> {
    const owner = await resolveRequestMedia(mediaInput(), [], undefined);
    const mediaStage: MediaStage = (input) =>
      resolveRowsMedia(input, mediaInput(), owner, undefined);
    try {
      return await candidateJson(rows, settings, { mediaStage });
    } finally {
      await owner.release();
    }
  }

  it('has all 22 histories', () => {
    expect(corpus.histories).toHaveLength(22);
  });

  it('builds every history under every reasoning setting, resolving media row by row', async () => {
    const found: string[] = [];
    for (const history of corpus.histories)
      for (const settings of everyReasoningSetting()) {
        const difference = describeDifference(
          await oracleOnResolved(history.rows, settings),
          await candidateOnStage(history.rows, settings),
        );
        if (difference !== undefined)
          found.push(
            `${history.id} ${JSON.stringify(settings)}: ${difference}`,
          );
      }
    expect(found).toStrictEqual([]);
  }, 180_000);

  it('puts the resolved bytes of a media reference into the table', async () => {
    const history = corpus.histories.find(
      (candidate) => candidate.id === 'media-reference-image',
    );
    if (history === undefined) throw new Error('missing history');
    const json = await candidateOnStage(history.rows, {
      reasoningEnabled: false,
    });
    expect(json).toContain('"data":"AQID"');
  });
});
