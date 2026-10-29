/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { JournalFormatError } from '../../journal/errors.js';
import { encodeRowDraft } from '../../journal/rowDraft.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { StoredRow } from '../../journal/rowReads.js';
import {
  CHRONOLOGY_SEQ_NONE,
  ROW_FLAG,
  ROW_ID_KIND,
  decodeRowHeader,
} from '../../journal/rowRecord.js';
import {
  BLOCK_TYPE,
  decodeStoredRow,
  encodeContentRow,
} from './journalRowCodec.js';
import type { ContentBlock, IContent } from './IContent.js';
import {
  CHRONOLOGY,
  MEDIA_REFERENCE,
  ROW_SHAPES,
} from './__tests__/support/journalRowShapes.js';

const LABEL = 4096n;

/** What the store hands back for a row: the header decoded from the bytes it wrote, and the pieces of the body. */
function storedOf(draft: RowDraft): StoredRow {
  const { record } = encodeRowDraft(LABEL, draft);
  const header = decodeRowHeader(record.kindHeader);
  return {
    header,
    rawIds: draft.ids.map((id) => id.rawId),
    meta: draft.meta,
    blocks: draft.blocks.map((block) => block.bytes),
  };
}

function roundTrip(content: IContent, invalidate = false): IContent {
  return decodeStoredRow(
    storedOf(
      encodeContentRow(content, { owner: 0, invalidateResponses: invalidate }),
    ),
  );
}

function flagsOf(content: IContent): number {
  return encodeContentRow(content, { owner: 0 }).flags;
}

describe('row codec round trip', () => {
  it('preserves serialized content field order across native conversion', () => {
    const content: IContent = {
      speaker: 'ai',
      metadata: { model: 'historical-model', chronology: CHRONOLOGY },
      blocks: [{ type: 'text', text: 'ordered provider request' }],
    };
    expect(JSON.stringify(roundTrip(content))).toBe(JSON.stringify(content));
    const reordered: IContent = {
      metadata: content.metadata,
      blocks: content.blocks,
      speaker: content.speaker,
    };
    expect(JSON.stringify(roundTrip(reordered))).toBe(
      JSON.stringify(reordered),
    );
  });
  for (const [name, content] of ROW_SHAPES) {
    it(`restores ${name} exactly`, () => {
      expect(roundTrip(content)).toStrictEqual(content);
    });
  }

  for (const metadata of [
    { chronology: CHRONOLOGY, model: 'm', cacheAnchor: true },
    { model: 'm', chronology: CHRONOLOGY, cacheAnchor: true },
    { model: 'm', cacheAnchor: true, chronology: CHRONOLOGY },
  ]) {
    it(`preserves serialized metadata key order ${Object.keys(metadata).join(',')}`, () => {
      const content: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'ordered metadata' }],
        metadata,
      };
      expect(JSON.stringify(roundTrip(content))).toBe(JSON.stringify(content));
    });
  }

  it('restores any entry made of the block kinds, fast-checked', () => {
    const text = fc.record({
      type: fc.constant('text' as const),
      text: fc.string(),
    });
    const call = fc.record({
      type: fc.constant('tool_call' as const),
      id: fc.string({ minLength: 1, maxLength: 12 }),
      name: fc.string({ maxLength: 12 }),
      parameters: fc.dictionary(
        fc.string({ maxLength: 5 }),
        fc.string({ maxLength: 8 }),
      ),
    });
    const response = fc.record({
      type: fc.constant('tool_response' as const),
      callId: fc.string({ minLength: 1, maxLength: 12 }),
      toolName: fc.string({ maxLength: 12 }),
      result: fc.jsonValue(),
    });
    const thinking = fc.record({
      type: fc.constant('thinking' as const),
      thought: fc.string(),
    });
    const code = fc.record({
      type: fc.constant('code' as const),
      code: fc.string(),
    });
    const block = fc.oneof(
      text,
      call,
      response,
      thinking,
      code,
    ) as fc.Arbitrary<ContentBlock>;
    fc.assert(
      fc.property(
        fc.constantFrom('human' as const, 'ai' as const, 'tool' as const),
        fc.array(block, { maxLength: 6 }),
        (speaker, blocks) => {
          const content: IContent = { speaker, blocks };
          const back = JSON.parse(JSON.stringify(roundTrip(content)));
          expect(back).toStrictEqual(JSON.parse(JSON.stringify(content)));
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('row header fields', () => {
  it('keeps chronology in the header and out of the metadata piece', () => {
    const content: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'x' }],
      metadata: { chronology: CHRONOLOGY, model: 'm' },
    };
    const draft = encodeContentRow(content, { owner: 3 });

    expect(draft.owner).toBe(3);
    expect(draft.chronologySeq).toBe(7n);
    expect(draft.chronologyUserTurn).toBe(2);
    expect(draft.chronologyStep).toBe(3);
    expect(draft.chronologyRecordedAt).toBe(1.9e12);
    const meta = new TextDecoder().decode(draft.meta);
    expect(meta).not.toContain('chronology"');
    expect(JSON.parse(meta)).toStrictEqual({
      speaker: 'human',
      metadata: { model: 'm' },
      chronologyIndex: 0,
    });
  });

  it('marks an entry without chronology as having none', () => {
    const draft = encodeContentRow(ROW_SHAPES[0][1], { owner: 0 });
    expect(draft.chronologySeq).toBe(CHRONOLOGY_SEQ_NONE);
  });

  it('drops the two request-local purge fields, which hold object identities', () => {
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x' }],
      metadata: {
        model: 'm',
        semanticMediaPurgeBoundary: { blockIndex: 0, boundaryId: {} },
        semanticMediaPurgeCacheWriteEvidence: {
          boundaryId: {},
          preparation: 'added',
        },
      },
    };
    expect(roundTrip(content).metadata).toStrictEqual({ model: 'm' });
  });

  it('records each call and response id with its block, kind, score and name length', () => {
    const draft = encodeContentRow(
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 't' },
          { type: 'tool_call', id: 'call-1', name: 'héllo', parameters: {} },
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'abc',
            result: 'ok',
            isComplete: true,
          },
          { type: 'tool_call', id: '', name: 'no-id', parameters: {} },
        ],
      },
      { owner: 0 },
    );

    expect(draft.ids).toStrictEqual([
      {
        rawId: 'call-1',
        kind: ROW_ID_KIND.call,
        block: 1,
        score: 0,
        nameLen: 6,
      },
      {
        rawId: 'call-1',
        kind: ROW_ID_KIND.response,
        block: 2,
        score: 4,
        nameLen: 3,
      },
      {
        rawId: '',
        kind: ROW_ID_KIND.call,
        block: 3,
        score: 0,
        nameLen: 5,
      },
    ]);
    expect(draft.blocks.map((block) => block.type)).toStrictEqual([
      BLOCK_TYPE.text,
      BLOCK_TYPE.tool_call,
      BLOCK_TYPE.tool_response,
      BLOCK_TYPE.tool_call,
    ]);
  });

  it('scores a failed, empty response lowest and a complete one highest', () => {
    const score = (extra: object): number =>
      encodeContentRow(
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'c',
              toolName: 't',
              result: null,
              ...extra,
            },
          ],
        },
        { owner: 0 },
      ).ids[0].score;

    expect(score({ error: 'e' })).toBe(0);
    expect(score({})).toBe(1);
    expect(score({ isComplete: true, result: 'r' })).toBe(4);
  });

  it('sets the flags from the blocks and the metadata', () => {
    const flag = (bit: number, content: IContent): boolean =>
      (flagsOf(content) & bit) !== 0;
    const ai = (blocks: ContentBlock[], metadata = {}): IContent => ({
      speaker: 'ai',
      blocks,
      metadata,
    });

    expect(
      flag(ROW_FLAG.hasThinking, ai([{ type: 'thinking', thought: 't' }])),
    ).toBe(true);
    expect(flag(ROW_FLAG.hasThinking, ai([{ type: 'text', text: 't' }]))).toBe(
      false,
    );
    expect(
      flag(
        ROW_FLAG.hasToolCall,
        ai([{ type: 'tool_call', id: 'a', name: 'n', parameters: {} }]),
      ),
    ).toBe(true);
    expect(flag(ROW_FLAG.hasToolResponse, ROW_SHAPES[4][1])).toBe(true);
    expect(flag(ROW_FLAG.hasMedia, ai([MEDIA_REFERENCE]))).toBe(true);
    expect(flag(ROW_FLAG.hasImage, ai([MEDIA_REFERENCE]))).toBe(true);
    expect(flag(ROW_FLAG.hasImage, ROW_SHAPES[5][1])).toBe(false);
    // Media from tools and servers can arrive without a usable MIME type; the
    // row is stored and the consumer that needs the MIME reports it.
    const noMime: ContentBlock = { ...MEDIA_REFERENCE };
    Reflect.deleteProperty(noMime, 'mimeType');
    expect(flag(ROW_FLAG.hasMedia, ai([noMime]))).toBe(true);
    expect(flag(ROW_FLAG.hasImage, ai([noMime]))).toBe(false);
    expect(
      flag(
        ROW_FLAG.cacheAnchor,
        ai([{ type: 'text', text: 'a' }], { cacheAnchor: true }),
      ),
    ).toBe(true);
    expect(
      flag(
        ROW_FLAG.synthetic,
        ai([{ type: 'text', text: 'a' }], { synthetic: true }),
      ),
    ).toBe(true);
    expect(
      flag(
        ROW_FLAG.hasCacheableBlock,
        ai([{ type: 'thinking', thought: 't' }]),
      ),
    ).toBe(false);
    expect(
      flag(ROW_FLAG.hasCacheableBlock, ai([{ type: 'text', text: '  ' }])),
    ).toBe(false);
    expect(
      flag(
        ROW_FLAG.hasCacheableBlock,
        ai([
          { type: 'thinking', thought: 't' },
          { type: 'text', text: 'a' },
        ]),
      ),
    ).toBe(true);
  });

  it('marks a row curated by the rule the history uses', () => {
    const empty: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: ' ' }],
    };
    const human: IContent = { speaker: 'human', blocks: [] };
    const answer: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'a' }],
    };

    expect(flagsOf(empty) & ROW_FLAG.curated).toBe(0);
    expect(flagsOf(human) & ROW_FLAG.curated).toBe(ROW_FLAG.curated);
    expect(flagsOf(answer) & ROW_FLAG.curated).toBe(ROW_FLAG.curated);
  });
});

describe('Responses parent rows', () => {
  const stored = (
    metadata: object,
    speaker: IContent['speaker'] = 'ai',
  ): RowDraft =>
    encodeContentRow(
      { speaker, blocks: [{ type: 'text', text: 'a' }], metadata },
      { owner: 0 },
    );

  it('flags an AI row with a stored response id and hashes the endpoint without trailing slashes', () => {
    const plain = stored({
      responsesStored: true,
      id: 'r1',
      providerBaseURL: 'https://h.invalid/v1',
    });
    const slashed = stored({
      responsesStored: true,
      id: 'r2',
      providerBaseURL: 'https://h.invalid/v1//',
    });
    const other = stored({
      responsesStored: true,
      id: 'r3',
      providerBaseURL: 'https://h.invalid/v2',
    });

    expect(plain.flags & ROW_FLAG.responseParent).toBe(ROW_FLAG.responseParent);
    expect(plain.parentEndpoint).not.toBe(0n);
    expect(slashed.parentEndpoint).toBe(plain.parentEndpoint);
    expect(other.parentEndpoint).not.toBe(plain.parentEndpoint);
  });

  it('uses the wildcard endpoint when no URL was recorded', () => {
    expect(stored({ responsesStored: true, id: 'r' }).parentEndpoint).toBe(0n);
    expect(
      stored({ responsesStored: true, id: 'r', providerBaseURL: '/' })
        .parentEndpoint,
    ).toBe(0n);
  });

  it('does not flag a row that is not a usable parent', () => {
    const flagged = (draft: RowDraft): boolean =>
      (draft.flags & ROW_FLAG.responseParent) !== 0;

    expect(flagged(stored({ responsesStored: false, id: 'r' }))).toBe(false);
    expect(flagged(stored({ responsesStored: true, id: '' }))).toBe(false);
    expect(flagged(stored({ responsesStored: true }))).toBe(false);
    expect(flagged(stored({ responsesStored: true, id: 'r' }, 'human'))).toBe(
      false,
    );
    const onlyResponse = encodeContentRow(
      {
        speaker: 'ai',
        blocks: [
          { type: 'tool_response', callId: 'c', toolName: 't', result: 1 },
        ],
        metadata: { responsesStored: true, id: 'r' },
      },
      { owner: 0 },
    );
    expect(flagged(onlyResponse)).toBe(false);
  });
});

describe('invalidated Responses chain', () => {
  const content: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'a' }],
    metadata: { responsesStored: true, id: 'r1', model: 'm' },
  };

  it('stores the flag and reads the row without responsesStored', () => {
    const draft = encodeContentRow(content, {
      owner: 0,
      invalidateResponses: true,
    });

    expect(draft.flags & ROW_FLAG.invalidateResponses).toBe(
      ROW_FLAG.invalidateResponses,
    );
    expect(decodeStoredRow(storedOf(draft)).metadata).toStrictEqual({
      id: 'r1',
      model: 'm',
    });
  });

  it('keeps responsesStored on a row written without the flag', () => {
    expect(roundTrip(content).metadata?.responsesStored).toBe(true);
  });
});

describe('media references', () => {
  it('stay references: no bytes are fetched or resolved and the stored block is the reference', () => {
    const draft = encodeContentRow(
      { speaker: 'human', blocks: [MEDIA_REFERENCE] },
      { owner: 0 },
    );

    const stored = JSON.parse(new TextDecoder().decode(draft.blocks[0].bytes));
    expect(stored).toStrictEqual(MEDIA_REFERENCE);
    expect(stored.encoding).toBe('reference');
    expect(stored.data).toBeUndefined();
    expect(draft.blocks[0].bytes.length).toBeLessThan(2048);
  });
});

describe('a stored row that disagrees with itself', () => {
  for (const chronologyIndex of [undefined, -1, 0.5, 2]) {
    it(`rejects an invalid chronology position ${String(chronologyIndex)}`, () => {
      const stored = storedOf(
        encodeContentRow(
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'x' }],
            metadata: { chronology: CHRONOLOGY, model: 'm' },
          },
          { owner: 0 },
        ),
      );
      const meta = new TextEncoder().encode(
        JSON.stringify({
          speaker: 'human',
          metadata: { model: 'm' },
          chronologyIndex,
        }),
      );
      expect(() => decodeStoredRow({ ...stored, meta })).toThrow(
        JournalFormatError,
      );
    });
  }

  it('throws when a block is not of the type its directory entry says', () => {
    const stored = storedOf(encodeContentRow(ROW_SHAPES[0][1], { owner: 0 }));
    const wrong: StoredRow = {
      ...stored,
      header: {
        ...stored.header,
        blocks: stored.header.blocks.map((entry) => ({
          ...entry,
          type: BLOCK_TYPE.code,
        })),
      },
    };

    expect(() => decodeStoredRow(wrong)).toThrow(JournalFormatError);
  });

  it('throws when the speaker code and the metadata piece differ', () => {
    const stored = storedOf(encodeContentRow(ROW_SHAPES[0][1], { owner: 0 }));
    const wrong: StoredRow = {
      ...stored,
      header: { ...stored.header, speaker: 1 },
    };

    expect(() => decodeStoredRow(wrong)).toThrow(JournalFormatError);
  });

  it('throws for a speaker that has no code', () => {
    const content = { speaker: 'robot', blocks: [] } as unknown as IContent;

    expect(() => encodeContentRow(content, { owner: 0 })).toThrow(
      JournalFormatError,
    );
  });
});
