/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { JournalProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/journal-provider-request.js';
import type { PinnedMediaLease } from '@vybestack/llxprt-code-core/storage/history-media-release-gate.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { historyOwnerIdFor } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { parseReservationRecord } from '@vybestack/llxprt-code-core/storage/local-media-store-validation.js';
import { parseInstanceLeaseRecord } from '@vybestack/llxprt-code-core/storage/local-media-store-reservations.js';
import { withNativePurgeFixture } from '../../../core/src/services/history/__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';

function sourceRow(index: number, image: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    blocks:
      index === 1
        ? [image]
        : [{ type: 'text', text: `immutable source ${index}` }],
    metadata: { id: `lease-${index}` },
  };
}

async function assertLeaseOwners(
  root: string,
  contentId: string,
  owners: readonly string[],
): Promise<void> {
  const directory = join(
    root,
    'references',
    'sha256',
    contentId.slice('sha256:'.length),
  );
  const expected = owners.map((ownerId) => ({
    ownerId,
    digest: createHash('sha256').update(ownerId).digest('hex'),
  }));
  const files = await readdir(directory);
  expect(files.sort()).toStrictEqual(
    expected.map(({ digest }) => digest).sort(),
  );
  for (const { ownerId, digest } of expected) {
    const value: unknown = JSON.parse(
      await readFile(join(directory, digest), 'utf8'),
    );
    const reservation = parseReservationRecord(value);
    if (reservation === undefined)
      throw new Error('Missing valid owner reservation');
    expect(reservation.ownerDigest).toBe(digest);
    expect(reservation.relatedContentIds).toStrictEqual([contentId]);
    const leaseValue: unknown = JSON.parse(
      await readFile(join(root, 'instances', reservation.instanceId), 'utf8'),
    );
    const lease = parseInstanceLeaseRecord(leaseValue);
    expect(lease?.instanceId).toBe(reservation.instanceId);
    expect(lease?.token.length).toBeGreaterThan(0);
    process.stdout.write(
      `PURGE_MEDIA_OWNER ${JSON.stringify({ directory, ownerId, reservation, instance: { instanceId: lease?.instanceId, createdAt: lease?.createdAt } })}
`,
    );
  }
}

async function collectGarbage(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
}

async function consumePinned(
  query: IndexedJournalRequestSnapshot,
  resolver: RequestMediaResolver,
  signal: AbortSignal,
  payloadRead: () => void,
  transportGate: Promise<void>,
  refs: Array<WeakRef<IContent>>,
  lease?: PinnedMediaLease,
): Promise<string[]> {
  const payloads: string[] = [];
  for await (const row of query.openReader(signal)) {
    refs.push(new WeakRef(row));
    const resolved = await resolver.resolve({
      contents: [row],
      requestId: 'native-pending',
      turnId: 'native-turn',
      aggregateBudgetBytes: 1024,
      signal,
      lease,
    });
    try {
      const payload = resolved.withContents((contents) =>
        contents[0].blocks.flatMap((block) =>
          block.type === 'media' && block.encoding === 'base64'
            ? [block.data]
            : [],
        ),
      );
      if (payload.length > 0) {
        payloadRead();
        await transportGate;
        signal.throwIfAborted();
        payloads.push(...payload);
      }
    } finally {
      await resolved.release();
    }
    await collectGarbage();
    expect(
      refs.filter((ref) => ref.deref() !== undefined).length,
    ).toBeLessThanOrEqual(1);
    expect(resolver.accounting().reservedContentCount).toBe(0);
  }
  return payloads;
}

describe('native pending media consumer below provider preparation', () => {
  it.each(
    [3, 64, 65].flatMap((size) =>
      [false, true].flatMap((abort) =>
        ['external', 'native'].map((source) => ({ size, abort, source })),
      ),
    ),
  )(
    'holds immutable reserved bytes through actual purge and janitor at $size, abort=$abort, source=$source',
    async ({ size, abort, source }) => {
      await withNativePurgeFixture(
        async ({ history, store, session, owners }) => {
          const originalBytes = new Uint8Array([17, 29, 43, 255]);
          const image = await store.admit({
            bytes: originalBytes,
            mimeType: 'image/png',
            semanticMetadata: {},
          });
          await history.detachedValues.replace(
            (async function* () {
              for (let index = 0; index < size; index++)
                yield sourceRow(index, image);
            })(),
          );
          const pin = await session.store.snapshot();
          const request =
            source === 'native'
              ? await JournalProviderRequestSnapshot.create(
                  pin,
                  [],
                  {},
                  undefined,
                  () => pin.close(),
                  undefined,
                  store,
                )
              : undefined;
          const query =
            request?.indexed ??
            (await IndexedJournalRequestSnapshot.create(pin));
          let sourceClose: Promise<void> | undefined;
          const closeSource = (): Promise<void> => {
            sourceClose ??=
              request === undefined
                ? (async () => {
                    await query.close();
                    await pin.close();
                  })()
                : request.close();
            return sourceClose;
          };
          const requestOwners: string[] = [];
          const reserveAndRead = store.reserveAndReadVerified.bind(store);
          const trace = spyOn(
            store,
            'reserveAndReadVerified',
          ).mockImplementation(async (reference, ownerId) => {
            if (ownerId.startsWith('native-pending:'))
              requestOwners.push(ownerId);
            return reserveAndRead(reference, ownerId);
          });
          const resolver = new RequestMediaResolver(store);
          const controller = new AbortController();
          const payloadRead = Promise.withResolvers<void>();
          const transport = Promise.withResolvers<void>();
          const originalError = new Error('native pending transport aborted');
          const refs: Array<WeakRef<IContent>> = [];
          const pending = consumePinned(
            query,
            resolver,
            controller.signal,
            payloadRead.resolve,
            transport.promise,
            refs,
            request?.native.mediaLease,
          );
          const outcome = pending.then(
            (value) => ({ value, error: undefined }),
            (error: unknown) => ({ value: undefined, error }),
          );
          try {
            await payloadRead.promise;
            expect(resolver.accounting().reservedContentCount).toBe(
              source === 'external' ? 1 : 0,
            );
            const externalOwner = expect.stringMatching(/^native-pending:/);
            expect(requestOwners).toStrictEqual(
              source === 'external' ? [externalOwner] : [],
            );
            const expectedOwners = [
              historyOwnerIdFor(image.contentId),
              ...requestOwners,
            ];
            await assertLeaseOwners(
              store.rootDirectory,
              image.contentId,
              expectedOwners,
            );
            const purge = new SemanticMediaPurgeSession({
              history,
              mode: () => 'remove',
              persist: async () => undefined,
            });
            const attempt = await purge.begin(false);
            if (attempt === undefined)
              throw new Error('Missing native media purge');
            try {
              expect(
                await attempt.complete({
                  status: 'success',
                  usage: undefined,
                  retryHandoff: false,
                }),
              ).toBe(true);
            } finally {
              await attempt.finalize();
            }
            await history.waitForOwnershipSettlement();
            expect(owners.snapshot().liveRows).toBe(0);
            await assertLeaseOwners(
              store.rootDirectory,
              image.contentId,
              expectedOwners,
            );
            expect(
              (
                await store.reclaimUnreferenced(
                  new Set(),
                  Number.MAX_SAFE_INTEGER,
                )
              ).objectsRemoved,
            ).toBe(0);
            expect(await store.readReserved(image)).toStrictEqual(
              originalBytes,
            );
            expect((await query.readAt(1)).blocks).toStrictEqual([image]);
            const nextPin = await session.store.snapshot();
            const next = await IndexedJournalRequestSnapshot.create(nextPin);
            try {
              let mediaCount = 0;
              for await (const row of next.openReader())
                mediaCount += row.blocks.filter(
                  (block) => block.type === 'media',
                ).length;
              expect(next.count).toBe(size - 1);
              expect(mediaCount).toBe(0);
            } finally {
              await next.close();
              await nextPin.close();
            }
            if (abort) controller.abort(originalError);
            transport.resolve();
            const result = await outcome;
            expect(result.error).toBe(abort ? originalError : undefined);
            expect(result.value).toStrictEqual(
              abort
                ? undefined
                : [Buffer.from(originalBytes).toString('base64')],
            );
            expect(resolver.accounting().activeRequestCount).toBe(0);
            expect(resolver.accounting().reservedContentCount).toBe(0);
            expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
            await assertLeaseOwners(store.rootDirectory, image.contentId, [
              historyOwnerIdFor(image.contentId),
            ]);
            expect(
              (
                await store.reclaimUnreferenced(
                  new Set(),
                  Number.MAX_SAFE_INTEGER,
                )
              ).objectsRemoved,
            ).toBe(0);
            await closeSource();
            expect(session.store.mediaPins.oldestVersion).toBeUndefined();
            expect(await store.hasReservations(image.contentId)).toBe(false);
            expect(
              (
                await store.reclaimUnreferenced(
                  new Set(),
                  Number.MAX_SAFE_INTEGER,
                )
              ).objectsRemoved,
            ).toBe(1);
            await expect(store.readVerified(image)).rejects.toThrow(
              'contentId',
            );
          } finally {
            controller.abort(originalError);
            transport.resolve();
            await outcome;
            trace.mockRestore();
            await closeSource();
          }
          await collectGarbage();
          expect(refs.filter((ref) => ref.deref() !== undefined).length).toBe(
            0,
          );
          process.stdout.write(
            `PURGE_PENDING_MEDIA ${JSON.stringify({ size, abort, source, finalRows: 0, reservations: resolver.accounting().reservedContentCount })}\n`,
          );
        },
      );
    },
  );
  it('resolves 65 distinct media units without retaining prior rows or reservation IDs', async () => {
    await withNativePurgeFixture(async ({ history, store, session }) => {
      await history.detachedValues.replace(
        (async function* () {
          for (let index = 0; index < 65; index++) {
            const image = await store.admit({
              bytes: new Uint8Array([index, 117]),
              mimeType: 'image/png',
              semanticMetadata: {},
            });
            yield { speaker: 'human', blocks: [image] } satisfies IContent;
          }
        })(),
      );
      const pin = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(pin);
      const resolver = new RequestMediaResolver(store);
      const refs: Array<WeakRef<IContent>> = [];
      let units = 0;
      try {
        const payloads = await consumePinned(
          query,
          resolver,
          new AbortController().signal,
          () => {
            units++;
            expect(resolver.accounting().activeRequestCount).toBe(1);
            expect(resolver.accounting().reservedContentCount).toBe(1);
            expect(resolver.accounting().materializedNormalizedBytes).toBe(4);
          },
          Promise.resolve(),
          refs,
        );
        expect(payloads).toStrictEqual(
          Array.from({ length: 65 }, (_, index) =>
            Buffer.from([index, 117]).toString('base64'),
          ),
        );
        expect(units).toBe(65);
        expect(resolver.accounting().activeRequestCount).toBe(0);
      } finally {
        await query.close();
        await pin.close();
      }
      await collectGarbage();
      expect(refs.filter((ref) => ref.deref() !== undefined).length).toBe(0);
    });
  });
});
