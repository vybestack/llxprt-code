/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { withNativeClearFixture } from './__tests__/support/native-clear-fixture.js';
import {
  createBlockedTokenizerFactory,
  rebuildAfterClear,
} from './compression-locking-test-helpers.js';

function row(text: string, speaker: 'human' | 'ai' = 'human'): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq: 1, userTurn: 1, step: 1, recordedAt: 1 } },
  };
}

function label(content: IContent): string {
  const block = content.blocks[0];
  return block.type === 'text' ? block.text : block.type;
}

function observe(history: HistoryService): string[] {
  const events: string[] = [];
  history.on('contentAdded', (content) => events.push(label(content)));
  history.on('compressionLockReleased', () => events.push('released'));
  history.on('compressionEnded', () => events.push('ended'));
  return events;
}

async function rejection(
  operation: Promise<void>,
): Promise<{ error: unknown }> {
  try {
    await operation;
  } catch (error) {
    return { error };
  }
  throw new Error('Expected operation to reject');
}

function applyRebuild(
  history: HistoryService,
  rebuild: () => undefined,
  scenario: string,
): void {
  if (scenario === 'throwing-callback')
    expect(() => history.rebuildWith(rebuild)).toThrow('rebuild failed');
  else history.rebuildWith(rebuild);
}

describe('native compression locking and asynchronous observation', () => {
  it('reads both committed curated rows while compression is active', async () => {
    await withNativeClearFixture(async ({ history }) => {
      await history.addBatch([row('Message 1'), row('Response 1', 'ai')]);
      history.startCompression();
      const curated: IContent[] = [];
      for await (const content of history.getCuratedForProviderStream())
        curated.push(content);
      expect(curated.map(label)).toStrictEqual(['Message 1', 'Response 1']);
      expect(curated).toHaveLength(2);
      history.endCompression();
    });
  });

  it('preserves additions from three overlapping compression callbacks', async () => {
    await withNativeClearFixture(async ({ history }) => {
      await Promise.all(
        Array.from({ length: 3 }, async (_, index) => {
          await history.waitForPendingOperations();
          history.startCompression();
          await Promise.resolve();
          history.add(row(`Compression ${index}`));
          history.endCompression();
        }),
      );
      await history.waitForPendingOperations();
      expect((await collectRawHistory(history)).map(label)).toStrictEqual([
        'Compression 0',
        'Compression 1',
        'Compression 2',
      ]);
    });
  });

  it('queues a tool call without changing the committed curated snapshot', async () => {
    await withNativeClearFixture(async ({ history, assertDurable }) => {
      await history.addBatch([row('initial')]);
      history.startCompression();
      const call: IContent = {
        ...row('unused', 'ai'),
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_test123',
            name: 'test_tool',
            parameters: {},
          },
        ],
      };
      history.add(call);
      expect(await collectRawHistory(history)).toStrictEqual([row('initial')]);
      const curated: IContent[] = [];
      for await (const content of history.getCuratedForProviderStream())
        curated.push(content);
      expect(curated).toHaveLength(1);
      history.endCompression();
      await history.waitForCommit();
      expect(await collectRawHistory(history)).toStrictEqual([
        row('initial'),
        call,
      ]);
      await assertDurable([row('initial'), call]);
    });
  });

  it('never drops any of the original 5000 queued additions and preserves every position', async () => {
    await withNativeClearFixture(async ({ history, assertDurable }) => {
      history.startCompression();
      for (let index = 0; index < 5000; index++)
        history.add(row(`queued-${index}`));
      expect(await collectRawHistory(history)).toHaveLength(0);
      history.endCompression();
      await history.waitForCommit();
      const expected = Array.from({ length: 5000 }, (_, index) =>
        row(`queued-${index}`),
      );
      expect(await collectRawHistory(history)).toStrictEqual(expected);
      await assertDurable(expected);
    });
  });

  it('releases a failed compression body and accepts the next addition', async () => {
    await withNativeClearFixture(async ({ history }) => {
      history.startCompression();
      const failure = new Error('compression failed');
      expect(() => {
        try {
          throw failure;
        } finally {
          history.endCompression();
        }
      }).toThrow(failure);
      history.add(row('applied after release'));
      expect(await collectRawHistory(history)).toStrictEqual([
        row('applied after release'),
      ]);
    });
  });

  for (const ending of ['argless', 'failed-shaped', 'summary', 'no-start']) {
    it(`preserves release and streaming event order for ${ending}`, async () => {
      await withNativeClearFixture(async ({ history }) => {
        const events = observe(history);
        if (ending !== 'no-start') history.startCompression();
        if (ending !== 'no-start') history.add(row('streaming'));
        const summary = ending === 'summary' ? row('summary') : undefined;
        history.endCompression(summary, ending === 'argless' ? undefined : 3);
        await history.waitForCommit();
        const expected = ['released'];
        if (ending === 'summary') expected.push('ended');
        if (ending !== 'no-start') expected.push('streaming');
        expect(events).toStrictEqual(expected);
      });
    });
  }
});

describe('native rebuild and streaming FIFO', () => {
  for (const scenario of [
    'early',
    'several',
    'late',
    'throwing-callback',
    'blocked-replace',
  ]) {
    it(`retains rebuild membership and release ordering with ${scenario} streaming`, async () => {
      await withNativeClearFixture(async (fixture) => {
        const { history, assertDurable } = fixture;
        const retained = [row('original question')];
        await history.addBatch(retained);
        const events = observe(history);
        const blocked = createBlockedTokenizerFactory();
        let replacing = Promise.resolve();
        if (scenario === 'blocked-replace') {
          history.setTokenizerFactory(blocked.factory);
          const started = blocked.blockNext();
          replacing = history.replaceAll([row('replacement')]);
          await Promise.race([
            started,
            replacing.then(() => {
              throw new Error('Replacement did not pause');
            }),
          ]);
        }
        history.startCompression();
        const streaming =
          scenario === 'several'
            ? [
                {
                  ...row('unused', 'ai'),
                  blocks: [
                    {
                      type: 'tool_response' as const,
                      callId: 'call_mid',
                      toolName: 'probe_tool',
                      result: { ok: true },
                    },
                  ],
                },
                row('follow-up stream chunk', 'ai'),
              ]
            : [row('mid-stream content', 'ai')];
        if (scenario !== 'late')
          for (const content of streaming) history.add(content);
        const clears: Array<Promise<void>> = [];
        const rebuild = (): undefined => {
          clears.push(history.clear());
          for (const content of retained) history.add(content);
          if (scenario === 'throwing-callback')
            throw new Error('rebuild failed');
        };
        applyRebuild(history, rebuild, scenario);
        if (scenario === 'late')
          for (const content of streaming) history.add(content);
        history.endCompression(row('summary'), 1);
        expect(events).toStrictEqual([]);
        blocked.release();
        await replacing;
        await Promise.all(clears);
        await history.waitForPendingOperations();
        await history.waitForCommit();
        expect(events).toStrictEqual([
          'original question',
          'released',
          'ended',
          ...streaming.map(label),
        ]);
        expect(await collectRawHistory(history)).toStrictEqual([
          ...retained,
          ...streaming,
        ]);
        await assertDurable([...retained, ...streaming]);
      });
    });
  }

  it('rebuilds a call and accepts the queued response without duplicating the id', async () => {
    await withNativeClearFixture(async ({ history }) => {
      const call: IContent = {
        ...row('unused', 'ai'),
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_abc123',
            name: 'glob',
            parameters: { pattern: '*.ts' },
          },
        ],
      };
      await history.addBatch([row('Do something'), call]);
      history.startCompression();
      const cleared = rebuildAfterClear(history, () => {
        history.add(row('Compressed context'));
        history.add(call);
      });
      const response: IContent = {
        ...row('unused'),
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_abc123',
            toolName: 'glob',
            result: { files: ['test.ts'] },
          },
        ],
      };
      history.add(response);
      history.endCompression();
      await cleared;
      const rows = await collectRawHistory(history);
      expect(rows).toStrictEqual([row('Compressed context'), call, response]);
      expect(
        rows
          .flatMap((content) => content.blocks)
          .filter(
            (block) =>
              block.type === 'tool_call' && block.id === 'hist_tool_abc123',
          ),
      ).toHaveLength(1);
    });
  });
});

describe('native compression flush failure cleanup', () => {
  for (const kind of ['release-error', 'release-undefined', 'rebuild-error']) {
    it(`reports ${kind} while preserving release, rebuilt rows and streaming work`, async () => {
      await withNativeClearFixture(async ({ history, assertDurable }) => {
        await history.addBatch([row('original question')]);
        const events = observe(history);
        const failure =
          kind === 'release-undefined'
            ? undefined
            : new Error('listener failure');
        if (kind === 'rebuild-error') {
          const reject = (): void => {
            history.off('tokensUpdated', reject);
            throw failure;
          };
          history.on('tokensUpdated', reject);
        } else
          history.on('compressionLockReleased', () => {
            throw failure;
          });
        history.startCompression();
        history.add(row('mid-stream content', 'ai'));
        const cleared = rebuildAfterClear(history, () => {
          history.add(row('original question'));
        });
        history.endCompression(row('summary'), 1);
        expect((await rejection(cleared)).error).toBe(failure);
        expect(
          (await rejection(history.waitForPendingOperations())).error,
        ).toBe(failure);
        await history.waitForCommit();
        expect(events).toContain('released');
        expect(events.indexOf('original question')).toBeLessThan(
          events.indexOf('released'),
        );
        expect(events.indexOf('mid-stream content')).toBeGreaterThan(
          events.indexOf('released'),
        );
        const expected = [
          row('original question'),
          row('mid-stream content', 'ai'),
        ];
        expect(await collectRawHistory(history)).toStrictEqual(expected);
        await assertDurable(expected);
        await history.waitForPendingOperations();
      });
    });
  }
});
