/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryService } from './HistoryService.js';
import type {
  IContent,
  ToolResponseBlock,
  ContentMetadata,
} from './IContent.js';
import type { DensityResult } from '../../core/compression/types.js';

// ---------------------------------------------------------------------------
// Test helpers (data builders — NOT mocks)
// ---------------------------------------------------------------------------

function makeHumanContent(text: string, metadata?: ContentMetadata): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    ...(metadata ? { metadata } : {}),
  };
}

function makeAIContent(text: string, metadata?: ContentMetadata): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(metadata ? { metadata } : {}),
  };
}

function makeToolResponseContent(
  callId: string,
  metadata?: ContentMetadata,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName: 'read_file',
        result: { ok: true },
      },
    ],
    ...(metadata ? { metadata } : {}),
  };
}

function makeAIWithToolCall(
  callId: string,
  metadata?: ContentMetadata,
): IContent {
  return {
    speaker: 'ai',
    blocks: [
      { type: 'text', text: 'I will use a tool.' },
      { type: 'tool_call', id: callId, name: 'read_file', parameters: {} },
    ],
    ...(metadata ? { metadata } : {}),
  };
}

// ---------------------------------------------------------------------------
// AC1: seq starts at 1, increments by 1
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC1: seq starts at 1 and increments', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('stamps the first added item with seq 1', () => {
    service.add(makeHumanContent('hello'));

    expect(service.getAll()[0].metadata?.chronology?.seq).toBe(1);
  });

  it('increments seq by 1 for each subsequent item', () => {
    service.add(makeHumanContent('a'));
    service.add(makeAIContent('b'));
    service.add(makeHumanContent('c'));

    const seqs = service.getAll().map((c) => c.metadata?.chronology?.seq);
    expect(seqs).toStrictEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// AC2: seq never reused after clear()
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC2: seq never reused after clear()', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('continues seq from the previous maximum after clear()', () => {
    service.add(makeHumanContent('a'));
    service.add(makeAIContent('b'));
    // seq max is now 2

    service.clear();
    service.add(makeHumanContent('c'));

    const seqAfterClear = service.getAll()[0].metadata?.chronology?.seq;
    expect(seqAfterClear).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// AC3: userTurn increments only on human; ai/tool share it
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC3: userTurn increments on human only', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('increments userTurn on human and shares it with ai/tool of the same turn', () => {
    service.add(makeHumanContent('q1'));
    service.add(makeAIContent('a1'));
    service.add(makeToolResponseContent('call_1'));
    service.add(makeHumanContent('q2'));
    service.add(makeAIContent('a2'));

    const turns = service.getAll().map((c) => c.metadata?.chronology?.userTurn);

    expect(turns).toStrictEqual([1, 1, 1, 2, 2]);
  });
});

// ---------------------------------------------------------------------------
// AC4: step is 1 for the human, increments across the turn, resets next turn
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC4: step increments within turn, resets on human', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('assigns step 1 to the human, increments across the turn, resets on next human', () => {
    service.add(makeHumanContent('q1'));
    service.add(makeAIContent('a1'));
    service.add(makeToolResponseContent('call_1'));
    service.add(makeHumanContent('q2'));
    service.add(makeAIContent('a2'));

    const steps = service.getAll().map((c) => c.metadata?.chronology?.step);

    expect(steps).toStrictEqual([1, 2, 3, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// AC5: recordedAt populated with insertion time on every item
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC5: recordedAt populated', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('populates recordedAt with a finite number within the insertion time bracket', () => {
    const before = Date.now();
    service.add(makeHumanContent('hello'));
    const after = Date.now();

    const recordedAt = service.getAll()[0].metadata?.chronology?.recordedAt;

    expect(typeof recordedAt).toBe('number');
    expect(Number.isFinite(recordedAt)).toBe(true);
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(recordedAt).toBeLessThanOrEqual(after);
  });

  it('populates recordedAt on every item', () => {
    const before = Date.now();
    service.add(makeHumanContent('a'));
    service.add(makeAIContent('b'));
    const after = Date.now();

    for (const item of service.getAll()) {
      const recordedAt = item.metadata?.chronology?.recordedAt;
      expect(Number.isFinite(recordedAt)).toBe(true);
      expect(recordedAt).toBeGreaterThanOrEqual(before);
      expect(recordedAt).toBeLessThanOrEqual(after);
    }
  });
});

// ---------------------------------------------------------------------------
// AC8: INV-1 holds after validateAndFix inserts synthetic tool messages
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC8: validateAndFix preserves INV-1', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('stamps every synthetic tool message inserted by validateAndFix', () => {
    service.add(makeAIWithToolCall('hist_tool_orphan1'));
    service.add(makeHumanContent('next question'));

    service.validateAndFix();

    // Guard against a vacuous pass: the two seeded items already carry markers,
    // so the loop below only proves anything if a synthetic message was
    // actually inserted.
    expect(service.getAll()).toHaveLength(3);

    for (const item of service.getAll()) {
      expect(item.metadata?.chronology).toBeDefined();
      expect(item.metadata?.chronology?.seq).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// AC9: INV-1 holds after applyDensityResult; replacement inherits marker
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC9: applyDensityResult inherits marker', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('inherits the replaced item marker on density replacement and keeps INV-1', async () => {
    service.add(makeHumanContent('h1'));
    service.add(makeAIContent('a1'));
    service.add(makeHumanContent('h2'));

    const replacedSeq = service.getAll()[1].metadata?.chronology?.seq;
    const replacedUserTurn = service.getAll()[1].metadata?.chronology?.userTurn;
    const replacedStep = service.getAll()[1].metadata?.chronology?.step;

    const replacement: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'stubbed response' }],
    };

    const densityResult: DensityResult = {
      removals: [],
      replacements: new Map([[1, replacement]]),
      metadata: {
        readWritePairsPruned: 0,
        fileDeduplicationsPruned: 0,
        recencyPruned: 0,
      },
    };

    await service.applyDensityResult(densityResult);

    const replaced = service.getAll()[1];
    // Guard against a vacuous pass: if the replacement never landed, the
    // original item would still satisfy the marker assertions below.
    expect(replaced.blocks).toStrictEqual(replacement.blocks);
    expect(replaced.metadata?.chronology?.seq).toBe(replacedSeq);
    expect(replaced.metadata?.chronology?.userTurn).toBe(replacedUserTurn);
    expect(replaced.metadata?.chronology?.step).toBe(replacedStep);

    for (const item of service.getAll()) {
      expect(item.metadata?.chronology).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// AC10: INV-1 holds after summarizeOldHistory; retained items keep their seq
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC10: summarizeOldHistory preserves markers', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('stamps the summary and retains original seqs on kept items', async () => {
    service.add(makeHumanContent('h1'));
    service.add(makeAIContent('a1'));
    service.add(makeHumanContent('h2'));
    service.add(makeAIContent('a2'));

    const keptSeqBefore = service.getAll()[3].metadata?.chronology?.seq;

    await service.summarizeOldHistory(1, async () =>
      makeAIContent('summary of old history'),
    );

    const history = service.getAll();
    // The summary is first, then the kept tail
    const summary = history[0];
    const keptTail = history[1];

    expect(summary.metadata?.chronology).toBeDefined();
    expect(keptTail.metadata?.chronology).toBeDefined();
    expect(keptTail.metadata?.chronology?.seq).toBe(keptSeqBefore);
  });
});

// ---------------------------------------------------------------------------
// AC11: replaceToolResponseBlock preserves the chronology marker
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC11: replaceToolResponseBlock preserves marker', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('stamps every entry installed through replaceAll', async () => {
    service.add(makeHumanContent('h1'));

    await service.replaceAll([
      makeHumanContent('replacement h'),
      makeAIContent('replacement a'),
    ]);

    for (const item of service.getAll()) {
      expect(item.metadata?.chronology).toBeDefined();
    }
  });

  it('continues the sequence past pre-existing entries after replaceAll', async () => {
    service.add(makeHumanContent('h1'));
    service.add(makeAIContent('a1'));

    await service.replaceAll([makeHumanContent('replacement h')]);

    expect(service.getAll()[0].metadata?.chronology?.seq).toBe(3);
  });

  it('preserves markers on entries that already carry one through replaceAll', async () => {
    service.add(makeHumanContent('h1'));
    const existing = service.getAll()[0];

    await service.replaceAll([existing]);

    expect(service.getAll()[0].metadata?.chronology?.seq).toBe(1);
  });

  it('preserves the entry chronology marker after replacing a tool_response block', async () => {
    service.add(makeHumanContent('h1'));
    service.add(makeAIWithToolCall('call_1'));
    service.add(makeToolResponseContent('call_1'));

    const originalMarker = service.getAll()[2].metadata?.chronology;
    const originalSeq = originalMarker?.seq;

    const replacementBlock: ToolResponseBlock = {
      type: 'tool_response',
      callId: 'call_1',
      toolName: 'read_file',
      result: { replaced: true },
    };

    await service.replaceToolResponseBlock(2, 0, replacementBlock);

    const replaced = service.getAll()[2];
    expect(replaced.metadata?.chronology?.seq).toBe(originalSeq);
    expect(replaced.metadata?.chronology).toStrictEqual(originalMarker);
  });
});

// ---------------------------------------------------------------------------
// AC25: getChronologyTrace returns ordered entries with no message text
// ---------------------------------------------------------------------------

describe('HistoryService chronology - AC25: getChronologyTrace', () => {
  let service: HistoryService;

  beforeEach(() => {
    service = new HistoryService();
  });

  it('returns one ordered entry per history item with marker fields', () => {
    service.add(makeHumanContent('q1'));
    service.add(makeAIContent('a1'));
    service.add(makeHumanContent('q2'));

    const trace = service.getChronologyTrace();

    expect(trace).toHaveLength(3);
    expect(trace.map((e) => e.seq)).toStrictEqual([1, 2, 3]);
    expect(trace.map((e) => e.speaker)).toStrictEqual(['human', 'ai', 'human']);
  });

  it('includes structural descriptors (blockTypes, toolCallIds, toolResponseIds)', () => {
    service.add(makeAIWithToolCall('tc_trace_1'));
    service.add(makeToolResponseContent('tc_trace_1'));

    const trace = service.getChronologyTrace();

    expect(trace[0].blockTypes).toContain('tool_call');
    expect(trace[0].toolCallIds).toStrictEqual(['tc_trace_1']);
    expect(trace[1].toolResponseIds).toStrictEqual(['tc_trace_1']);
  });

  it('does not leak message text into the trace', () => {
    service.add(makeHumanContent('VERY_SECRET_USER_TEXT'));

    const trace = service.getChronologyTrace();
    const serialised = JSON.stringify(trace);

    expect(serialised).not.toContain('VERY_SECRET_USER_TEXT');
  });
});
