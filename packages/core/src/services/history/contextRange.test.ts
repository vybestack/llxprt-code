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

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 * Behavioral tests for the core context-range API and the
 * contextRangeChanged event, against a real HistoryService.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import type { ContextRange } from './historyEventTypes.js';
import { HistoryService } from './HistoryService.js';

function textContent(speaker: 'human' | 'ai', text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function seqOf(
  service: HistoryService,
  positionFromEnd: number,
): number | undefined {
  const entries = service.getRecent(positionFromEnd + 1);
  const entry = entries[entries.length - 1 - positionFromEnd];
  return entry?.metadata?.chronology?.seq;
}

describe('HistoryService context range', () => {
  it('reports the boundary of the curated history after adds', async () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three', 'four', 'five']) {
      service.add(textContent('human', text));
    }
    await service.waitForTokenUpdates?.();
    const range = service.getContextRange();
    expect(range.totalEntries).toBe(5);
    expect(range.firstSeq).toBe(seqOf(service, 4));
    expect(range.lastSeq).toBe(seqOf(service, 0));
    expect(range.firstSeq).toBeLessThan(range.lastSeq);
  });

  it('reports an empty range after clear', () => {
    const service = new HistoryService();
    service.add(textContent('human', 'only'));
    service.clear();
    expect(service.getContextRange()).toEqual({
      firstSeq: 0,
      lastSeq: 0,
      totalEntries: 0,
    });
  });

  it('emits contextRangeChanged once per boundary-moving commit, not per add', async () => {
    const service = new HistoryService();
    const events: ContextRange[] = [];
    service.on('contextRangeChanged', (range) => {
      events.push(range);
    });
    service.add(textContent('human', 'one'));
    service.add(textContent('ai', 'two'));
    service.add(textContent('human', 'three'));
    expect(events).toEqual([]);

    await service.transformAll((contents) => [
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'summary of three' }],
        metadata: {
          chronology: { seq: 99 },
          chronologyReplaced: { fromSeq: 1, toSeq: 3 },
        },
      },
      ...contents.slice(3),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.totalEntries).toBe(1);
    expect(events[0]?.firstSeq).toBe(99);
    expect(events[0]?.lastSeq).toBe(99);
  });

  it('emits on clear with a zero-entry range', () => {
    const service = new HistoryService();
    service.add(textContent('human', 'one'));
    const events: ContextRange[] = [];
    service.on('contextRangeChanged', (range) => {
      events.push(range);
    });
    service.clear();
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ firstSeq: 0, lastSeq: 0, totalEntries: 0 });
  });

  it('exposes compression summaries with their replaced span and text', async () => {
    const service = new HistoryService();
    for (const text of ['one', 'two', 'three', 'four']) {
      service.add(textContent('human', text));
    }
    expect(service.getContextSummaries()).toEqual([]);

    await service.transformAll(() => [
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'summary of four' }],
        metadata: {
          chronology: { seq: 98 },
          chronologyReplaced: { fromSeq: 1, toSeq: 4 },
        },
      },
    ]);
    const summaries = service.getContextSummaries();
    expect(summaries).toHaveLength(1);
    const summary = summaries[0];
    expect(summary?.seq).toBe(98);
    expect(summary?.replacedFromSeq).toBe(1);
    expect(summary?.replacedToSeq).toBe(4);
    expect(summary?.itemCount).toBe(4);
    expect(summary?.text).toBe('summary of four');
  });
});
