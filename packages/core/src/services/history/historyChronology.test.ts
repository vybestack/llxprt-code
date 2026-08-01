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

import { describe, expect, it } from 'vitest';
import {
  ChronologyStamper,
  annotateCompressionSpan,
  buildChronologyTrace,
} from './historyChronology.js';
import type { ChronologyMarker, IContent } from './IContent.js';

function fixedClock(value: number): () => number {
  return () => value;
}

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function aiText(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function marked(content: IContent, marker: ChronologyMarker): IContent {
  return { ...content, metadata: { ...content.metadata, chronology: marker } };
}

function markerAt(
  seq: number,
  userTurn: number,
  step: number,
): ChronologyMarker {
  return { seq, userTurn, step, recordedAt: 1_000 + seq };
}

function summaryEntry(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { isSummary: true, synthetic: true },
  };
}

describe('ChronologyStamper.stamp', () => {
  it('assigns the recorded time from the injected clock', () => {
    const stamper = new ChronologyStamper(fixedClock(42));

    const stamped = stamper.stamp(humanText('hi'));

    expect(stamped.metadata?.chronology?.recordedAt).toBe(42);
  });

  it('returns the same object reference so history stores what the caller added', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const original = humanText('hi');

    expect(stamper.stamp(original)).toBe(original);
  });

  it('leaves blocks untouched when stamping', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const original = humanText('hi');
    const blocks = original.blocks;

    stamper.stamp(original);

    expect(original.blocks).toBe(blocks);
  });

  /** AC6 */
  it('returns content carrying an existing marker unchanged by reference', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const existing = marked(aiText('kept'), markerAt(7, 3, 2));

    const result = stamper.stamp(existing);

    expect(result).toBe(existing);
  });

  /** AC7 */
  it('gives fresh content a sequence greater than every preserved sequence', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(marked(aiText('kept'), markerAt(9, 4, 3)));

    const fresh = stamper.stamp(humanText('next'));

    expect(fresh.metadata?.chronology?.seq).toBe(10);
  });

  it('continues the user turn counter after preserving a marker', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(marked(aiText('kept'), markerAt(9, 4, 3)));

    const fresh = stamper.stamp(humanText('next'));

    expect(fresh.metadata?.chronology?.userTurn).toBe(5);
  });

  it('continues the step counter within the preserved user turn', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(marked(aiText('kept'), markerAt(9, 4, 3)));

    const fresh = stamper.stamp(aiText('same turn'));

    expect(fresh.metadata?.chronology?.step).toBe(4);
  });

  it('restarts the step counter when a fresh human turn begins', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(humanText('turn one'));
    stamper.stamp(aiText('reply one'));

    const fresh = stamper.stamp(humanText('turn two'));

    expect(fresh.metadata?.chronology).toStrictEqual({
      seq: 3,
      userTurn: 2,
      step: 1,
      recordedAt: 1,
    });
  });

  it('restarts the step counter when a preserved marker advances the turn', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(humanText('turn one'));
    stamper.stamp(aiText('reply one'));
    stamper.stamp(marked(humanText('turn two'), markerAt(20, 2, 1)));

    const fresh = stamper.stamp(aiText('reply two'));

    expect(fresh.metadata?.chronology?.step).toBe(2);
  });

  it('ignores a stale lower-turn marker when continuing the current turn', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(humanText('turn one'));
    stamper.stamp(humanText('turn two'));
    stamper.stamp(marked(aiText('stale'), markerAt(1, 1, 9)));

    const fresh = stamper.stamp(aiText('reply two'));

    expect(fresh.metadata?.chronology?.step).toBe(2);
  });

  it('keeps the current turn when a stale lower-turn marker is preserved', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.stamp(humanText('turn one'));
    stamper.stamp(humanText('turn two'));
    stamper.stamp(marked(aiText('stale'), markerAt(1, 1, 9)));

    const fresh = stamper.stamp(aiText('reply two'));

    expect(fresh.metadata?.chronology?.userTurn).toBe(2);
  });

  it('preserves unrelated metadata when stamping', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const content: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'x' }],
      metadata: { model: 'gpt-4.1' },
    };

    const stamped = stamper.stamp(content);

    expect(stamped.metadata?.model).toBe('gpt-4.1');
  });
});

describe('ChronologyStamper.inherit', () => {
  it('applies the supplied marker to the returned content', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const marker = markerAt(5, 2, 2);

    const result = stamper.inherit(aiText('replacement'), marker);

    expect(result.metadata?.chronology).toStrictEqual(marker);
  });

  it('advances the sequence counter past the inherited marker', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    stamper.inherit(aiText('replacement'), markerAt(5, 2, 2));

    const fresh = stamper.stamp(humanText('next'));

    expect(fresh.metadata?.chronology?.seq).toBe(6);
  });

  it('returns the same object reference so the replacement itself is stored', () => {
    const stamper = new ChronologyStamper(fixedClock(1));
    const original = aiText('replacement');

    expect(stamper.inherit(original, markerAt(5, 2, 2))).toBe(original);
  });
});

describe('annotateCompressionSpan', () => {
  /** AC12 */
  it('records the destroyed sequence span on the summary entry', () => {
    const previous = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
      marked(humanText('c'), markerAt(3, 2, 1)),
      marked(aiText('d'), markerAt(4, 2, 2)),
    ];
    const kept = previous[3];

    const result = annotateCompressionSpan(previous, [summaryEntry('s'), kept]);

    expect(result[0].metadata?.chronologyReplaced).toStrictEqual({
      fromSeq: 1,
      toSeq: 3,
      itemCount: 3,
    });
  });

  it('counts only the sequences that disappeared', () => {
    const previous = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
      marked(aiText('c'), markerAt(5, 1, 3)),
    ];

    const result = annotateCompressionSpan(previous, [
      summaryEntry('s'),
      previous[1],
    ]);

    expect(result[0].metadata?.chronologyReplaced).toStrictEqual({
      fromSeq: 1,
      toSeq: 5,
      itemCount: 2,
    });
  });

  /** AC13 */
  it('leaves the summary unannotated when nothing was destroyed', () => {
    const previous = [marked(humanText('a'), markerAt(1, 1, 1))];
    const summary = summaryEntry('s');

    const result = annotateCompressionSpan(previous, [previous[0], summary]);

    expect(result[1].metadata?.chronologyReplaced).toBeUndefined();
  });

  /** AC14 */
  it('returns items unchanged when the result contains no summary entry', () => {
    const previous = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];
    const kept = previous[1];

    const result = annotateCompressionSpan(previous, [kept]);

    expect(result[0]).toBe(kept);
  });

  it('does not overwrite an existing replaced span', () => {
    const previous = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];
    const existing: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 's' }],
      metadata: {
        isSummary: true,
        chronologyReplaced: { fromSeq: 90, toSeq: 99, itemCount: 4 },
      },
    };

    const result = annotateCompressionSpan(previous, [existing]);

    expect(result[0].metadata?.chronologyReplaced).toStrictEqual({
      fromSeq: 90,
      toSeq: 99,
      itemCount: 4,
    });
  });

  it('ignores entries that carry no chronology marker', () => {
    const previous = [
      humanText('unmarked'),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];

    const result = annotateCompressionSpan(previous, [summaryEntry('s')]);

    expect(result[0].metadata?.chronologyReplaced).toStrictEqual({
      fromSeq: 2,
      toSeq: 2,
      itemCount: 1,
    });
  });

  it('annotates every summary entry when the result contains more than one', () => {
    const previous = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];

    const result = annotateCompressionSpan(previous, [
      summaryEntry('s1'),
      summaryEntry('s2'),
    ]);

    expect(
      result.map((entry) => entry.metadata?.chronologyReplaced),
    ).toStrictEqual([
      { fromSeq: 1, toSeq: 2, itemCount: 2 },
      { fromSeq: 1, toSeq: 2, itemCount: 2 },
    ]);
  });

  it('does not mutate the supplied new history entries', () => {
    const previous = [marked(humanText('a'), markerAt(1, 1, 1))];
    const summary = summaryEntry('s');

    annotateCompressionSpan(previous, [summary]);

    expect(summary.metadata?.chronologyReplaced).toBeUndefined();
  });
});

describe('buildChronologyTrace', () => {
  it('returns one entry per marked history item in order', () => {
    const history = [
      marked(humanText('a'), markerAt(1, 1, 1)),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];

    const trace = buildChronologyTrace(history);

    expect(trace.map((entry) => entry.seq)).toStrictEqual([1, 2]);
  });

  it('skips items that carry no marker', () => {
    const history = [
      humanText('unmarked'),
      marked(aiText('b'), markerAt(2, 1, 2)),
    ];

    const trace = buildChronologyTrace(history);

    expect(trace).toHaveLength(1);
  });

  it('describes block types without their content', () => {
    const history = [
      marked(
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'visible' },
            { type: 'tool_call', id: 'call-1', name: 'run', parameters: {} },
          ],
        },
        markerAt(1, 1, 1),
      ),
    ];

    const trace = buildChronologyTrace(history);

    expect(trace[0].blockTypes).toStrictEqual(['text', 'tool_call']);
  });

  it('surfaces tool call ids', () => {
    const history = [
      marked(
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'call-1', name: 'run', parameters: {} },
          ],
        },
        markerAt(1, 1, 1),
      ),
    ];

    const trace = buildChronologyTrace(history);

    expect(trace[0].toolCallIds).toStrictEqual(['call-1']);
  });

  it('surfaces tool response call ids', () => {
    const history = [
      marked(
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call-1',
              toolName: 'run',
              result: 'secret result',
            },
          ],
        },
        markerAt(1, 1, 1),
      ),
    ];

    const trace = buildChronologyTrace(history);

    expect(trace[0].toolResponseIds).toStrictEqual(['call-1']);
  });

  it('marks summary entries', () => {
    const history = [marked(summaryEntry('s'), markerAt(1, 1, 1))];

    const trace = buildChronologyTrace(history);

    expect(trace[0].isSummary).toBe(true);
  });

  it('surfaces the replaced span when present', () => {
    const summary: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 's' }],
      metadata: {
        isSummary: true,
        chronology: markerAt(4, 2, 1),
        chronologyReplaced: { fromSeq: 1, toSeq: 3, itemCount: 3 },
      },
    };

    const trace = buildChronologyTrace([summary]);

    expect(trace[0].replaced).toStrictEqual({
      fromSeq: 1,
      toSeq: 3,
      itemCount: 3,
    });
  });

  it('omits the replaced key when the item replaced nothing', () => {
    const trace = buildChronologyTrace([
      marked(humanText('a'), markerAt(1, 1, 1)),
    ]);

    expect(trace[0].replaced).toBeUndefined();
  });

  it('never leaks message text, tool parameters or tool results', () => {
    const history = [
      marked(humanText('SECRET_USER_TEXT'), markerAt(1, 1, 1)),
      marked(
        {
          speaker: 'ai',
          blocks: [
            { type: 'thinking', thought: 'SECRET_THOUGHT' },
            {
              type: 'tool_call',
              id: 'call-1',
              name: 'run',
              parameters: { token: 'SECRET_PARAM' },
            },
          ],
        },
        markerAt(2, 1, 2),
      ),
      marked(
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call-1',
              toolName: 'run',
              result: 'SECRET_RESULT',
            },
          ],
        },
        markerAt(3, 1, 3),
      ),
    ];

    const serialized = JSON.stringify(buildChronologyTrace(history));

    expect(serialized).not.toMatch(/SECRET_/);
  });
});
