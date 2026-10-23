/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  clientMediaStore,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import { JournalHistoryStore } from '@vybestack/llxprt-code-core/services/history/journalHistoryStore.js';
import { describe, expect, it, spyOn } from 'bun:test';
import {
  contents,
  operationFileCreates,
  persistedContents,
  row,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

const bytes = new Uint8Array([1, 3, 5, 7]);

describe('actual CLI native prefix media reservations', () => {
  const directory = useTempDir('cli-prefix-media-');
  for (const command of ['clear', 'restore']) {
    it(`keeps removed blobs available for ${command} compensation without a history snapshot`, async () => {
      await withCLI(
        directory(),
        3,
        async ({ agent, client, context, recording }) => {
          const store = clientMediaStore(client);
          if (store === undefined) throw new Error('Missing media store');
          const reference = await store.admit({
            bytes,
            mimeType: 'image/png',
            semanticMetadata: {},
          });
          await agent.setHistory([
            row(0),
            row(1),
            { ...row(2), blocks: [reference] },
          ]);
          const before = await contents(client.getHistory());
          const failure = new Error('client update failed after media removal');
          const original = client.setHistoryFromSource.bind(client);
          const fault = spyOn(
            client,
            'setHistoryFromSource',
          ).mockImplementationOnce(async (...args) => {
            await original(...args);
            await store.reclaimUnreferenced(new Set(), Date.now() + 1);
            expect(await store.readVerified(reference)).toStrictEqual(bytes);
            throw failure;
          });
          try {
            const receipt = await operationFileCreates(async () => {
              await expect(runCommand(context, command, '1')).rejects.toBe(
                failure,
              );
            });
            process.stdout.write(`CLI_MEDIA_FILES ${JSON.stringify(receipt)}
`);
            expect(receipt.files.length).toBeGreaterThan(0);
            const ownerFiles = receipt.files.filter(
              (path) => !path.startsWith(`${store.rootDirectory}/`),
            );
            expect(ownerFiles.length).toBeGreaterThan(0);
            expect(
              ownerFiles.every((path) =>
                /\/history-media-index-[^/]+\/[a-f0-9]{64}$/.test(path),
              ),
            ).toBe(true);
            const otherDirectories = receipt.directories.filter(
              (path) => !path.startsWith(store.rootDirectory),
            );
            expect(
              otherDirectories.every((path) =>
                path.endsWith('/history-media-index-'),
              ),
            ).toBe(true);
            process.stdout.write(
              `CLI_MEDIA_BOUNDARY ${JSON.stringify({ ownerFiles: ownerFiles.length, mediaStoreFiles: receipt.files.length - ownerFiles.length, historyCandidateFiles: 0 })}\n`,
            );
            expect(await contents(client.getHistory())).toStrictEqual(before);
            expect(await persistedContents(recording)).toStrictEqual(before);
            await store.reclaimUnreferenced(new Set(), Date.now() + 1);
            expect(await store.readVerified(reference)).toStrictEqual(bytes);
          } finally {
            fault.mockRestore();
          }
        },
      );
    });
  }

  it('keeps the original verified-blob read failure without changing live or durable history', async () => {
    await withCLI(
      directory(),
      3,
      async ({ agent, client, context, recording }) => {
        const store = clientMediaStore(client);
        if (store === undefined) throw new Error('Missing media store');
        const reference = await store.admit({
          bytes,
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await agent.setHistory([
          row(0),
          row(1),
          { ...row(2), blocks: [reference] },
        ]);
        const before = await contents(client.getHistory());
        const failure = new Error('verified blob read failed');
        const fault = spyOn(
          store,
          'reserveAndReadVerified',
        ).mockRejectedValueOnce(failure);
        try {
          await expect(runCommand(context, 'clear')).rejects.toBe(failure);
          expect(await contents(client.getHistory())).toStrictEqual(before);
          expect(await persistedContents(recording)).toStrictEqual(before);
        } finally {
          fault.mockRestore();
        }
      },
    );
  });

  it('reports source, compensation and reservation-release causes in their original order', async () => {
    await withCLI(directory(), 3, async ({ agent, client, context }) => {
      const store = clientMediaStore(client);
      if (store === undefined) throw new Error('Missing media store');
      const reference: MediaReferenceBlock = await store.admit({
        bytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      await agent.setHistory([
        row(0),
        row(1),
        { ...row(2), blocks: [reference] },
      ]);
      const primary = new Error('client publication failed');
      const rollback = new Error('version compensation failed');
      const release = new Error('media hold release failed');
      const originalPublish = client.setHistoryFromSource.bind(client);
      const originalRelease = store.release.bind(store);
      const publish = spyOn(
        client,
        'setHistoryFromSource',
      ).mockImplementationOnce(async (...args) => {
        await originalPublish(...args);
        throw primary;
      });
      const compensate = spyOn(
        JournalHistoryStore.prototype,
        'compensate',
      ).mockRejectedValueOnce(rollback);
      const cleanup = spyOn(store, 'release').mockImplementation(
        async (id, owner) => {
          await originalRelease(id, owner);
          if (owner.startsWith('clear-snapshot:')) throw release;
        },
      );
      try {
        const failure = await runCommand(context, 'clear').then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError))
          throw new Error('Missing cleanup aggregate');
        const cause: unknown = failure.errors[0];
        expect(cause).toBeInstanceOf(AggregateError);
        if (!(cause instanceof AggregateError))
          throw new Error('Missing compensation aggregate');
        expect(cause.cause).toBe(primary);
        expect(cause.errors).toStrictEqual([primary, rollback]);
        expect(failure.errors).toStrictEqual([cause, release]);
      } finally {
        publish.mockRestore();
        compensate.mockRestore();
        cleanup.mockRestore();
      }
    });
  });
});
