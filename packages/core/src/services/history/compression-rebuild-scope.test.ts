/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { observeHistorySynchronouslyForTest as synchronousTestHistory } from '@vybestack/llxprt-code-test-utils/core/synchronous-history-test-observation.js';

function compressSummary(text: string): {
  speaker: 'human';
  blocks: [{ type: 'text'; text: string }];
} {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function historyTexts(service: HistoryService): string[] {
  return synchronousTestHistory(service).map((entry) => {
    const block = entry.blocks[0];
    return block.type === 'text' ? block.text : `<${block.type}>`;
  });
}

function runCompressionWith(
  service: HistoryService,
  act: (service: HistoryService, cleared: Array<Promise<void>>) => void,
): { observed: string[]; texts: string[]; cleared: Array<Promise<void>> } {
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
  return { observed, texts: historyTexts(service), cleared };
}

describe('rebuild scope boundary matrix (#3338)', () => {
  let historyService: HistoryService;

  beforeEach(() => {
    historyService = new HistoryService();
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
    const { observed, texts, cleared } = runCompressionWith(
      historyService,
      act,
    );
    expect(observed).toStrictEqual(expected);
    expect(texts).toStrictEqual(history);
    await Promise.all(cleared);
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

    expect(
      synchronousTestHistory(historyService).map((entry) => entry.blocks[0]),
    ).toStrictEqual([{ type: 'text', text: 'immediate rebuilt' }]);
    expect(texts).toStrictEqual(['immediate rebuilt']);
    await Promise.all(cleared);
  });
});

type Expect<T extends true> = T;
type RebuildCallback = Parameters<HistoryService['rebuildWith']>[0];
type RejectsAsyncRebuild = Expect<
  [() => Promise<void>] extends [RebuildCallback] ? false : true
>;
const rebuildCallbackIsSynchronousOnly: RejectsAsyncRebuild = true;
void rebuildCallbackIsSynchronousOnly;
