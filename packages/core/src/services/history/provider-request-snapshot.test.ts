/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import { providerFixtureRow } from './provider-curated-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

const pending: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'pending' }],
  metadata: { id: 'pending-id', turnId: 'pending-turn', cacheAnchor: true },
};

async function withRoot(
  action: (root: string) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(process.cwd(), 'tmp/request-snapshot-'));
  try {
    await action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function digest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(`${JSON.stringify(row)}\n`);
  return hash.digest('hex');
}

async function* expectedRows(size: number): AsyncGenerator<IContent> {
  for (let index = 0; index < size; index++) yield suffixRow(index, 128);
  yield pending;
}

async function interleave(
  left: AsyncGenerator<IContent, void, unknown>,
  right: AsyncGenerator<IContent, void, unknown>,
): Promise<string> {
  const hash = createHash('sha256');
  for (let index = 0; index < 513; index++) {
    const a = await left.next();
    const b = await right.next();
    if (a.done === true || b.done === true) throw new Error('Premature EOF');
    const expected = index === 512 ? pending : suffixRow(index, 128);
    expect(a.value).toStrictEqual(expected);
    expect(JSON.stringify(b.value)).toBe(JSON.stringify(expected));
    expect(a.value).not.toBe(b.value);
    hash.update(`${JSON.stringify(b.value)}\n`);
    a.value.blocks.splice(0);
    if (a.value.metadata !== undefined) a.value.metadata.id = 'caller edit';
  }
  expect((await left.next()).done).toBe(true);
  expect((await right.next()).done).toBe(true);
  return hash.digest('hex');
}

describe('request-owned normalized disk snapshot', () => {
  it('supports async reader disposal without closing the snapshot', async () => {
    await withCoreSuffixFixture(512, async (history) => {
      const ownership = new RowOwnership();
      const snapshot = await history.prepareCuratedForProviderSnapshot([], {
        ownership,
      });
      try {
        const reader = snapshot.openReader();
        await reader.next();
        await reader[Symbol.asyncDispose]();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect((await reader.next()).done).toBe(true);
        expect(await digest(snapshot.openReader())).toBe(
          await digest(history.getCuratedForProviderStream()),
        );
      } finally {
        snapshot.close();
      }
    });
  });
  it('reopens independent bounded readers over 512 actual disk rows with stable bytes and values', async () => {
    await withCoreSuffixFixture(
      512,
      async (history, sourceOwners, counters) => {
        await withRoot(async (root) => {
          const ownership = new RowOwnership();
          const snapshot = await history.prepareCuratedForProviderSnapshot(
            [pending],
            { root, ownership },
          );
          try {
            expect(snapshot.count).toBe(513);
            expect(snapshot.pending).toStrictEqual({
              inputCount: 1,
              firstOutputIndex: 512,
            });
            expect(snapshot.isPending(511)).toBe(false);
            expect(snapshot.isPending(512)).toBe(true);
            const hash = await interleave(
              snapshot.openReader(),
              snapshot.openReader(),
            );
            expect(hash).toBe(await digest(expectedRows(512)));
            expect(await digest(snapshot.openReader())).toBe(hash);
            expect(ownership.snapshot().peakRows).toBe(2);
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(sourceOwners.snapshot().liveRows).toBe(0);
            expect(counters.snapshot().peakDecodedRows).toBe(1);
            expect(readdirSync(root)).toHaveLength(1);
          } finally {
            snapshot.close();
          }
          expect(readdirSync(root)).toHaveLength(0);
        });
      },
      128,
    );
  });
});

describe('normalized request snapshot isolation', () => {
  it('pins normalized values despite subsequent history and pending mutation', async () => {
    await withCoreSuffixFixture(
      512,
      async (history) => {
        const tail = structuredClone(pending);
        const snapshot = await history.prepareCuratedForProviderSnapshot([
          tail,
        ]);
        try {
          const expected = await digest(expectedRows(512));
          tail.blocks.splice(0);
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'later' }],
          });
          await history.waitForCommit();
          history.dispose();
          expect(await digest(snapshot.openReader())).toBe(expected);
          expect(snapshot.count).toBe(513);
        } finally {
          snapshot.close();
        }
      },
      128,
    );
  });
});

type ReaderExit = 'return' | 'throw' | 'cancel';
const exits: readonly ReaderExit[] = ['return', 'throw', 'cancel'];

async function stopReader(
  reader: AsyncGenerator<IContent, void, unknown>,
  controller: AbortController,
  exit: ReaderExit,
): Promise<string | undefined> {
  try {
    if (exit === 'return') await reader.return();
    if (exit === 'throw') await reader.throw(new Error('reader fault'));
    if (exit === 'cancel') {
      controller.abort(new Error('reader cancelled'));
      await reader.next();
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

describe('independent normalized request readers', () => {
  for (const exit of exits) {
    it(`closes one reader on ${exit} without destroying its owner or another reader`, async () => {
      await withCoreSuffixFixture(512, async (history) => {
        await withRoot(async (root) => {
          const ownership = new RowOwnership();
          const snapshot = await history.prepareCuratedForProviderSnapshot([], {
            root,
            ownership,
          });
          const controller = new AbortController();
          const reader = snapshot.openReader(controller.signal);
          const other = snapshot.openReader();
          try {
            await reader.next();
            await other.next();
            expect(ownership.snapshot().liveRows).toBe(2);
            const failures = {
              return: undefined,
              throw: 'reader fault',
              cancel: 'reader cancelled',
            };
            expect(await stopReader(reader, controller, exit)).toBe(
              failures[exit],
            );
            expect(ownership.snapshot().liveRows).toBe(1);
            expect((await other.next()).value).toStrictEqual(suffixRow(1));
            expect(await digest(snapshot.openReader())).toBe(
              await digest(history.getCuratedForProviderStream()),
            );
            expect(readdirSync(root)).toHaveLength(1);
          } finally {
            snapshot.close();
          }
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(readdirSync(root)).toHaveLength(0);
        });
      });
    });
  }
});

describe('normalized request owner lifetime', () => {
  it('owner disposal invalidates active and unopened readers and removes scratch immediately', async () => {
    await withCoreSuffixFixture(512, async (history) => {
      await withRoot(async (root) => {
        const ownership = new RowOwnership();
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          root,
          ownership,
        });
        const active = snapshot.openReader();
        const unopened = snapshot.openReader();
        await active.next();
        snapshot.close();
        snapshot.close();
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(readdirSync(root)).toHaveLength(0);
        await expect(active.next()).rejects.toThrow('snapshot is closed');
        await expect(unopened.next()).rejects.toThrow('snapshot is closed');
        expect(() => snapshot.openReader()).toThrow('snapshot is closed');
      });
    });
  });

  it('request abort disposes scratch and suspended rows without another reader pull', async () => {
    await withCoreSuffixFixture(512, async (history) => {
      await withRoot(async (root) => {
        const controller = new AbortController();
        const ownership = new RowOwnership();
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          root,
          ownership,
          signal: controller.signal,
        });
        const reader = snapshot.openReader();
        await reader.next();
        controller.abort(new Error('request cancelled'));
        expect(readdirSync(root)).toHaveLength(0);
        expect(ownership.snapshot().liveRows).toBe(0);
        await expect(reader.next()).rejects.toThrow('request cancelled');
        expect(() => snapshot.openReader()).toThrow('request cancelled');
        snapshot.close();
      });
    });
  });
});

describe('normalized request row size', () => {
  it('permits a 10 MiB disk row with no product cap and repeatable bytes', async () => {
    await withCoreSuffixFixture(
      1,
      async (history) => {
        const snapshot = await history.prepareCuratedForProviderSnapshot();
        try {
          const reader = snapshot.openReader();
          const first = await reader.next();
          if (first.done === true) throw new Error('Missing large row');
          expect(JSON.stringify(first.value)).toBe(
            JSON.stringify(suffixRow(0, 10 * 1024 * 1024)),
          );
          await reader.return();
          expect(await digest(snapshot.openReader())).toBe(
            await digest(history.getCuratedForProviderStream()),
          );
        } finally {
          snapshot.close();
        }
      },
      10 * 1024 * 1024,
    );
  });
});

describe('normalized request pending provenance', () => {
  it('records pending provenance even when a pending response moves next to an earlier history call', async () => {
    await withCoreSuffixFixture(
      512,
      async (history) => {
        const snapshot = await history.prepareCuratedForProviderSnapshot([
          {
            speaker: 'tool',
            blocks: [
              {
                type: 'tool_response',
                callId: 'far',
                toolName: 'inspect',
                result: 'tail',
              },
            ],
            metadata: { cacheAnchor: true },
          },
        ]);
        try {
          expect(snapshot.count).toBe(513);
          expect(snapshot.pending).toStrictEqual({
            inputCount: 1,
            firstOutputIndex: 1,
          });
          expect(snapshot.isPending(0)).toBe(false);
          expect(snapshot.isPending(1)).toBe(true);
          expect(snapshot.isPending(512)).toBe(false);
        } finally {
          snapshot.close();
        }
      },
      0,
      (index) =>
        index === 0
          ? {
              speaker: 'ai',
              blocks: [
                {
                  type: 'tool_call',
                  id: 'far',
                  name: 'inspect',
                  parameters: {},
                },
              ],
            }
          : suffixRow(index),
    );
  });
});

describe('normalized request disk faults', () => {
  it('cleans failed normalization and failed disk reads without leaking suspended owners', async () => {
    await withCoreSuffixFixture(512, async (history) => {
      await withRoot(async (root) => {
        async function* broken(): AsyncGenerator<IContent> {
          yield* history.streamRawHistory();
          throw new Error('source fault');
        }
        await expect(
          history.prepareCuratedForProviderSnapshot([], { root }, broken()),
        ).rejects.toThrow('source fault');
        expect(readdirSync(root)).toHaveLength(0);
        const ownership = new RowOwnership();
        const snapshot = await history.prepareCuratedForProviderSnapshot([], {
          root,
          ownership,
        });
        const reader = snapshot.openReader();
        try {
          await reader.next();
          rmSync(join(root, readdirSync(root)[0]), { recursive: true });
          await expect(reader.next()).rejects.toThrow(
            'Missing or invalid provider normalization row',
          );
          expect(ownership.snapshot().liveRows).toBe(0);
        } finally {
          snapshot.close();
        }
        expect(readdirSync(root)).toHaveLength(0);
      });
    });
  });
});

describe('normalized request production stream integration', () => {
  it('reopens mixed normalized tool/media output without changing the production stream bytes', async () => {
    await withCoreSuffixFixture(
      512,
      async (history) => {
        const snapshot = await history.prepareCuratedForProviderSnapshot();
        try {
          const expected = await digest(history.getCuratedForProviderStream());
          expect(await digest(snapshot.openReader())).toBe(expected);
          expect(await digest(snapshot.openReader())).toBe(expected);
          expect(snapshot.pending).toStrictEqual({
            inputCount: 0,
            firstOutputIndex: undefined,
          });
        } finally {
          snapshot.close();
        }
      },
      128,
      providerFixtureRow,
    );
  });
});
