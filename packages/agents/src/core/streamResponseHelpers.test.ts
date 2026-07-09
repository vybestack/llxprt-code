/**
 * Tests for streamResponseHelpers consolidateTextParts.
 *
 * #1723: Streaming thinking deltas emit accumulated thinking text as
 * incremental thought parts. The final block at content_block_stop carries
 * the signature that the deltas lacked. consolidateTextParts must merge
 * consecutive incremental thought parts so only the final signed block
 * reaches history — preventing 400 "thinking.signature: Field required"
 * errors on the next turn.
 */
import { describe, it, expect } from 'vitest';
import { consolidateTextParts } from './streamResponseHelpers.js';
import type { Part } from '@google/genai';
import { isThoughtPart } from './googlePartHelpers.js';

function thoughtPart(text: string, signature?: string): Part {
  return {
    thought: true,
    text,
    ...(signature !== undefined ? { thoughtSignature: signature } : {}),
    llxprtSourceField: 'thinking',
  } as Part;
}

function textPart(text: string): Part {
  return { text };
}

describe('consolidateTextParts — #1723 incremental thinking consolidation', () => {
  it('merges consecutive incremental thought parts, keeping the last text and signature', () => {
    const parts: Part[] = [
      thoughtPart('Let me think'),
      thoughtPart('Let me think about this'),
      thoughtPart('Let me think about this carefully', 'sig_final'),
    ];

    const result = consolidateTextParts(parts);

    const thoughtParts = result.filter(isThoughtPart);
    expect(thoughtParts).toHaveLength(1);
    expect(thoughtParts[0]?.text).toBe('Let me think about this carefully');
    expect(thoughtParts[0]?.thoughtSignature).toBe('sig_final');
  });

  it('replaces text and adds signature when final delta arrives with one', () => {
    const parts: Part[] = [
      thoughtPart('Partial'),
      thoughtPart('Partial thought', 'sig123'),
    ];

    const result = consolidateTextParts(parts);

    const thoughtParts = result.filter(isThoughtPart);
    expect(thoughtParts).toHaveLength(1);
    expect(thoughtParts[0]?.text).toBe('Partial thought');
    expect(thoughtParts[0]?.thoughtSignature).toBe('sig123');
  });

  it('does not merge thought parts when text is not a prefix extension', () => {
    const parts: Part[] = [
      thoughtPart('First thought', 'sig1'),
      thoughtPart('Completely different thought', 'sig2'),
    ];

    const result = consolidateTextParts(parts);

    const thoughtParts = result.filter(isThoughtPart);
    expect(thoughtParts).toHaveLength(2);
  });

  it('preserves text parts alongside consolidated thinking', () => {
    const parts: Part[] = [
      thoughtPart('Thinking', 'sig1'),
      textPart('Hello'),
      textPart(' world'),
    ];

    const result = consolidateTextParts(parts);

    expect(result).toHaveLength(2);
    const thoughtParts = result.filter(isThoughtPart);
    expect(thoughtParts).toHaveLength(1);
    expect(thoughtParts[0]?.thoughtSignature).toBe('sig1');
    const textParts = result.filter(
      (p) => p.text !== undefined && !isThoughtPart(p),
    );
    expect(textParts).toHaveLength(1);
    expect(textParts[0]?.text).toBe('Hello world');
  });

  it('produces single signed thinking block from streaming deltas followed by final block', () => {
    // Simulates the real Anthropic streaming flow:
    //   delta1 (accumulated text, no sig) → delta2 (more text, no sig) →
    //   content_block_stop (full text + sig)
    const parts: Part[] = [
      thoughtPart('Analyzing'),
      thoughtPart('Analyzing the request'),
      thoughtPart('Analyzing the request step by step'),
      thoughtPart('Analyzing the request step by step.', 'sig_stop'),
    ];

    const result = consolidateTextParts(parts);

    const thoughtParts = result.filter(isThoughtPart);
    expect(thoughtParts).toHaveLength(1);
    expect(thoughtParts[0]?.text).toBe('Analyzing the request step by step.');
    expect(thoughtParts[0]?.thoughtSignature).toBe('sig_stop');
  });

  it('returns empty array for empty input', () => {
    const result = consolidateTextParts([]);
    expect(result).toStrictEqual([]);
  });
});
