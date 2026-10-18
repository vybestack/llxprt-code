/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { observeHistorySynchronouslyForTest as synchronousTestHistory } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';

function compressSummary(text: string): {
  speaker: 'human';
  blocks: [{ type: 'text'; text: string }];
} {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function historyTexts(rows: readonly IContent[]): string[] {
  return rows.map((entry) => {
    const block = entry.blocks[0];
    return block.type === 'text' ? block.text : `<${block.type}>`;
  });
}

function runCompressionWith(
  service: HistoryService,
  act: (service: HistoryService, cleared: Array<Promise<void>>) => void,
): { observed: string[]; cleared: Array<Promise<void>> } {
  const observed: string[] = [];
  service.on('contentAdded', (content) => {
    const block = content.blocks[0];
    observed.push(
      `contentAdded:${block.type === 'text' ? block.text : block.type}`,
    );
  });
  service.on('compressionLockReleased', () => {
    observed.push('compressionLockReleased');
  });
  service.on('compressionEnded', () => {
    observed.push('compressionEnded');
  });
  const cleared: Array<Promise<void>> = [];
  service.startCompression();
  act(service, cleared);
  service.endCompression(compressSummary('window summary'), 1);
  return { observed, cleared };
}

function assertOldPhase(
  service: HistoryService,
  observed: string[],
  expected: string[],
  rows: string[],
): void {
  expect(observed).toStrictEqual(expected);
  expect(historyTexts(synchronousTestHistory(service))).toStrictEqual(rows);
}

function assertNativePhase(
  _service: HistoryService,
  observed: string[],
  _expected: string[],
  _rows: string[],
): void {
  expect(observed).toStrictEqual([]);
}

function assertOldUnlocked(service: HistoryService, texts: string[]): void {
  expect(
    synchronousTestHistory(service).map((entry) => entry.blocks[0]),
  ).toStrictEqual([{ type: 'text', text: 'immediate rebuilt' }]);
  expect(texts).toStrictEqual(['immediate rebuilt']);
}

function assertNativeUnlocked(_service: HistoryService, texts: string[]): void {
  expect(texts).toStrictEqual([]);
}

const backendCases = [
  {
    backend: 'old',
    assertPhase: assertOldPhase,
    assertUnlocked: assertOldUnlocked,
  },
  {
    backend: 'journal',
    assertPhase: assertNativePhase,
    assertUnlocked: assertNativeUnlocked,
  },
] as const;

describe.each([...backendCases])(
  'rebuild scope boundary matrix (#3338), $backend',
  ({ backend, assertPhase, assertUnlocked }) => {
    let historyService: HistoryService;

    beforeEach(() => {
      historyService = new HistoryService({ backend });
    });

    afterEach(async () => {
      await historyService.dispose();
    });

    const matrixRows: Array<{
      name: string;
      act: (service: HistoryService, cleared: Array<Promise<void>>) => void;
      expected: string[];
      history: string[];
    }> = [
      {
        name: 'a clear-only rebuild keeps a late streaming add after the release',
        act: (service: HistoryService, cleared: Array<Promise<void>>) => {
          service.rebuildWith(() => {
            cleared.push(service.clear());
          });
          service.add({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'late-only stream' }],
          });
        },
        expected: [
          'compressionLockReleased',
          'compressionEnded',
          'contentAdded:late-only stream',
        ],
        history: ['late-only stream'],
      },
      {
        name: 'keeps every rebuilt entry before the release in rebuild order',
        act: (service: HistoryService, cleared: Array<Promise<void>>) => {
          service.rebuildWith(() => {
            cleared.push(service.clear());
            for (const text of ['rebuilt-1', 'rebuilt-2', 'rebuilt-3']) {
              service.add({
                speaker: 'ai',
                blocks: [{ type: 'text', text }],
              });
            }
          });
        },
        expected: [
          'contentAdded:rebuilt-1',
          'contentAdded:rebuilt-2',
          'contentAdded:rebuilt-3',
          'compressionLockReleased',
          'compressionEnded',
        ],
        history: ['rebuilt-1', 'rebuilt-2', 'rebuilt-3'],
      },
      {
        name: 'keeps multiple streaming entries on both sides in original FIFO',
        act: (service: HistoryService, cleared: Array<Promise<void>>) => {
          service.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'before-1' }],
          });
          service.add({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'before-2' }],
          });
          service.rebuildWith(() => {
            cleared.push(service.clear());
            service.add({
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'rebuilt-1' }],
            });
          });
          service.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'after-1' }],
          });
          service.add({
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'after-2' }],
          });
        },
        expected: [
          'contentAdded:rebuilt-1',
          'compressionLockReleased',
          'compressionEnded',
          'contentAdded:before-1',
          'contentAdded:before-2',
          'contentAdded:after-1',
          'contentAdded:after-2',
        ],
        history: ['rebuilt-1', 'before-1', 'before-2', 'after-1', 'after-2'],
      },
      {
        name: 'keeps multiple clear/retry operations inside one rebuild scope',
        act: (service: HistoryService, cleared: Array<Promise<void>>) => {
          service.rebuildWith(() => {
            cleared.push(service.clear());
            service.add({
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'retry-rebuild' }],
            });
            cleared.push(service.clear());
            service.add({
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'retry-rebuilt-again' }],
            });
          });
        },
        expected: [
          'contentAdded:retry-rebuild',
          'contentAdded:retry-rebuilt-again',
          'compressionLockReleased',
          'compressionEnded',
        ],
        history: ['retry-rebuilt-again'],
      },
    ];

    it.each(matrixRows)('$name', async ({ act, expected, history }) => {
      const { observed, cleared } = runCompressionWith(historyService, act);
      assertPhase(historyService, observed, expected, history);
      await Promise.all(cleared);
      await historyService.waitForPendingOperations();
      await historyService.waitForCommit();
      expect(observed).toStrictEqual(expected);
      expect(
        historyTexts(await collectRawHistory(historyService)),
      ).toStrictEqual(history);
    });

    it('applies a rebuild synchronously when no compression lock is active', async () => {
      const texts: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        texts.push(block.type === 'text' ? block.text : block.type);
      });

      const cleared: Array<Promise<void>> = [];
      historyService.rebuildWith(() => {
        cleared.push(historyService.clear());
        historyService.add({
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'immediate rebuilt' }],
        });
      });

      assertUnlocked(historyService, texts);
      await Promise.all(cleared);
      await historyService.waitForCommit();
      expect(
        (await collectRawHistory(historyService)).map(
          (entry) => entry.blocks[0],
        ),
      ).toStrictEqual([{ type: 'text', text: 'immediate rebuilt' }]);
      expect(texts).toStrictEqual(['immediate rebuilt']);
    });
  },
);

type Expect<T extends true> = T;
type RebuildCallback = Parameters<HistoryService['rebuildWith']>[0];
type RejectsAsyncRebuild = Expect<
  [() => Promise<void>] extends [RebuildCallback] ? false : true
>;
const rebuildCallbackIsSynchronousOnly: RejectsAsyncRebuild = true;
void rebuildCallbackIsSynchronousOnly;
