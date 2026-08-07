/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { buildProviderContent } from './historyProviderPipeline.js';
import { DebugLogger } from '../../debug/index.js';

/**
 * CHARACTERIZATION TESTS for per-turn prefix stability (issue #3070 Defect B).
 *
 * These tests document and lock down properties of the provider pipeline and
 * curation that are already true on main, whose absence allowed Defect B (the
 * oscillating compression boundary) to go unnoticed. They use a REAL
 * HistoryService with no mocks.
 *
 * The test-local helpers below define the operational meaning of a cacheable
 * prefix: serialization excludes metadata (chronology is never sent to a
 * provider), so this proxy is exactly what an implicit-cache provider matches
 * on and exactly what determines where an explicit breakpoint could pay off.
 */

function serializeForCache(contents: readonly IContent[]): string[] {
  return contents.map((c) =>
    JSON.stringify({ speaker: c.speaker, blocks: c.blocks }),
  );
}

function commonPrefixLength(
  a: readonly string[],
  b: readonly string[],
): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a[i] !== b[i]) return i;
  }
  return limit;
}

const logger = new DebugLogger('llxprt:history:prefix-stability-test');

function textMsg(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function toolCallMsg(callId: string, name: string): IContent {
  return {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: callId,
        name,
        parameters: {},
      },
    ],
  };
}

function toolResponseMsg(callId: string, toolName: string): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result: 'ok',
      },
    ],
  };
}

function providerContent(hs: HistoryService): IContent[] {
  return buildProviderContent(hs.getCurated(), [], logger);
}

describe('B1: per-turn provider pipeline is prefix-stable under append (characterization)', () => {
  it('appending a new turn keeps the previous provider content as a strict prefix', () => {
    const hs = new HistoryService();
    hs.add(textMsg('human', 'hello'));
    hs.add(textMsg('ai', 'world'));

    const before = providerContent(hs);

    // Append a new turn
    hs.add(textMsg('human', 'second question'));
    hs.add(textMsg('ai', 'second answer'));

    const after = providerContent(hs);
    const serializedBefore = serializeForCache(before);
    const serializedAfter = serializeForCache(after);
    const prefixLen = commonPrefixLength(serializedBefore, serializedAfter);

    expect(prefixLen).toBe(serializedBefore.length);
  });

  it('appending a tool turn keeps the previous provider content as a strict prefix', () => {
    const hs = new HistoryService();
    hs.add(textMsg('human', 'run a tool'));
    hs.add(toolCallMsg('tc-1', 'read_file'));
    hs.add(toolResponseMsg('tc-1', 'read_file'));
    hs.add(textMsg('ai', 'done'));

    const before = providerContent(hs);

    hs.add(textMsg('human', 'do more'));
    hs.add(toolCallMsg('tc-2', 'write_file'));
    hs.add(toolResponseMsg('tc-2', 'write_file'));

    const after = providerContent(hs);
    const serializedBefore = serializeForCache(before);
    const serializedAfter = serializeForCache(after);
    const prefixLen = commonPrefixLength(serializedBefore, serializedAfter);

    expect(prefixLen).toBe(serializedBefore.length);
  });
});

describe('B2: interrupted tool call perturbs only the tail, not the head (characterization)', () => {
  it('an unmatched tool_call at the end does not alter the established head prefix', () => {
    const hs = new HistoryService();
    hs.add(textMsg('human', 'question one'));
    hs.add(textMsg('ai', 'answer one'));
    hs.add(textMsg('human', 'question two'));
    hs.add(textMsg('ai', 'answer two'));

    const before = providerContent(hs);

    // Simulate an interrupted turn: tool call without response
    hs.add(textMsg('human', 'run tool'));
    hs.add(toolCallMsg('tc-99', 'some_tool'));

    const after = providerContent(hs);
    const serializedBefore = serializeForCache(before);
    const serializedAfter = serializeForCache(after);

    // The head (the first 4 entries) must still be an exact prefix
    const prefixLen = commonPrefixLength(serializedBefore, serializedAfter);
    expect(prefixLen).toBe(serializedBefore.length);
  });
});

describe('B3: curation is an identity map on any valid prefix (characterization)', () => {
  it('curating a prefix of curated history returns exactly that prefix', () => {
    const hs = new HistoryService();
    for (let i = 0; i < 10; i++) {
      hs.add(textMsg('human', `prompt ${i}`));
      hs.add(textMsg('ai', `response ${i}`));
    }

    const curated = hs.getCurated();
    expect(curated.length).toBe(20);

    // Curation is an identity map on already-valid entries: re-curating a
    // prefix through a fresh HistoryService must produce the same serialized
    // content. (Previously this compared an array to itself, which is
    // tautological — #3070 test defect.)
    for (const prefixLen of [4, 8, 12]) {
      const prefix = curated.slice(0, prefixLen);

      const reCurated = new HistoryService();
      for (const entry of prefix) {
        reCurated.add(entry);
      }
      const reCuratedOutput = reCurated.getCurated();

      const serializedPrefix = serializeForCache(prefix);
      const serializedReCurated = serializeForCache(reCuratedOutput);

      expect(serializedReCurated).toHaveLength(serializedPrefix.length);
      expect(commonPrefixLength(serializedPrefix, serializedReCurated)).toBe(
        serializedPrefix.length,
      );
    }
  });

  it('curated history is prefix-stable under append', () => {
    const hs = new HistoryService();
    hs.add(textMsg('human', 'first'));
    hs.add(textMsg('ai', 'reply'));

    const before = hs.getCurated();

    hs.add(textMsg('human', 'second'));
    hs.add(textMsg('ai', 'reply2'));

    const after = hs.getCurated();
    const serializedBefore = serializeForCache(before);
    const serializedAfter = serializeForCache(after);

    expect(commonPrefixLength(serializedBefore, serializedAfter)).toBe(
      serializedBefore.length,
    );
  });
});
