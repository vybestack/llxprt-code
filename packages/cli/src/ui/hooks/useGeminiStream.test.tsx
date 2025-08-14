import { describe, it, expect } from 'vitest';
import { mergePartListUnions } from './useGeminiStream';
import type { Part, PartListUnion } from '@shared/types';

describe('mergePartListUnions', () => {
  it('should merge multiple PartListUnion arrays', () => {
    const list1: PartListUnion = [{ text: 'Hello' }];
    const list2: PartListUnion = [
      { inlineData: { mimeType: 'image/png', data: 'abc' } },
    ];
    const list3: PartListUnion = [{ text: 'World' }, { text: '!' }];
    const result = mergePartListUnions([list1, list2, list3]);
    expect(result).toEqual([
      { text: 'Hello' },
      { inlineData: { mimeType: 'image/png', data: 'abc' } },
      { text: 'World' },
      { text: '!' },
    ]);
  });

  it('should handle empty arrays in the input list', () => {
    const list1: PartListUnion = [{ text: 'First' }];
    const list2: PartListUnion = [];
    const list3: PartListUnion = [{ text: 'Last' }];
    const result = mergePartListUnions([list1, list2, list3]);
    expect(result).toEqual([{ text: 'First' }, { text: 'Last' }]);
  });

  it('should handle a single PartListUnion array', () => {
    const list1: PartListUnion = [
      { text: 'One' },
      { inlineData: { mimeType: 'image/jpeg', data: 'xyz' } },
    ];
    const result = mergePartListUnions([list1]);
    expect(result).toEqual(list1);
  });

  it('should return an empty array if all input arrays are empty', () => {
    const list1: PartListUnion = [];
    const list2: PartListUnion = [];
    const result = mergePartListUnions([list1, list2]);
    expect(result).toEqual([]);
  });

  it('should handle input list being empty', () => {
    const result = mergePartListUnions([]);
    expect(result).toEqual([]);
  });

  it('should correctly merge when PartListUnion items are single Parts not in arrays', () => {
    const part1: Part = { text: 'Single part 1' };
    const part2: Part = { inlineData: { mimeType: 'image/gif', data: 'gif' } };
    const listContainingSingleParts: PartListUnion[] = [
      part1,
      part2,
      [{ text: 'Array part' }],
    ];
    const result = mergePartListUnions(listContainingSingleParts);
    expect(result).toEqual([
      { text: 'Single part 1' },
      { inlineData: { mimeType: 'image/gif', data: 'gif' } },
      { text: 'Array part' },
    ]);
  });

  it('should handle a mix of arrays and single parts, including empty arrays and undefined/null parts if they were possible (though PartListUnion typing restricts this)', () => {
    const list1: PartListUnion = { text: 'Single1' };
    const list2: PartListUnion = [];
    const list3: PartListUnion = [
      { text: 'Array1' },
      { inlineData: { mimeType: 'text/plain', data: 'txt' } },
    ];
    const list4: PartListUnion = { text: 'Single2' };
    const result = mergePartListUnions([list1, list2, list3, list4]);
    expect(result).toEqual([
      { text: 'Single1' },
      { text: 'Array1' },
      { inlineData: { mimeType: 'text/plain', data: 'txt' } },
      { text: 'Single2' },
    ]);
  });

  it('should preserve the order of parts from the input arrays', () => {
    const list1: PartListUnion = [{ text: '1' }, { text: '2' }];
    const list2: PartListUnion = [{ text: '3' }];
    const list3: PartListUnion = [{ text: '4' }, { text: '5' }];
    const result = mergePartListUnions([list1, list2, list3]);
    expect(result).toEqual([
      { text: '1' },
      { text: '2' },
      { text: '3' },
      { text: '4' },
      { text: '5' },
    ]);
  });

  it('should handle cases where some PartListUnion items are single Parts and others are arrays of Parts', () => {
    const part1: Part = { text: 'Direct Part' };
    const arrayOfParts: Part[] = [
      { text: 'Array Part 1' },
      { text: 'Array Part 2' },
    ];

    const lists: PartListUnion[] = [
      part1, // single Part
      arrayOfParts, // array of Parts
      { text: 'Another Direct Part' }, // another single Part
      [
        { inlineData: { mimeType: 'image/png', data: 'png-data' } },
        { text: 'Text in array' },
      ], // another array
    ];

    const result = mergePartListUnions(lists);
    expect(result).toEqual([
      { text: 'Direct Part' },
      { text: 'Array Part 1' },
      { text: 'Array Part 2' },
      { text: 'Another Direct Part' },
      { inlineData: { mimeType: 'image/png', data: 'png-data' } },
      { text: 'Text in array' },
    ]);
  });

  it('should preserve multiple function responses as separate parts', () => {
    const list1: PartListUnion = [
      { functionResponse: { name: 'func1', response: { result: 'data1' } } },
      { functionResponse: { name: 'func2', response: { result: 'data2' } } },
    ];
    const list2: PartListUnion = [
      { text: 'Some text' },
      { functionResponse: { name: 'func3', response: { result: 'data3' } } },
    ];

    const result = mergePartListUnions([list1, list2]);

    expect(result).toEqual([
      { functionResponse: { name: 'func1', response: { result: 'data1' } } },
      { functionResponse: { name: 'func2', response: { result: 'data2' } } },
      { text: 'Some text' },
      { functionResponse: { name: 'func3', response: { result: 'data3' } } },
    ]);
  });

  it('should merge mixed content normally when not all function responses', () => {
    const list1: PartListUnion = [
      { text: 'Hello' },
      { functionResponse: { name: 'func1', response: { result: 'data1' } } },
    ];
    const list2: PartListUnion = [{ text: 'World' }];

    const result = mergePartListUnions([list1, list2]);

    expect(result).toEqual([
      { text: 'Hello' },
      { functionResponse: { name: 'func1', response: { result: 'data1' } } },
      { text: 'World' },
    ]);
  });

  it('should handle string items in PartListUnion arrays', () => {
    const list1: PartListUnion = 'Simple string';
    const list2: PartListUnion = [{ text: 'Text in array' }];
    const list3: PartListUnion = 'Another string';
    const result = mergePartListUnions([list1, list2, list3]);
    expect(result).toEqual([
      { text: 'Simple string' },
      { text: 'Text in array' },
      { text: 'Another string' },
    ]);
  });
});
