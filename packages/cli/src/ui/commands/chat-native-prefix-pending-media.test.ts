/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  clientMediaStore,
  type IContent,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import { parseInstanceLeaseRecord } from '@vybestack/llxprt-code-core/storage/local-media-store-reservations.js';
import { parseReservationRecord } from '@vybestack/llxprt-code-core/storage/local-media-store-validation.js';
import { historyOwnerIdFor } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import {
  contents,
  row,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

function barrier(): { promise: Promise<void>; open(): void } {
  let open = (): void => {
    throw new Error('Missing barrier');
  };
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function assertRequestLease(
  root: string,
  reference: MediaReferenceBlock,
): Promise<void> {
  const directory = `${root}/references/sha256/${reference.contentId.slice('sha256:'.length)}`;
  const files = await readdir(directory);
  expect(files.length).toBe(1);
  expect(files[0]).not.toBe(
    createHash('sha256')
      .update(historyOwnerIdFor(reference.contentId))
      .digest('hex'),
  );
  const value: unknown = JSON.parse(
    await readFile(`${directory}/${files[0]}`, 'utf8'),
  );
  const reservation = parseReservationRecord(value);
  if (reservation === undefined) throw new Error('Missing request reservation');
  expect(reservation.ownerDigest).toBe(files[0]);
  expect(reservation.relatedContentIds).toContain(reference.contentId);
  const lease: unknown = JSON.parse(
    await readFile(`${root}/instances/${reservation.instanceId}`, 'utf8'),
  );
  expect(parseInstanceLeaseRecord(lease)?.instanceId).toBe(
    reservation.instanceId,
  );
}

async function consume(
  source: AsyncIterable<IContent>,
  resolver: RequestMediaResolver,
  signal: AbortSignal,
  entered: () => void,
  proceed: Promise<void>,
): Promise<string[]> {
  for await (const value of source) {
    if (!value.blocks.some((block) => block.type === 'media')) continue;
    const resolved = await resolver.resolve({
      contents: [value],
      requestId: 'cli-held-request',
      turnId: 'cli-held-turn',
      aggregateBudgetBytes: 1024,
      signal,
    });
    try {
      const payload = resolved.withContents((values) =>
        values[0].blocks.flatMap((block) =>
          block.type === 'media' && block.encoding === 'base64'
            ? [block.data]
            : [],
        ),
      );
      entered();
      await proceed;
      signal.throwIfAborted();
      return payload;
    } finally {
      await resolved.release();
    }
  }
  throw new Error('Missing pinned media row');
}

describe('actual CLI clear with a pinned pending media consumer', () => {
  const directory = useTempDir('cli-pending-media-');
  it.each(
    [3, 64, 65].flatMap((size) =>
      [false, true].map((abort) => ({ size, abort })),
    ),
  )(
    'keeps a request-only blob lease over clear at $size rows, abort=$abort',
    async ({ size, abort }) => {
      await withCLI(
        directory(),
        size,
        async ({ agent, client, history, context }) => {
          const store = clientMediaStore(client);
          if (store === undefined) throw new Error('Missing media store');
          const bytes = new Uint8Array([17, 29, 43, 255]);
          const reference = await store.admit({
            bytes,
            mimeType: 'image/png',
            semanticMetadata: {},
          });
          await agent.setHistory(
            Array.from({ length: size }, (_, index) =>
              index === size - 1
                ? { ...row(index), blocks: [reference] }
                : row(index),
            ),
          );
          await history.detachedValues.withCheckpoint(async (held) => {
            const entered = barrier();
            const proceed = barrier();
            const controller = new AbortController();
            const reason = new Error('pinned CLI transport aborted');
            const resolver = new RequestMediaResolver(store);
            const pending = consume(
              checkpointRows(held),
              resolver,
              controller.signal,
              entered.open,
              proceed.promise,
            ).then(
              (value) => ({ value, error: undefined }),
              (error: unknown) => ({ value: undefined, error }),
            );
            try {
              await entered.promise;
              expect(resolver.accounting().reservedContentCount).toBe(1);
              expect(await runCommand(context, 'clear')).toBeUndefined();
              await history.settleMediaOwnership();
              expect((await contents(client.getHistory())).length).toBe(2);
              await assertRequestLease(store.rootDirectory, reference);
              expect(
                (
                  await store.reclaimUnreferenced(
                    new Set(),
                    Number.MAX_SAFE_INTEGER,
                  )
                ).objectsRemoved,
              ).toBe(0);
              expect(await store.readReserved(reference)).toStrictEqual(bytes);
              const old = await contents(checkpointRows(held));
              expect(old.length).toBe(size);
              expect(old[size - 1].blocks).toStrictEqual([reference]);
              if (abort) controller.abort(reason);
              proceed.open();
              const result = await pending;
              expect(result.error).toBe(abort ? reason : undefined);
              expect(result.value).toStrictEqual(
                abort ? undefined : [Buffer.from(bytes).toString('base64')],
              );
              expect(resolver.accounting().activeRequestCount).toBe(0);
              expect(resolver.accounting().reservedContentCount).toBe(0);
              expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
              expect(await store.hasReservations(reference.contentId)).toBe(
                false,
              );
              expect(
                (
                  await store.reclaimUnreferenced(
                    new Set(),
                    Number.MAX_SAFE_INTEGER,
                  )
                ).objectsRemoved,
              ).toBe(1);
            } finally {
              controller.abort(reason);
              proceed.open();
              await pending;
            }
          });
        },
      );
    },
  );
});
