import { describe, it, expect } from 'vitest';
import { consolidateTextParts } from './streamResponseHelpers.js';
import type { Part } from '@google/genai';
import { isThoughtPart } from './googlePartHelpers.js';

function thoughtPart(params: {
  text: string;
  signature?: string;
  streamId?: string;
  streamStatus?: 'delta' | 'complete';
}): Part {
  return {
    thought: true,
    text: params.text,
    ...(params.signature !== undefined
      ? { thoughtSignature: params.signature }
      : {}),
    ...(params.streamId !== undefined
      ? { llxprtThoughtBlockId: params.streamId }
      : {}),
    ...(params.streamStatus !== undefined
      ? { llxprtThoughtBlockStatus: params.streamStatus }
      : {}),
    llxprtSourceField: 'thinking',
  };
}

function textPart(text: string): Part {
  return { text };
}

function thinkingTexts(parts: Part[]): string[] {
  return parts.filter(isThoughtPart).map((part) => part.text ?? '');
}

function thinkingSignatures(parts: Part[]): Array<string | undefined> {
  return parts.filter(isThoughtPart).map((part) => part.thoughtSignature);
}

describe('consolidateTextParts identity-aware thinking consolidation', () => {
  it('replaces incremental updates for the same stream id with the final signed block', () => {
    const parts: Part[] = [
      thoughtPart({
        text: 'Analyzing',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thoughtPart({
        text: 'Analyzing the data',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thoughtPart({
        text: 'Analyzing the data',
        signature: 'sig-final',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextParts(parts);

    expect(thinkingTexts(result)).toStrictEqual(['Analyzing the data']);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-final']);
  });

  it('keeps adjacent signed blocks distinct when prefix-overlapping text has different stream ids', () => {
    const parts: Part[] = [
      thoughtPart({
        text: 'Plan',
        signature: 'sig-one',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
      thoughtPart({
        text: 'Plan the second step',
        signature: 'sig-two',
        streamId: 'thinking:1',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextParts(parts);

    expect(thinkingTexts(result)).toStrictEqual([
      'Plan',
      'Plan the second step',
    ]);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-one', 'sig-two']);
  });

  it('does not use text prefixes to merge unsigned parts without stream identity', () => {
    const parts: Part[] = [
      thoughtPart({ text: 'I think', signature: 'sig-one' }),
      thoughtPart({ text: 'I think this is separate', signature: 'sig-two' }),
    ];

    const result = consolidateTextParts(parts);

    expect(thinkingTexts(result)).toStrictEqual([
      'I think',
      'I think this is separate',
    ]);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-one', 'sig-two']);
  });

  it('does not mutate input parts while consolidating text and thinking updates', () => {
    const firstText = textPart('Hello');
    const secondText = textPart(' world');
    const firstThought = thoughtPart({
      text: 'Partial',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    const finalThought = thoughtPart({
      text: 'Partial thought',
      signature: 'sig123',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });
    const parts: Part[] = [firstText, secondText, firstThought, finalThought];

    const result = consolidateTextParts(parts);

    expect(parts).toStrictEqual([
      firstText,
      secondText,
      firstThought,
      finalThought,
    ]);
    expect(firstText.text).toBe('Hello');
    expect(firstThought.text).toBe('Partial');
    expect(firstThought.thoughtSignature).toBeUndefined();
    expect(result.map((part) => part.text)).toStrictEqual([
      'Hello world',
      'Partial thought',
    ]);
    expect(thinkingSignatures(result)).toStrictEqual(['sig123']);
  });

  it('preserves text parts alongside consolidated thinking', () => {
    const parts: Part[] = [
      thoughtPart({
        text: 'Thinking',
        signature: 'sig1',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
      textPart('Hello'),
      textPart(' world'),
    ];

    const result = consolidateTextParts(parts);

    expect(result).toHaveLength(2);
    expect(thinkingTexts(result)).toStrictEqual(['Thinking']);
    expect(thinkingSignatures(result)).toStrictEqual(['sig1']);
    expect(
      result.filter((part) => !isThoughtPart(part)).map((part) => part.text),
    ).toStrictEqual(['Hello world']);
  });

  it('returns empty array for empty input', () => {
    const result = consolidateTextParts([]);

    expect(result).toStrictEqual([]);
  });
});
