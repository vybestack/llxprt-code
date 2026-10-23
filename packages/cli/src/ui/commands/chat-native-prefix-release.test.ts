/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { clientMediaStore } from '@vybestack/llxprt-code-core';
import { describe, expect, it, spyOn } from 'bun:test';
import { readdir } from 'node:fs/promises';
import {
  contents,
  persistedContents,
  row,
  runCommand,
  useTempDir,
  withCLI,
} from './native-prefix-test-helpers.js';

async function reservationFiles(root: string): Promise<string[]> {
  return (
    await readdir(`${root}/references/sha256`, {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => `${entry.parentPath}/${entry.name}`)
    .sort();
}

describe('actual CLI prefix release failure drains every held media reference', () => {
  const directory = useTempDir('cli-prefix-release-');
  it('restores old media and releases later holds after an earlier release fails', async () => {
    await withCLI(
      directory(),
      3,
      async ({ agent, client, context, recording }) => {
        const store = clientMediaStore(client);
        if (store === undefined) throw new Error('Missing media store');
        const a = await store.admit({
          bytes: new Uint8Array([1, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const b = await store.admit({
          bytes: new Uint8Array([2, 4]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await agent.setHistory([row(0), row(1), { ...row(2), blocks: [a, b] }]);
        const before = await contents(client.getHistory());
        const reservations = await reservationFiles(store.rootDirectory);
        const primary = new Error('client publication failed');
        const cleanupFailure = new Error('first media hold release failed');
        const originalPublish = client.setHistoryFromSource.bind(client);
        const originalRelease = store.release.bind(store);
        const publish = spyOn(
          client,
          'setHistoryFromSource',
        ).mockImplementationOnce(async (...args) => {
          await originalPublish(...args);
          throw primary;
        });
        let failed = false;
        const release = spyOn(store, 'release').mockImplementation(
          async (id, owner) => {
            await originalRelease(id, owner);
            if (!failed && owner.startsWith('clear-snapshot:')) {
              failed = true;
              throw cleanupFailure;
            }
          },
        );
        try {
          const failure = await runCommand(context, 'clear').then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(AggregateError);
          if (!(failure instanceof AggregateError))
            throw new Error('Missing release aggregate');
          expect(failure.errors).toStrictEqual([primary, cleanupFailure]);
          expect(await contents(client.getHistory())).toStrictEqual(before);
          expect(await persistedContents(recording)).toStrictEqual(before);
          expect(await reservationFiles(store.rootDirectory)).toStrictEqual(
            reservations,
          );
        } finally {
          publish.mockRestore();
          release.mockRestore();
        }
      },
    );
  });
  it('surfaces a post-publication media-release failure without claiming success or undoing an acknowledged cut', async () => {
    await withCLI(
      directory(),
      3,
      async ({ agent, client, context, recording }) => {
        const store = clientMediaStore(client);
        if (store === undefined) throw new Error('Missing media store');
        const reference = await store.admit({
          bytes: new Uint8Array([7, 9]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await agent.setHistory([
          row(0),
          row(1),
          { ...row(2), blocks: [reference] },
        ]);
        const failure = new Error('acknowledged cut release failed');
        const original = store.release.bind(store);
        let failed = false;
        const fault = spyOn(store, 'release').mockImplementation(
          async (id, owner) => {
            await original(id, owner);
            if (!failed && owner.startsWith('clear-snapshot:')) {
              failed = true;
              throw failure;
            }
          },
        );
        try {
          await expect(runCommand(context, 'clear')).rejects.toBe(failure);
          expect(
            (await contents(client.getHistory())).map((value) => value.blocks),
          ).toStrictEqual([row(0).blocks, row(1).blocks]);
          expect(
            (await persistedContents(recording)).map((value) => value.blocks),
          ).toStrictEqual([row(0).blocks, row(1).blocks]);
          expect(await store.hasReservations(reference.contentId)).toBe(false);
        } finally {
          fault.mockRestore();
        }
      },
    );
  });
});
