/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 — cost guards for the per-send request-shape measurement.
 *
 * This measurement runs on the request path for every send. An earlier revision
 * serialized each tool-result body four times and tokenized the whole
 * conversation with tiktoken on every turn, which cost ~935ms per send by turn
 * 20 and grew from there — linear per send, quadratic per session.
 *
 * These are work-invariant assertions rather than wall-clock timings, so they
 * pin the behaviour that made it cheap without being flaky under CI load.
 */

import { describe, it, expect } from 'bun:test';
import {
  computeRequestShape,
  approximateTokens,
  FINGERPRINT_PREFIX_CHAR_BUDGET,
  APPROX_CHARS_PER_TOKEN,
} from './tokenUsageRequestShape.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stampTurnIdentityOnInput } from './turnIdentity.js';

const BIG_BODY = 'x'.repeat(FINGERPRINT_PREFIX_CHAR_BUDGET * 4);

/** Records every string handed to the token counter, so work can be asserted. */
class CountingTokenizer {
  readonly lengths: number[] = [];

  readonly count = (text: string): number => {
    this.lengths.push(text.length);
    return approximateTokens(text);
  };

  get totalChars(): number {
    return this.lengths.reduce((sum, n) => sum + n, 0);
  }
}

function textTurn(i: number): IContent {
  return {
    speaker: i % 2 === 0 ? 'ai' : 'human',
    blocks: [{ type: 'text', text: `message ${i}` }],
  };
}

function toolTurn(callId: string, body: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'read_many_files',
        result: body,
      },
    ],
  };
}

describe('request-shape measurement cost guards (issue #3130)', () => {
  it('counts each content body exactly once per send', () => {
    // Three contents, one of which carries a tool result. A tool result is
    // counted once for its content and once for its own attribution entry;
    // anything more means a body is being re-serialized.
    const contents: IContent[] = [
      textTurn(1),
      textTurn(2),
      toolTurn('call-1', 'some tool output'),
    ];
    const tokenizer = new CountingTokenizer();

    computeRequestShape({
      requestContents: contents,
      tools: undefined,
      instructionsText: 'instructions',
      countTokens: tokenizer.count,
      previouslySentCallIds: new Set<string>(),
    });

    // 3 contents + 1 tool result + 1 instructions block = 5.
    // Tools are absent, so the tools bucket short-circuits without counting.
    expect(tokenizer.lengths).toHaveLength(5);
  });

  it('does not re-count history that is sent again', () => {
    // The history pipeline rebuilds every content object each send, so this
    // measures the per-send pass, not a cache. What must hold is that ONE pass
    // happens: the character volume for a given request must not multiply.
    const contents: IContent[] = [toolTurn('call-1', BIG_BODY)];
    const tokenizer = new CountingTokenizer();

    computeRequestShape({
      requestContents: contents,
      tools: undefined,
      instructionsText: undefined,
      countTokens: tokenizer.count,
      previouslySentCallIds: new Set<string>(),
    });

    // Content pass + tool-result pass over the same body, and nothing more.
    expect(tokenizer.totalChars).toBeLessThanOrEqual(BIG_BODY.length * 2 + 64);
  });

  it('bounds the fingerprint so a long conversation costs the same as a short one', () => {
    // Two histories whose heads are identical and whose tails differ far past
    // the prefix budget must fingerprint the same. That is only possible if the
    // fingerprint stops reading at the budget instead of hashing everything.
    const head: IContent[] = [toolTurn('call-head', BIG_BODY)];
    const shortHistory = [...head, textTurn(1)];
    const longHistory = [
      ...head,
      ...Array.from({ length: 200 }, (_, i) => textTurn(i + 2)),
    ];

    const shape = (contents: IContent[]) =>
      computeRequestShape({
        requestContents: contents,
        tools: undefined,
        instructionsText: undefined,
        countTokens: approximateTokens,
        previouslySentCallIds: new Set<string>(),
      }).prefixFingerprint;

    expect(shape(longHistory)).toBe(shape(shortHistory));
  });

  it('still detects a change inside the cacheable prefix', () => {
    // Boundedness must not cost sensitivity where it matters: the head is the
    // part a provider can cache, so a change there must change the hash.
    const base = computeRequestShape({
      requestContents: [textTurn(1)],
      tools: undefined,
      instructionsText: 'system prompt A',
      countTokens: approximateTokens,
      previouslySentCallIds: new Set<string>(),
    }).prefixFingerprint;
    const changed = computeRequestShape({
      requestContents: [textTurn(1)],
      tools: undefined,
      instructionsText: 'system prompt B',
      countTokens: approximateTokens,
      previouslySentCallIds: new Set<string>(),
    }).prefixFingerprint;

    expect(changed).not.toBe(base);
  });

  it('keeps one turn identity across the attempts of a single logical turn', () => {
    // A discard-restart re-enters the send path with the same promptId. Both
    // attempts describe the same conversation turn, so both records must name
    // the same turn_id or the retry cannot be joined to the turn it replaced.
    const contents: IContent[] = [textTurn(1)];
    const first = stampTurnIdentityOnInput(contents[0], {
      promptId: 'p-1',
      turnId: 'turn-1',
    });
    const retried = stampTurnIdentityOnInput(first, {
      promptId: 'p-1',
      turnId: 'turn-2-should-not-win',
    });

    expect(Array.isArray(retried)).toBe(false);
    if (!Array.isArray(retried)) {
      expect(retried.metadata?.turnId).toBe('turn-1');
      expect(retried.metadata?.promptId).toBe('p-1');
    }
  });

  it('approximates tokens by character length rather than invoking a tokenizer', () => {
    // The send seam already pays one full tokenization pass for
    // `estimated_tokens`. A second one is what made this measurement expensive.
    expect(approximateTokens('a'.repeat(30))).toBe(30 / APPROX_CHARS_PER_TOKEN);
  });
});
