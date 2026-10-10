import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readdirSync, rmSync } from 'node:fs';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildProviderContent } from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/core-suffix-fixture-test-helpers.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  withRequestContentsSnapshot,
  type RequestContentsSnapshot,
} from './streamRequestHelpers.js';

function snapshotHistoryRow(index: number): IContent {
  return {
    speaker: index === 0 || index === 31 ? 'ai' : 'human',
    blocks:
      index === 0 || index === 31
        ? [
            {
              type: 'tool_call',
              id: `far-${index}`,
              name: 'inspect',
              parameters: { index },
            },
          ]
        : [{ type: 'text', text: `row-${index}:"\\\n雪` }],
    metadata: {
      id: `history-${index}`,
      turnId: `history-turn-${index}`,
      cacheAnchor: index === 0,
    },
  };
}

function snapshotPendingRows(): IContent[] {
  return [0, 31, 64].map((index) => ({
    speaker: index === 64 ? 'human' : 'tool',
    blocks:
      index === 64
        ? [{ type: 'text', text: 'pending' }]
        : [
            {
              type: 'tool_response',
              callId: `far-${index}`,
              toolName: 'inspect',
              result: { index },
              isComplete: true,
            },
          ],
    metadata: {
      id: `input-${index}`,
      turnId: `input-turn-${index}`,
      cacheAnchor: index === 31,
      providerMetadata: { pendingIndex: index },
    },
  }));
}

function snapshotOracleBytes(row: IContent): string {
  const index = row.metadata?.providerMetadata?.pendingIndex;
  if (typeof index !== 'number') return JSON.stringify(row);
  return JSON.stringify({
    ...row,
    metadata: {
      ...row.metadata,
      id: `input-${index}`,
      turnId: `input-turn-${index}`,
    },
  });
}

async function inspectSnapshotPass(
  request: RequestContentsSnapshot,
  ownership: RowOwnership,
  oracle: readonly IContent[],
): Promise<string> {
  const hash = createHash('sha256');
  const pendingIds = new Set<string>();
  let index = 0;
  for await (const row of request.contents.openReader()) {
    expect(ownership.snapshot().liveRows).toBe(1);
    expect(snapshotOracleBytes(row)).toBe(JSON.stringify(oracle[index]));
    expect(request.pending.isPending(index)).toBe(
      index === 1 || index === 33 || index === 66,
    );
    if (row.metadata?.providerMetadata?.pendingIndex !== undefined) {
      expect(row.metadata.turnId).toMatch(/^turn_/);
      expect(row.metadata.id).toMatch(/^hist_tool_/);
      if (row.metadata.id === undefined) throw new Error('Missing pending ID');
      pendingIds.add(row.metadata.id);
    }
    hash.update(`${JSON.stringify(row)}\n`);
    index += 1;
  }
  expect(index).toBe(67);
  expect(pendingIds.size).toBe(1);
  expect(ownership.snapshot().liveRows).toBe(0);
  return hash.digest('hex');
}

async function checkSnapshotReaders(
  request: RequestContentsSnapshot,
  ownership: RowOwnership,
  oracle: readonly IContent[],
): Promise<void> {
  expect(request.contents.count).toBe(67);
  expect(Object.isFrozen(request.contents)).toBe(true);
  expect('close' in request.contents).toBe(false);
  expect('close' in request.pending).toBe(false);
  expect(request.pending.inputCount).toBe(3);
  expect(request.pending.firstOutputIndex).toBe(1);
  expect(
    [1, 33, 66].map((index) => request.pending.isPending(index)),
  ).toStrictEqual([true, true, true]);
  expect(request.pending.isPending(32)).toBe(false);
  const estimationHash = await inspectSnapshotPass(request, ownership, oracle);
  const bodyHash = await inspectSnapshotPass(request, ownership, oracle);
  expect(bodyHash).toBe(estimationHash);
  const left = request.contents.openReader();
  const right = request.contents.openReader();
  for (let index = 0; index < request.contents.count; index += 1) {
    const a = await left.next();
    const b = await right.next();
    expect(a.value).toStrictEqual(b.value);
    expect(a.value).not.toBe(b.value);
    expect(ownership.snapshot().liveRows).toBe(2);
  }
  expect((await left.next()).done).toBe(true);
  expect((await right.next()).done).toBe(true);
  expect(ownership.snapshot().peakRows).toBe(2);
  expect(ownership.snapshot().liveRows).toBe(0);
  await request.contents.openReader().next();
}

describe('scoped repeatable request snapshot', () => {
  it('reopens estimation and body readers over disk history with reordered pending membership and releases on close or cancel', async () => {
    await withCoreSuffixFixture(
      64,
      async (history, sourceOwnership, counters) => {
        const root = mkdtempSync(
          join(process.cwd(), 'tmp/request-slice1-fixture-'),
        );
        const ownership = new RowOwnership();
        let escaped: ProviderRequestRows | undefined;
        const oracle = buildProviderContent(
          Array.from({ length: 64 }, (_, index) => snapshotHistoryRow(index)),
          snapshotPendingRows(),
          new DebugLogger('slice1-eager-oracle'),
        );
        try {
          await withRequestContentsSnapshot(
            snapshotPendingRows(),
            history,
            async (request) => {
              escaped = request.contents;
              await checkSnapshotReaders(request, ownership, oracle);
            },
            { root, ownership },
          );
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(sourceOwnership.snapshot().liveRows).toBe(0);
          expect(counters.snapshot().peakDecodedRows).toBe(1);
          expect(readdirSync(root)).toHaveLength(0);
          if (escaped === undefined) throw new Error('Missing escaped view');
          expect(() => escaped?.openReader()).toThrow('snapshot is closed');
          const controller = new AbortController();
          await expect(
            withRequestContentsSnapshot(
              snapshotPendingRows(),
              history,
              async (request) => {
                const left = request.contents.openReader();
                const right = request.contents.openReader();
                await left.next();
                await right.next();
                expect(ownership.snapshot().liveRows).toBe(2);
                controller.abort(new Error('scoped request cancelled'));
                expect(ownership.snapshot().liveRows).toBe(0);
                expect(readdirSync(root)).toHaveLength(0);
                expect(() => request.pending.isPending(1)).toThrow(
                  'scoped request cancelled',
                );
                await expect(right.next()).rejects.toThrow(
                  'scoped request cancelled',
                );
                await left.next();
              },
              { root, ownership, signal: controller.signal },
            ),
          ).rejects.toThrow('scoped request cancelled');
          expect({
            files: readdirSync(root),
            liveRows: ownership.snapshot().liveRows,
          }).toStrictEqual({ files: [], liveRows: 0 });
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
      0,
      snapshotHistoryRow,
    );
  });
});
/** Reads the request rows through the shipped scoped snapshot. */
async function collectRequestRows(
  pending: IContent | IContent[],
  history: HistoryService,
  override?: Iterable<IContent> | AsyncIterable<IContent>,
  signal?: AbortSignal,
): Promise<{ contents: IContent[]; pendingInputCount: number }> {
  return withRequestContentsSnapshot(
    pending,
    history,
    async (request) => {
      const contents: IContent[] = [];
      for await (const row of request.contents.openReader(signal)) {
        contents.push(row);
      }
      return { contents, pendingInputCount: request.pending.inputCount };
    },
    { signal },
    override,
  );
}

describe('request cursor cancellation', () => {
  it('rejects a cancelled request before preparing any provider contents', async () => {
    const history = new HistoryService();
    const controller = new AbortController();
    controller.abort(new Error('request cancelled'));
    try {
      await expect(
        collectRequestRows(
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
          history,
          undefined,
          controller.signal,
        ),
      ).rejects.toThrow('request cancelled');
    } finally {
      history.dispose();
    }
  });
});

describe('request snapshot history override', () => {
  class CursorOnlyRequestHistory extends HistoryService {
    constructor(options?: ConstructorParameters<typeof HistoryService>[0]) {
      super(options);
      forbidHistoryMaterializationForTest(this, 'eager request preparation');
    }
  }

  describe('request preparation from a journal cursor', () => {
    it('prepares actual request rows without either eager history getter', async () => {
      const history = new CursorOnlyRequestHistory();
      try {
        history.add({
          speaker: 'human',
          blocks: [{ type: 'text', text: 'prior' }],
        });
        const result = await collectRequestRows(
          { speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] },
          history,
        );
        expect(result.contents.map((row) => row.blocks)).toStrictEqual([
          [{ type: 'text', text: 'prior' }],
          [{ type: 'text', text: 'pending' }],
        ]);
        expect(result.pendingInputCount).toBe(1);
        expect(result.contents[1].metadata?.id).toBeString();
        expect(result.contents[1].metadata?.turnId).toBeString();
      } finally {
        history.dispose();
      }
    });
  });

  it('curates an isolated provider copy with complete adjacent tool responses', async () => {
    const history = new HistoryService();
    const override: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'run the tool' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_interrupted',
            name: 'read_file',
            parameters: { path: 'README.md' },
          },
        ],
      },
    ];
    const pending: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'continue' }],
    };

    const result = await collectRequestRows(pending, history, override);
    const toolCallIndex = result.contents.findIndex((content) =>
      content.blocks.some(
        (block) =>
          block.type === 'tool_call' && block.id === 'hist_tool_interrupted',
      ),
    );

    expect(toolCallIndex).toBe(1);
    expect(result.contents[toolCallIndex + 1]?.speaker).toBe('tool');
    expect(
      result.contents[toolCallIndex + 1]?.blocks.some(
        (block) =>
          block.type === 'tool_response' &&
          block.callId === 'hist_tool_interrupted',
      ),
    ).toBe(true);
    expect(result.contents[result.contents.length - 1]?.speaker).toBe('human');
    expect(result.contents[0]).not.toBe(override[0]);
    expect(result.contents[0]?.blocks[0]).not.toBe(override[0]?.blocks[0]);
  });
});
