/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openParent } from './childaccept-parent.js';
import { nativeFileRows } from '../../compression/__tests__/support/native-file-rows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  acceptanceDirectory,
  childJournalExtension,
  launchAcceptanceChild,
  openChildResumeBoot,
} from './childaccept-fixture.js';
import { localTransport, sendChildHistory } from './childaccept-transport.js';
import {
  applyChildOperation,
  eagerFold,
  referenceBody,
  seededOperations,
  textRow,
} from './childaccept-operations.js';

async function verifyNativeRows(
  path: string,
  rows: readonly IContent[],
): Promise<IContent[]> {
  const persisted = await Array.fromAsync(nativeFileRows(path));
  expect(
    persisted.map(({ speaker, blocks }) => ({ speaker, blocks })),
  ).toStrictEqual(rows.map(({ speaker, blocks }) => ({ speaker, blocks })));
  return persisted;
}

async function verifyCommittedMutation(
  history: HistoryService,
  rows: readonly IContent[],
): Promise<void> {
  if (childJournalExtension() !== '.llxj') return;
  const path = history.journalPath();
  if (path === null) throw new Error('Child journal absent');
  const persisted = await verifyNativeRows(path, rows);
  expect(persisted).toStrictEqual(
    await Array.fromAsync(history.streamRawHistory()),
  );
}

async function verifyChildJournal(
  childPath: string,
  rows: readonly IContent[],
): Promise<void> {
  if (childJournalExtension() === '.llxj') {
    await verifyNativeRows(childPath, rows);
    return;
  }
  const journal = await readFile(childPath, 'utf8');
  for (const type of ['content', 'rewind', 'compressed', 'density_mutation'])
    expect(journal).toContain(`"type":"${type}"`);
}

describe('child facade transport equivalence', () => {
  it.each([854, 0xabcdef])(
    'child transport bytes match an independent eager mutation fold, seed %i',
    async (seed) => {
      const directory = await acceptanceDirectory('childaccept-body-');
      const transport = await localTransport(directory);
      const parent = await openParent(directory);
      const fixture = await launchAcceptanceChild(directory, transport.baseUrl);
      let rows: IContent[] = [];
      try {
        expect(fixture.child.runtime.history.constructor).toBe(
          parent.history.constructor,
        );
        const operations = seededOperations(seed);
        await writeFile(
          join(directory, 'operations.json'),
          JSON.stringify(operations),
        );
        for (const operation of operations) {
          rows = eagerFold(rows, operation);
          await applyChildOperation(fixture.child.runtime.history, operation);
          await verifyCommittedMutation(fixture.child.runtime.history, rows);
          await sendChildHistory(fixture.child);
          const reference = referenceBody(rows);
          await writeFile(
            join(directory, `reference-${transport.count()}.json`),
            reference,
          );
          expect(
            await readFile(
              join(directory, `request-${transport.count()}.json`),
              'utf8',
            ),
          ).toBe(reference);
          expect(transport.digest()).toBe(
            createHash('sha256').update(reference).digest('hex'),
          );
          expect(activeRequestBodyCount()).toBe(0);
        }
        expect(await readFile(parent.path)).toStrictEqual(parent.before);
        const childPath = fixture.child.runtime.history.journalPath();
        if (childPath === null) throw new Error('Child journal absent');
        await copyFile(
          childPath,
          join(directory, `child${childJournalExtension()}`),
        );
        await verifyChildJournal(childPath, rows);
      } finally {
        await parent.close();
        await fixture.close();
        await transport.close();
      }
    },
    180000,
  );
});

describe('child facade resume markers', () => {
  it('preserves live response parents and strips them through the real resume boot', async () => {
    const directory = await acceptanceDirectory('childaccept-markers-');
    const transport = await localTransport(directory);
    const fixture = await launchAcceptanceChild(directory, transport.baseUrl);
    const rows: IContent[] = [
      textRow('before parent'),
      {
        ...textRow('stored answer', true),
        metadata: {
          id: 'resp_saved',
          responsesStored: true,
          providerBaseURL: transport.baseUrl,
        },
      },
      textRow('after parent'),
    ];
    try {
      for (const row of rows)
        await applyChildOperation(fixture.child.runtime.history, {
          kind: 'append',
          row,
        });
      await sendChildHistory(fixture.child);
      expect(await readFile(join(directory, 'request-1.json'), 'utf8')).toBe(
        referenceBody(rows),
      );
      const path = fixture.child.runtime.history.journalPath();
      if (path === null) throw new Error('Child journal absent');
      await copyFile(path, join(directory, `child${childJournalExtension()}`));
      const boot = await openChildResumeBoot(path);
      try {
        await sendChildHistory(fixture.child, boot.streamRows());
        expect(await readFile(join(directory, 'request-2.json'), 'utf8')).toBe(
          referenceBody(rows, true),
        );
      } finally {
        await boot.close();
      }
      await sendChildHistory(fixture.child);
      expect(await readFile(join(directory, 'request-3.json'), 'utf8')).toBe(
        referenceBody(rows),
      );
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      await fixture.close();
      await transport.close();
    }
  }, 180000);
});

describe('child facade retry bytes', () => {
  it('retries with byte-identical child requests after a real transport refusal', async () => {
    const directory = await acceptanceDirectory('childaccept-retry-');
    const transport = await localTransport(directory);
    const fixture = await launchAcceptanceChild(directory, transport.baseUrl);
    let rows: IContent[] = [];
    try {
      for (const operation of seededOperations(854)) {
        rows = eagerFold(rows, operation);
        await applyChildOperation(fixture.child.runtime.history, operation);
      }
      transport.rejectNext();
      await sendChildHistory(fixture.child);
      expect(transport.count()).toBe(2);
      for (const attempt of [1, 2])
        expect(
          await readFile(join(directory, `request-${attempt}.json`), 'utf8'),
        ).toBe(referenceBody(rows));
      expect(activeRequestBodyCount()).toBe(0);
    } finally {
      await fixture.close();
      await transport.close();
    }
  }, 180000);
});
