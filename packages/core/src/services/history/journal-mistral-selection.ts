/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { JournalFormatError } from '../../journal/errors.js';
import type { JournalStore } from '../../journal/journalStore.js';
import {
  requireMistralScope,
  scopedMistralMapping,
} from '../../journal/mistralScope.js';
import type { MistralMapping } from '../../journal/mistralMapping.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { assertRowIndex } from './provider-request-snapshot.js';
import type { MistralUnitIds } from './journal-mistral-ids.js';

function usedInPhase(
  row: MistralUnitIds,
  id: MistralUnitIds['ids'][number],
  observe: boolean,
): boolean {
  if (observe) return id.kind === 'call' && id.rawId !== '';
  return row.speaker === 'ai'
    ? id.kind === 'call'
    : row.speaker === 'tool' && id.kind === 'response';
}

async function* selectedIds(
  request: IndexedJournalRequestSnapshot,
  indices: readonly number[],
  observe: boolean,
): AsyncGenerator<string> {
  for (const index of indices) {
    const row = await request.mistralIdsAt(index);
    for (const id of row.ids) if (usedInPhase(row, id, observe)) yield id.rawId;
  }
}

export class JournalMistralSelection {
  private constructor(
    private readonly request: IndexedJournalRequestSnapshot,
    private readonly pin: VersionSnapshot,
    private readonly indices: readonly number[],
    private readonly scope: string,
    private readonly slot: number,
  ) {}

  static async create(
    request: IndexedJournalRequestSnapshot,
    store: JournalStore,
    identity: string,
    slot: number,
    selection: readonly number[],
  ): Promise<JournalMistralSelection> {
    const indices = [...selection];
    let previous = -1;
    for (const index of indices) {
      assertRowIndex(index, request.count);
      if (index <= previous)
        throw new RangeError('Mistral selection indices must be increasing');
      previous = index;
    }
    const hash = createHash('sha256')
      .update('mistral-conversion-scope-v1')
      .update(identity);
    for (const index of indices) hash.update(`:${index}`);
    const scope = hash.digest('hex');
    const current = await store.snapshot();
    let ready: boolean;
    try {
      ready = await requireMistralScope(current.facts, scope, slot);
    } finally {
      await current.close();
    }
    if (!ready) {
      await store.commit([
        {
          kind: 'mistralScope',
          scope,
          slot,
          observe: () => selectedIds(request, indices, true),
          convert: () => selectedIds(request, indices, false),
        },
      ]);
    }
    const pin = await store.snapshot();
    try {
      if (!(await requireMistralScope(pin.facts, scope, slot)))
        throw new JournalFormatError('Mistral conversion scope needs a fill');
      return new JournalMistralSelection(request, pin, indices, scope, slot);
    } catch (error) {
      await pin.close();
      throw error;
    }
  }

  async mapping(rawId: string): Promise<MistralMapping | undefined> {
    this.pin.requireOpen();
    return scopedMistralMapping(this.pin.facts, this.scope, this.slot, rawId);
  }

  async resolve(rawId: string): Promise<MistralMapping> {
    const mapping = await this.mapping(rawId);
    if (mapping === undefined)
      throw new JournalFormatError(
        'Id is not in the selected Mistral conversion scope',
      );
    return mapping;
  }

  async *openReader(): AsyncGenerator<IContent> {
    this.pin.requireOpen();
    for (const index of this.indices) {
      this.pin.requireOpen();
      yield await this.request.readAt(index);
    }
  }

  close(): void | Promise<void> {
    return this.pin.close();
  }
}
