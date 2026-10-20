/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { OwnerDictionary } from '../../journal/ownerDictionary.js';
import { UNOWNED_ROW } from './journalRowCodec.js';

/** The owner id of an origin and the state edits that must go in the group of the first row using it. */
export interface ResolvedOwner {
  readonly id: number;
  readonly edits: readonly VersionEdit[];
}

/**
 * Maps the origins callers name to the owner ids of the journal (design 5.1,
 * decision G10: callers keep naming origins). An origin without an id gets the
 * next one, and the edits recording it are returned once, for the group the
 * caller is building. Groups are built one at a time, so the dictionary may
 * take the new id at once; a step that fails calls {@link invalidate}, which
 * drops it and reloads the published dictionary on the next use.
 */
export class JournalOwners {
  private dictionary: Promise<OwnerDictionary> | undefined;

  constructor(private readonly store: JournalStore) {}

  /** Undefined is unowned (id 0). */
  async resolve(origin: string | undefined): Promise<ResolvedOwner> {
    if (origin === undefined) return { id: UNOWNED_ROW, edits: [] };
    this.dictionary ??= OwnerDictionary.load(this.store);
    const dictionary = await this.dictionary;
    const registration = dictionary.prepare(origin);
    dictionary.confirm(registration);
    return { id: registration.id, edits: registration.edits };
  }

  /** The origin of a published owner id, or undefined for id 0 and unknown ids. */
  async originOf(id: number): Promise<string | undefined> {
    this.dictionary ??= OwnerDictionary.load(this.store);
    return (await this.dictionary).originOf(id);
  }

  async hasOnly(origin: string | undefined): Promise<boolean> {
    this.dictionary ??= OwnerDictionary.load(this.store);
    for (const [, registered] of (await this.dictionary).entries()) {
      if (registered !== origin) return false;
    }
    return true;
  }

  invalidate(): void {
    this.dictionary = undefined;
  }
}
