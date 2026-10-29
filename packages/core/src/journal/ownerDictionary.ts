/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { VersionEdit } from './groupEdits.js';
import type { JournalStore } from './journalStore.js';
import { ownerBloomBit } from './ownerRules.js';

/** State map keys of the owner dictionary are `owner:<id>`; `owner:next` is the next id to hand out. */
export const OWNER_KEY_PREFIX = 'owner:';
export const OWNER_NEXT_KEY = 'owner:next';

const FIRST_OWNER_ID = 1;
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export function ownerKey(id: number): string {
  return `${OWNER_KEY_PREFIX}${id}`;
}

/** A new origin and the state edits that record it; commit them in the group of the first row that uses the id. */
export interface OwnerRegistration {
  readonly id: number;
  readonly origin: string;
  readonly edits: readonly VersionEdit[];
}

function setState(key: string, text: string): VersionEdit {
  return { kind: 'setState', key, value: UTF8.encode(text) };
}

/**
 * The owner dictionary of one journal (design 5.1): origin string to a small
 * integer id, kept in the unversioned state map so it survives every pop and
 * restore. Ids are handed out in order and never reused, so a row that
 * survives a pop never names a missing entry. It holds one entry per distinct
 * origin, so it stays small however long the history is.
 */
export class OwnerDictionary {
  private constructor(
    private readonly origins: Map<number, string>,
    private readonly ids: Map<string, number>,
    private next: number,
  ) {}

  /** The dictionary of the published version of `store`. */
  static async load(store: JournalStore): Promise<OwnerDictionary> {
    const stored = await store.getState(OWNER_NEXT_KEY);
    const next =
      stored === undefined
        ? FIRST_OWNER_ID
        : Number.parseInt(UTF8_DECODER.decode(stored), 10);
    if (!Number.isSafeInteger(next) || next < FIRST_OWNER_ID) {
      throw new JournalFormatError(
        `The owner dictionary names ${OWNER_NEXT_KEY} ${String(next)}`,
      );
    }
    const origins = new Map<number, string>();
    const ids = new Map<string, number>();
    for (let id = FIRST_OWNER_ID; id < next; id++) {
      const value = await store.getState(ownerKey(id));
      if (value === undefined) {
        throw new JournalFormatError(`The owner dictionary has no owner ${id}`);
      }
      const origin = UTF8_DECODER.decode(value);
      origins.set(id, origin);
      ids.set(origin, id);
    }
    return new OwnerDictionary(origins, ids, next);
  }

  /** Every owner id with its origin, in id order. */
  entries(): IterableIterator<[number, string]> {
    return this.origins.entries();
  }

  idOf(origin: string): number | undefined {
    return this.ids.get(origin);
  }

  originOf(id: number): string | undefined {
    return this.origins.get(id);
  }

  /** Transfers the sole live owner to its resumed runtime without changing row ids. */
  handoff(origin: string, ownerBloom: bigint): readonly VersionEdit[] {
    if (this.ids.has(origin)) return [];
    const candidates = [...this.origins].filter(
      ([id]) =>
        this.origins.size === 1 || (ownerBloomBit(id) & ownerBloom) !== 0n,
    );
    // A bloom collision cannot authorize a handoff between different owners.
    const selected = candidates.length === 1 ? candidates[0] : undefined;
    if (selected === undefined) return [];
    const [id, previous] = selected;
    this.ids.delete(previous);
    this.ids.set(origin, id);
    this.origins.set(id, origin);
    return [setState(ownerKey(id), origin)];
  }

  /** The registration of `origin`: a new id when it has none, and then the edits that record it. */
  prepare(origin: string): OwnerRegistration {
    const known = this.ids.get(origin);
    if (known !== undefined) return { id: known, origin, edits: [] };
    return {
      id: this.next,
      origin,
      edits: [
        setState(ownerKey(this.next), origin),
        setState(OWNER_NEXT_KEY, String(this.next + 1)),
      ],
    };
  }

  /** Takes a registration into account once the group that holds its edits is acked. */
  confirm(registration: OwnerRegistration): void {
    if (registration.edits.length === 0) return;
    if (registration.id !== this.next) {
      throw new JournalFormatError(
        `Owner ${registration.id} is not the next owner id, ${this.next}`,
      );
    }
    this.origins.set(registration.id, registration.origin);
    this.ids.set(registration.origin, registration.id);
    this.next += 1;
  }

  /** The state edits that give another journal this whole dictionary: a mirror seed, a clone. */
  stateEdits(): VersionEdit[] {
    if (this.next === FIRST_OWNER_ID) return [];
    const edits = [...this.origins].map(([id, origin]) =>
      setState(ownerKey(id), origin),
    );
    edits.push(setState(OWNER_NEXT_KEY, String(this.next)));
    return edits;
  }
}
