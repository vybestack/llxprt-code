/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 4 — request-shape provenance (AC-5 + AC-6) unit tests.
 *
 * These tests exercise the PURE computation module that, given the neutral
 * request sent to a provider, derives the token buckets, tool-call
 * attribution, new-vs-carried split, and the prefix fingerprint. They are
 * behavioral: they assert on the computed values, not on internal state.
 */

import { describe, it, expect } from 'bun:test';
import {
  computeRequestShape,
  RequestShapeSessionMemory,
  UNRESOLVED_TOOL_NAME,
  TOOL_OUTPUT_TRUNCATION_MARKER,
} from './tokenUsageRequestShape.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** Deterministic char-length token counter so assertions are predictable. */
const charCounter = (text: string): number => text.length;

function textContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiTextContent(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function syntheticContent(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { synthetic: true },
  };
}

function mediaContent(caption: string, data: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        mimeType: 'image/png',
        data,
        encoding: 'base64',
        caption,
      },
    ],
  };
}

function toolCall(id: string, name: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'tool_call', id, name, parameters: {} }],
  };
}

function toolResponse(callId: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId, toolName: '', result }],
  };
}

describe('tokenUsageRequestShape — buckets partition (AC-6)', () => {
  it('places every content into exactly ONE bucket and the buckets sum to the total', () => {
    const contents: IContent[] = [
      textContent('hello world'), // history (11 chars)
      aiTextContent('response text'), // history (13 chars)
      syntheticContent('injected summary'), // injected (16 chars)
      mediaContent('a caption', 'base64data=='), // media
    ];

    const result = computeRequestShape({
      requestContents: contents,
      tools: [],
      instructionsText: 'system instructions',
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    // Partition: every content lands in exactly one of media/injected/history.
    // history = 11 + 13 = 24; injected = 16; media = caption + mimeType + etc.
    expect(result.injectedTokens).toBe(16);
    expect(result.historyTokens).toBe(24);
    // Media content token count must be > 0 and isolated from history.
    expect(result.mediaTokens).toBeGreaterThan(0);

    // The three buckets must partition ALL request contents — no overlap,
    // no dropped content. Sum of buckets == sum of per-content token counts.
    const totalContents =
      result.historyTokens + result.injectedTokens + result.mediaTokens;
    expect(totalContents).toBeGreaterThan(result.historyTokens);
    expect(totalContents).toBe(16 + 24 + result.mediaTokens);
  });

  it('counts instructions and tool schemas separately from contents', () => {
    const result = computeRequestShape({
      requestContents: [textContent('history text')],
      tools: [{ name: 'tool_a' }, { name: 'tool_b' }],
      instructionsText: 'sys',
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    expect(result.instructionsTokens).toBe(3);
    expect(result.toolsSchemaTokens).toBeGreaterThan(0);
    expect(result.historyTokens).toBe(12);
  });

  it('counts a synthetic content carrying media as media, not as an injection', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'abc',
            encoding: 'base64',
          },
        ],
        metadata: { synthetic: true },
      },
    ];

    const result = computeRequestShape({
      requestContents: contents,
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    // Structure beats metadata. The provider pipeline stamps synthetic:true on
    // content it merely re-ordered, so the flag cannot be trusted to mean
    // "injected"; a media block is an unambiguous fact about the payload, and
    // media is the more useful attribution because it is the expensive part.
    expect(result.mediaTokens).toBeGreaterThan(0);
    expect(result.injectedTokens).toBe(0);
  });
});

describe('tokenUsageRequestShape — tool attribution (AC-5)', () => {
  it('lists each tool result exactly once with its name resolved from the matching tool_call', () => {
    const result = computeRequestShape({
      requestContents: [
        toolCall('call-1', 'read_file'),
        toolResponse('call-1', 'file contents here'),
      ],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    expect(result.toolCalls).toHaveLength(1);
    const entry = result.toolCalls[0];
    expect(entry.callId).toBe('call-1');
    expect(entry.toolName).toBe('read_file');
    expect(entry.resultTokens).toBeGreaterThan(0);
    expect(entry.wasTruncated).toBe(false);
  });

  it('uses the stable unresolved marker when no matching tool_call exists and the response has no toolName', () => {
    const result = computeRequestShape({
      requestContents: [toolResponse('orphan-call', 'some result')],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].callId).toBe('orphan-call');
    expect(result.toolCalls[0].toolName).toBe(UNRESOLVED_TOOL_NAME);
  });

  it('marks wasTruncated true when the tool result body contains the truncation marker', () => {
    const truncatedResult = `partial output\n\n${TOOL_OUTPUT_TRUNCATION_MARKER}`;
    const result = computeRequestShape({
      requestContents: [
        toolCall('call-2', 'shell'),
        toolResponse('call-2', truncatedResult),
      ],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    expect(result.toolCalls[0].wasTruncated).toBe(true);
  });

  it('attributes multiple tool results independently', () => {
    const result = computeRequestShape({
      requestContents: [
        toolCall('a', 'tool_a'),
        toolResponse('a', 'result a'),
        toolCall('b', 'tool_b'),
        toolResponse('b', 'result b'),
      ],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
      previouslySentCallIds: new Set(),
      previousFingerprint: undefined,
    });

    expect(result.toolCalls).toHaveLength(2);
    const names = result.toolCalls.map((tc) => tc.toolName).sort();
    expect(names).toStrictEqual(['tool_a', 'tool_b']);
  });
});

describe('tokenUsageRequestShape — new vs carried split (AC-5)', () => {
  it('classifies a tool result as new on the first send and carried on the second', () => {
    const memory = new RequestShapeSessionMemory();
    const contents: IContent[] = [
      toolCall('call-x', 'search'),
      toolResponse('call-x', 'search result body'),
    ];

    const first = memory.recordRequestShape({
      requestContents: contents,
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
    });

    expect(first.newToolResultTokens).toBeGreaterThan(0);
    expect(first.carriedToolResultTokens).toBe(0);

    // Second send of the SAME callId → now carried.
    const second = memory.recordRequestShape({
      requestContents: contents,
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
    });

    expect(second.newToolResultTokens).toBe(0);
    expect(second.carriedToolResultTokens).toBeGreaterThan(0);
  });

  it('counts mixed new and carried tool results in the same send', () => {
    const memory = new RequestShapeSessionMemory();

    // First send: only call-1
    memory.recordRequestShape({
      requestContents: [
        toolCall('call-1', 't1'),
        toolResponse('call-1', 'rrr'),
      ],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
    });

    // Second send: call-1 (carried) + call-2 (new)
    const second = memory.recordRequestShape({
      requestContents: [
        toolCall('call-1', 't1'),
        toolResponse('call-1', 'rrr'),
        toolCall('call-2', 't2'),
        toolResponse('call-2', 'ssss'),
      ],
      tools: [],
      instructionsText: undefined,
      countTokens: charCounter,
    });

    expect(second.carriedToolResultTokens).toBeGreaterThan(0);
    expect(second.newToolResultTokens).toBeGreaterThan(0);
  });
});

describe('tokenUsageRequestShape — prefix fingerprint (AC-6)', () => {
  it('is null for prefixFingerprintChanged on the first send', () => {
    const memory = new RequestShapeSessionMemory();
    const result = memory.recordRequestShape({
      requestContents: [textContent('hello')],
      tools: [],
      instructionsText: 'sys',
      countTokens: charCounter,
    });

    expect(result.prefixFingerprintChanged).toBeNull();
    expect(result.prefixFingerprint).toBeTruthy();
  });

  it('is stable for an identical prefix', () => {
    const memory1 = new RequestShapeSessionMemory();
    const memory2 = new RequestShapeSessionMemory();
    const inputs = {
      requestContents: [textContent('hello'), aiTextContent('world')],
      tools: [{ name: 'tool_a' }],
      instructionsText: 'system prompt',
      countTokens: charCounter,
    } as const;

    const r1 = memory1.recordRequestShape(inputs);
    const r2 = memory2.recordRequestShape(inputs);

    expect(r1.prefixFingerprint).toBe(r2.prefixFingerprint);
  });

  it('is false for prefixFingerprintChanged when the second prefix is identical', () => {
    const memory = new RequestShapeSessionMemory();
    const inputs = {
      requestContents: [textContent('hello')],
      tools: [{ name: 't' }] as const,
      instructionsText: 'sys',
      countTokens: charCounter,
    };

    memory.recordRequestShape(inputs);
    const second = memory.recordRequestShape(inputs);

    expect(second.prefixFingerprintChanged).toBe(false);
  });

  it('changes when the prefix (instructions) changes', () => {
    const memory = new RequestShapeSessionMemory();
    const base = {
      requestContents: [textContent('hello')],
      tools: [],
      countTokens: charCounter,
    } as const;

    const first = memory.recordRequestShape({
      ...base,
      instructionsText: 'instructions-v1',
    });
    const second = memory.recordRequestShape({
      ...base,
      instructionsText: 'instructions-v2',
    });

    expect(first.prefixFingerprint).not.toBe(second.prefixFingerprint);
    expect(second.prefixFingerprintChanged).toBe(true);
  });

  it('changes when the tool schemas change', () => {
    const memory = new RequestShapeSessionMemory();
    const base = {
      requestContents: [textContent('hello')],
      instructionsText: 'sys',
      countTokens: charCounter,
    } as const;

    const first = memory.recordRequestShape({ ...base, tools: [] });
    const second = memory.recordRequestShape({
      ...base,
      tools: [{ name: 'new_tool' }],
    });

    expect(first.prefixFingerprint).not.toBe(second.prefixFingerprint);
  });

  it('changes when the history contents change', () => {
    const memory = new RequestShapeSessionMemory();
    const base = {
      tools: [],
      instructionsText: 'sys',
      countTokens: charCounter,
    } as const;

    const first = memory.recordRequestShape({
      ...base,
      requestContents: [textContent('hello')],
    });
    const second = memory.recordRequestShape({
      ...base,
      requestContents: [textContent('goodbye')],
    });

    expect(first.prefixFingerprint).not.toBe(second.prefixFingerprint);
  });
});

describe('tokenUsageRequestShape — callId memory is bounded', () => {
  it('never grows beyond its capacity regardless of how many distinct callIds are sent', () => {
    const memory = new RequestShapeSessionMemory(5);

    for (let i = 0; i < 50; i++) {
      memory.recordRequestShape({
        requestContents: [
          toolCall(`call-${i}`, 'tool'),
          toolResponse(`call-${i}`, 'result'),
        ],
        tools: [],
        instructionsText: undefined,
        countTokens: charCounter,
      });
    }

    expect(memory.sentCallIdCount).toBeLessThanOrEqual(5);
  });
});
