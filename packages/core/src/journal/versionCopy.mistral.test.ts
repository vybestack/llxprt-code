/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { ID_NS } from './idKeys.js';
import type { JournalStore } from './journalStore.js';
import { readValueBody } from './mapEntries.js';
import { cloneVersion } from './versionCopy.js';
import {
  copyDeps,
  openStore,
  removeFile,
} from './__tests__/support/copyFixtures.js';
import {
  MISTRAL_SLOT,
  writeMistralSource,
} from './__tests__/support/handBuiltSource.js';
import { hex } from './__tests__/support/idTrieHarness.js';
import { pair, realMapping } from './__tests__/support/mistralFixtures.js';
import { OffsetAudit } from './__tests__/support/offsetAudit.js';
import { snapshotStore } from './__tests__/support/storeSnapshot.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { trackPinnedAccess } from './__tests__/support/pinnedAccess.js';

const accessOf = trackPinnedAccess();

const SOURCE_ID = 'toolu_alpha-1';
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

function current(store: JournalStore) {
  const version = store.published;
  if (version === undefined) throw new Error('nothing is published');
  return version;
}

/** The wire id the fact of `rawId` leads to: its `mappedRef` record, read from the store's own file. */
async function wireIdOf(
  store: JournalStore,
  rawId: string,
): Promise<string | undefined> {
  const fact = await (await store.idFacts()).fact(rawId);
  if (fact === undefined || fact.mappedRef === 0) return undefined;
  const access = await accessOf(store);
  const head = await access.readRecordHead(fact.mappedRef, 'VALUE', 1024);
  expect(UTF8_DECODER.decode(head.kindHeader)).toBe(`mapped:${rawId}`);
  const body: unknown = JSON.parse(
    UTF8_DECODER.decode(await readValueBody(access, head)),
  );
  if (typeof body !== 'object' || body === null) {
    throw new Error('a mapped id record is a JSON object');
  }
  const mapped = Object.entries(body).find(
    ([slot]) => slot === String(MISTRAL_SLOT),
  );
  return typeof mapped?.[1] === 'string' ? mapped[1] : undefined;
}

describe('clone with Mistral mapped ids (design 3.3 and 4.8)', () => {
  const directory = useTempDir('journal-clone-mistral-');
  const file = (name: string) => path.join(directory(), name);

  /** A history where the first mapped id is the salt another raw id would take, so the second is salted. */
  function collidingRows() {
    const holder = realMapping(pair(SOURCE_ID)).get(SOURCE_ID) ?? '';
    return {
      rows: [...pair(holder), ...pair(SOURCE_ID)],
      free: holder,
      ids: [holder, SOURCE_ID],
    };
  }

  it('resolves every mapping through the remapped mappedRef to the id the real mapper gives, and keeps the used-set', async () => {
    const { rows, free, ids } = collidingRows();
    const mapping = realMapping(rows);
    expect(mapping.get(SOURCE_ID)).not.toBe(free);
    await writeMistralSource(file('source.llxj'), rows, mapping);

    const source = await openStore(file('source.llxj'));
    const sourceWire = new Map<string, string | undefined>();
    for (const id of ids) sourceWire.set(id, await wireIdOf(source, id));
    expect(sourceWire.get(SOURCE_ID)).toBe(mapping.get(SOURCE_ID));
    const snapshot = await snapshotStore(source, ids);
    const sourceRefs = await Promise.all(
      ids.map(
        async (id) => (await (await source.idFacts()).fact(id))?.mappedRef,
      ),
    );

    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    await source.close();
    await removeFile(file('source.llxj'));

    const clone = await openStore(result.path);
    for (const id of ids) {
      expect(await wireIdOf(clone, id)).toBe(mapping.get(id));
    }
    const cloneRefs = await Promise.all(
      ids.map(
        async (id) => (await (await clone.idFacts()).fact(id))?.mappedRef,
      ),
    );
    expect(cloneRefs).not.toStrictEqual(sourceRefs);
    for (const [id, mapped] of mapping) {
      const usedBy = await (
        await clone.idFacts()
      ).mistralUsedBy(MISTRAL_SLOT, mapped);
      expect(usedBy && hex(usedBy)).toBe(
        hex(copyDeps().hasher(ID_NS.fact, UTF8.encode(id))),
      );
    }
    const cloned = await snapshotStore(clone, ids);
    expect(withoutMappedRefs(cloned.facts)).toStrictEqual(
      withoutMappedRefs(snapshot.facts),
    );
    await clone.close();
  });

  it('points the mapped-id and LENS fields of the new file at records written earlier in it, with the source gone', async () => {
    const { rows } = collidingRows();
    await writeMistralSource(file('source.llxj'), rows, realMapping(rows));
    const source = await openStore(file('source.llxj'));
    const result = await cloneVersion(
      await accessOf(source),
      current(source),
      file('clone.llxj'),
      copyDeps(),
    );
    await source.close();
    await removeFile(file('source.llxj'));
    const clone = await openStore(result.path);
    const audit = new OffsetAudit(await accessOf(clone));
    await audit.walkVersion(current(clone));
    const met = [...audit.checked].map(
      ([entry]) => `${entry.record}.${entry.field}`,
    );
    expect(met).toContain('IdFact.mappedRef');
    expect(met).toContain('RowEntry.lensRef');
    expect(met).toContain('MetaMapEntry.valueRef');
    expect(met).toContain('StateMapEntry.valueRef');
    const lens = [...audit.checked].find(
      ([entry]) => entry.field === 'lensRef',
    );
    expect(lens?.[1]).toBe(1);
    await clone.close();
  });
});

/** The encoded facts with the offset of `mappedRef` taken out: the one field that changes in a clone. */
function withoutMappedRefs(facts: readonly string[]): string[] {
  // `mappedRef` is the last 8 bytes of a fact that has the mapped flag, so 16 hex characters.
  return facts.map((fact) => (fact === 'none' ? fact : fact.slice(0, -16)));
}
