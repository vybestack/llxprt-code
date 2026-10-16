import { describe, expect, it } from 'bun:test';
import { MetadataJsonProjection } from './metadataJsonProjection.js';

describe('journal metadata JSON projection', () => {
  it(
    'retains envelope and metadata fields without materializing content values',
    verifyRetainsEnvelopeAndMetadataFieldsWithoutMaterializingContentValues,
  );

  it(
    'preserves escaped names and header arrays across arbitrary chunks',
    verifyPreservesEscapedNamesAndHeaderArraysAcrossArbitraryChunks,
  );

  it.each([
    '{"payload":{"content":{"bad":tru}}}',
    '{"payload":{"history":[1,]}}',
    '{"payload":{"content":"\\q"}}',
    '{"payload":{"content":{"a":1,}}}',
    '{"payload":{"content":01}}',
    '{"payload":{"content":1e}}',
    '{"payload":{"content":"unterminated}}',
    '{"seq":2}{}',
  ])('rejects malformed JSON even inside discarded values: %s', (input) => {
    const parser = new MetadataJsonProjection();
    expect(() => {
      parser.push(input);
      parser.finish();
    }).toThrow(/JSON|Unicode/);
  });

  it(
    'does not retain a context-sized purge array',
    verifyDoesNotRetainAContextSizedPurgeArray,
  );
});

describe('selected metadata allocation limits', () => {
  it(
    'accepts the container boundary and refuses the next allocation',
    verifyAcceptsTheContainerBoundaryAndRefusesTheNextAllocation,
  );

  it(
    'preserves a valid wide workspace at the value boundary',
    verifyPreservesAValidWideWorkspaceAtTheValueBoundary,
  );

  it(
    'does not budget the count of discarded history containers',
    verifyDoesNotBudgetTheCountOfDiscardedHistoryContainers,
  );

  it(
    'rejects a selected nested tree at the existing depth boundary',
    verifyRejectsASelectedNestedTreeAtTheExistingDepthBoundary,
  );

  it(
    'rejects aggregate bytes before decoding the unfinished string',
    verifyRejectsAggregateBytesBeforeDecodingTheUnfinishedString,
  );

  it(
    'rejects tiny selected containers while the array is still streaming',
    verifyRejectsTinySelectedContainersWhileTheArrayIsStillStreaming,
  );

  it(
    'rejects a reference-heavy selected array before its closing delimiter',
    verifyRejectsAReferenceHeavySelectedArrayBeforeItsClosingDelimiter,
  );

  it(
    'charges selected string input before decoding an oversized aggregate',
    verifyChargesSelectedStringInputBeforeDecodingAnOversizedAggregate,
  );
});

function verifyRetainsEnvelopeAndMetadataFieldsWithoutMaterializingContentValues(): void {
  const parser = new MetadataJsonProjection();
  const input = JSON.stringify({
    payload: {
      content: { speaker: 'human', blocks: [{ text: 'x'.repeat(10000) }] },
      name: 'hello',
    },
    v: 1,
    seq: 2,
    type: 'content',
  });
  for (const character of input) parser.push(character);
  expect(parser.finish()).toStrictEqual({
    payload: { name: 'hello' },
    v: 1,
    seq: 2,
    type: 'content',
  });
  expect(parser.metrics().maxTokenCharacters).toBeLessThan(32);
}

function verifyPreservesEscapedNamesAndHeaderArraysAcrossArbitraryChunks(): void {
  const parser = new MetadataJsonProjection();
  const value = {
    payload: { name: 'quote"\\\n雪', workspaceDirs: ['/a', '/b'] },
    seq: 12,
  };
  const input = JSON.stringify(value);
  for (let i = 0; i < input.length; i += 3) parser.push(input.slice(i, i + 3));
  expect(parser.finish()).toStrictEqual(value);
}

function verifyDoesNotRetainAContextSizedPurgeArray(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"v":1,"type":"semantic_media_purge","payload":{"history":[');
  for (let i = 0; i < 4000; i++) {
    parser.push(`${i === 0 ? '' : ','}{"speaker":"ai","blocks":[]}`);
  }
  parser.push('],"frontier":{"contentIndex":0,"blockIndex":0}}}');
  expect(parser.finish()).toStrictEqual({
    v: 1,
    type: 'semantic_media_purge',
    payload: {},
  });
  expect(parser.metrics().maxTokenCharacters).toBeLessThan(32);
}

function verifyAcceptsTheContainerBoundaryAndRefusesTheNextAllocation(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"directories":[');
  for (let index = 0; index < 65533; index++) {
    parser.push(`${index === 0 ? '' : ','}[]`);
  }
  expect(() => parser.push(',[')).toThrow(/containers limit/);
  expect(parser.metrics()).toMatchObject({
    metadataContainers: 65536,
    metadataValues: 65536,
  });
}

function verifyPreservesAValidWideWorkspaceAtTheValueBoundary(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"workspaceDirs":[');
  for (let index = 0; index < 262141; index++) {
    parser.push(`${index === 0 ? '' : ','}"/workspace/${index}"`);
  }
  expect(parser.metrics().metadataValues).toBe(262144);
  parser.push(']}}');
  const result = parser.finish();
  expect(result).toHaveProperty('payload.workspaceDirs.length', 262141);
  expect(result).toHaveProperty(
    'payload.workspaceDirs.262140',
    '/workspace/262140',
  );
}

function verifyDoesNotBudgetTheCountOfDiscardedHistoryContainers(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"history":[');
  for (let index = 0; index < 262145; index++) {
    parser.push(`${index === 0 ? '' : ','}[]`);
  }
  parser.push('],"workspaceDirs":["/real"]}}');
  expect(parser.finish()).toStrictEqual({
    payload: { workspaceDirs: ['/real'] },
  });
  expect(parser.metrics().metadataContainers).toBe(3);
}

function verifyRejectsASelectedNestedTreeAtTheExistingDepthBoundary(): void {
  const parser = new MetadataJsonProjection();
  expect(() =>
    parser.push('{"payload":{"directories":' + '['.repeat(255)),
  ).toThrow(/JSON nesting limit/);
}

function verifyRejectsAggregateBytesBeforeDecodingTheUnfinishedString(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"name":"');
  const remaining = (67108864 - parser.metrics().allocationBytes) / 4;
  for (let index = 0; index < remaining; index += 1024) {
    parser.push('x'.repeat(Math.min(1024, remaining - index)));
  }
  expect(() => parser.push('x')).toThrow(/allocationBytes limit/);
  expect(parser.metrics().allocationBytes).toBe(67108864);
}

function verifyRejectsTinySelectedContainersWhileTheArrayIsStillStreaming(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"directories":[');
  expect(() => {
    for (let index = 0; index < 65536; index++) {
      parser.push(`${index === 0 ? '' : ','}[]`);
    }
  }).toThrow(/Journal metadata.*container.*65536/);
}

function verifyRejectsAReferenceHeavySelectedArrayBeforeItsClosingDelimiter(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"workspaceDirs":[');
  expect(() => {
    for (let index = 0; index < 262144; index++) {
      parser.push(`${index === 0 ? '' : ','}null`);
    }
  }).toThrow(/Journal metadata.*value.*262144/);
}

function verifyChargesSelectedStringInputBeforeDecodingAnOversizedAggregate(): void {
  const parser = new MetadataJsonProjection();
  parser.push('{"payload":{"directories":["');
  expect(() => {
    for (let index = 0; index < 16384; index++) parser.push('x'.repeat(1024));
  }).toThrow(/Journal metadata.*allocationBytes.*67108864/);
}
