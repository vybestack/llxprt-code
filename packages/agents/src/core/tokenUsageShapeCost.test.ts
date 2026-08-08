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
  RequestShapeSessionMemory,
  FINGERPRINT_PREFIX_CHAR_BUDGET,
} from './tokenUsageRequestShape.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { stampTurnIdentityOnInput } from './turnIdentity.js';

const BIG_BODY = 'x'.repeat(FINGERPRINT_PREFIX_CHAR_BUDGET * 4);

/** Records every string handed to the token counter, so work can be asserted. */
class CountingTokenizer {
  readonly lengths: number[] = [];

  readonly count = (text: string): number => {
    this.lengths.push(text.length);
    return Math.ceil(text.length / 3);
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

/** Stamp the stable id the history pipeline preserves across sends. */
function identified(content: IContent, id: string): IContent {
  return { ...content, metadata: { ...(content.metadata ?? {}), id } };
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

  it('bounds the fingerprint so it stops growing with the conversation', () => {
    // Once the prefix budget is spent, later turns must not change the hash.
    // Otherwise the fingerprint reads the whole conversation on every send,
    // which is what made this measurement quadratic.
    const head = Array.from({ length: 2000 }, (_, i) =>
      identified(textTurn(i), `content-${i}`),
    );

    const shape = (contents: IContent[]) =>
      computeRequestShape({
        requestContents: contents,
        tools: undefined,
        instructionsText: undefined,
        countTokens: (t: string) => t.length,
        previouslySentCallIds: new Set<string>(),
      }).prefixFingerprint;

    expect(shape([...head, identified(textTurn(9999), 'extra')])).toBe(
      shape(head),
    );
  });

  it('still detects a change inside the cacheable prefix', () => {
    // Boundedness must not cost sensitivity where it matters: the head is the
    // part a provider can cache, so a change there must change the hash.
    const base = computeRequestShape({
      requestContents: [textTurn(1)],
      tools: undefined,
      instructionsText: 'system prompt A',
      countTokens: (t: string) => t.length,
      previouslySentCallIds: new Set<string>(),
    }).prefixFingerprint;
    const changed = computeRequestShape({
      requestContents: [textTurn(1)],
      tools: undefined,
      instructionsText: 'system prompt B',
      countTokens: (t: string) => t.length,
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

  it('tokenizes a carried content once, not once per send', () => {
    // The whole point: a big tool result that rides along for many turns must
    // not be re-tokenized every send. Earlier this was linear per send and
    // quadratic per session (935ms per send by turn 20).
    const memory = new RequestShapeSessionMemory();
    const contents: IContent[] = [
      identified(toolTurn('call-1', BIG_BODY), 'content-1'),
    ];
    const tokenizer = new CountingTokenizer();

    for (let send = 0; send < 5; send += 1) {
      memory.recordRequestShape({
        // A fresh object each time, exactly as the history pipeline produces.
        requestContents: contents.map((c) => ({ ...c, blocks: [...c.blocks] })),
        tools: undefined,
        instructionsText: undefined,
        countTokens: tokenizer.count,
      });
    }

    // Send 1 measures it. Sends 2-5 must not tokenize the body again, so the
    // recorded volume stays at one send's worth rather than five.
    expect(tokenizer.totalChars).toBeLessThanOrEqual(BIG_BODY.length * 2 + 64);
  });

  it('still reports the carried content cost on later sends', () => {
    // Caching must not silently drop the bucket: a cache hit has to contribute
    // the same tokens a fresh measurement would.
    const memory = new RequestShapeSessionMemory();
    const build = (): IContent[] => [
      identified(toolTurn('call-1', BIG_BODY), 'content-1'),
    ];
    const shape = () =>
      memory.recordRequestShape({
        requestContents: build(),
        tools: undefined,
        instructionsText: undefined,
        countTokens: (t: string) => t.length,
      });

    const first = shape();
    const second = shape();

    expect(second.historyTokens).toBe(first.historyTokens);
  });
});
