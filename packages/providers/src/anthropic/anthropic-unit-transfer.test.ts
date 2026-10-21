/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import {
  anthropicUnitFacts,
  anthropicUnitTransfer,
  finalizeAnthropicTransfer,
  type AnthropicAtom,
} from './anthropic-unit-transfer.js';
import {
  captureRowFormatSettings,
  rowFormatKey,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  analyze,
  lcg,
} from './message-table/__tests__/support/lengthModel/lengthChecks.js';
import { candidateJson } from './message-table/__tests__/support/wireBuilderHarness.js';

const SETTINGS: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};
const QUESTION: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: '雪 "\\\n\ud800' }],
};
const FIRST: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      sourceField: 'thinking',
      thought: 'first 雪',
      signature: 'sig-first',
    },
  ],
};
const SECOND: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      sourceField: 'thinking',
      thought: 'second',
      signature: 'sig-second',
    },
    { type: 'text', text: 'answer' },
  ],
};

function fold(
  rows: readonly IContent[],
  selected: 0 | 1,
  settings = SETTINGS,
): number {
  let summary = identitySlotSummary('anthropic');
  for (const [index, row] of rows.entries()) {
    const facts = anthropicUnitFacts(row, settings);
    if (facts !== undefined)
      summary = composeSlotSummaries(
        summary,
        anthropicUnitTransfer(facts, BigInt(index + 1)),
      );
  }
  if (summary.kind !== 'anthropic')
    throw new Error('Missing Anthropic summary');
  return finalizeAnthropicTransfer(summary.variants[selected], settings).bytes;
}

describe('Anthropic numeric unit transfer', () => {
  it('matches the independent table emitter and phase-zero model for signed thinking chains and both variants', async () => {
    const rows: readonly IContent[] = [
      QUESTION,
      FIRST,
      SECOND,
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: '  first' },
          { type: 'text', text: 'second' },
        ],
      },
    ];
    for (const selected of [0, 1] satisfies ReadonlyArray<0 | 1>) {
      const wire = {
        reasoningEnabled: true,
        currentModel: SETTINGS.model,
        currentBaseURL: SETTINGS.endpoint,
        strip: selected === 0 ? 'none' : 'all',
      } satisfies Parameters<typeof candidateJson>[1];
      const expected = await candidateJson(rows, wire);
      expect(fold(rows, selected)).toBe(Buffer.byteLength(expected));
      expect(fold(rows, selected)).toBe(
        analyze(rows, wire, {}, lcg(1)).predicted,
      );
    }
  });

  it('measures assistant string merging, blank removal, empty placeholders and cross-model projection', async () => {
    const histories: ReadonlyArray<readonly IContent[]> = [
      [],
      [QUESTION],
      [FIRST],
      [
        QUESTION,
        { speaker: 'ai', blocks: [{ type: 'text', text: 'before' }] },
        { speaker: 'ai', blocks: [{ type: 'text', text: '  ' }] },
        SECOND,
      ],
      [{ ...FIRST, metadata: { model: 'another-model' } }, SECOND],
      [
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              mimeType: 'image/png',
              encoding: 'url',
              data: 'https://example.test/雪?a="',
            },
          ],
        },
        SECOND,
      ],
    ];
    for (const rows of histories) {
      const expected = await candidateJson(rows, {
        reasoningEnabled: true,
        currentModel: SETTINGS.model,
        currentBaseURL: SETTINGS.endpoint,
      });
      expect(fold(rows, 0)).toBe(Buffer.byteLength(expected));
    }
  });

  it('applies supplied repaired-adjacency atoms without merging assistant messages across the inserted result', async () => {
    const rows: readonly IContent[] = [
      QUESTION,
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: '',
            name: 'read_file',
            parameters: { path: '雪' },
          },
        ],
      },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'after' }] },
    ];
    const interruption = {
      type: 'tool_result',
      tool_use_id: 'toolu_empty',
      content: '[tool execution interrupted]',
      is_error: true,
    };
    const inserted: AnthropicAtom = {
      role: 'user',
      form: 'array',
      blocks: [
        {
          kind: 'tool_result',
          bytes: Buffer.byteLength(JSON.stringify(interruption)),
          blank: false,
          id: 'toolu_empty',
          anchored: false,
        },
      ],
    };
    let sum = identitySlotSummary('anthropic');
    for (const [at, row] of rows.entries()) {
      const facts = anthropicUnitFacts(row, SETTINGS);
      if (facts === undefined) throw new Error('Unexpected dropped unit');
      sum = composeSlotSummaries(
        sum,
        anthropicUnitTransfer(
          facts,
          BigInt(at + 1),
          at === 1 ? { after: new Map([[0, inserted]]) } : {},
        ),
      );
    }
    if (sum.kind !== 'anthropic') throw new Error('Missing summary');
    expect(finalizeAnthropicTransfer(sum.variants[0], SETTINGS).bytes).toBe(
      Buffer.byteLength(
        await candidateJson(rows, {
          reasoningEnabled: true,
          currentModel: SETTINGS.model,
          currentBaseURL: SETTINGS.endpoint,
        }),
      ),
    );
  });

  it('keys and captures image budgets and refuses unimplemented cache options explicitly', () => {
    const settings: RowFormatSettings = {
      ...SETTINGS,
      anthropic: {
        cache: 'off',
        imageBudget: { maxDimension: 2, maxPixels: 4 },
      },
    };
    const captured = captureRowFormatSettings(settings);
    if (
      captured.anthropic?.imageBudget === undefined ||
      captured.anthropic.imageBudget === null
    )
      throw new Error('Missing captured image settings');
    expect(Reflect.set(captured.anthropic.imageBudget, 'maxDimension', 3)).toBe(
      false,
    );
    expect(rowFormatKey(captured)).not.toBe(
      rowFormatKey({
        ...settings,
        anthropic: {
          cache: 'off',
          imageBudget: { maxDimension: 3, maxPixels: 4 },
        },
      }),
    );
    for (const cache of ['5m', '1h'] satisfies ReadonlyArray<'5m' | '1h'>)
      expect(() =>
        anthropicUnitFacts(QUESTION, {
          ...settings,
          anthropic: { cache, imageBudget: null },
        }),
      ).toThrow(/cache/);
  });

  it('refuses raw AI-carried results rather than silently losing them on the chain path', () => {
    expect(() =>
      anthropicUnitFacts(
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'signed',
              signature: 's',
              sourceField: 'thinking',
            },
            {
              type: 'tool_response',
              callId: 'x',
              toolName: 'read_file',
              result: 'response',
            },
          ],
        },
        SETTINGS,
      ),
    ).toThrow(/normalized/);
  });

  it('retains numeric byte facts without retaining text, signatures or tool-result payloads', () => {
    const payload = 'unique-numeric-only-payload-雪'.repeat(1000);
    const thinking = anthropicUnitFacts(
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            thought: payload,
            sourceField: 'thinking',
            signature: payload,
          },
        ],
      },
      SETTINGS,
    );
    const result = anthropicUnitFacts(
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'x',
            toolName: 'read_file',
            result: payload,
          },
        ],
      },
      SETTINGS,
    );
    expect(JSON.stringify({ thinking, result })).not.toContain(payload);
    expect(JSON.stringify({ thinking, result }).length).toBeLessThan(2000);
  });
});
