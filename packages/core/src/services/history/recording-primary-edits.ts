/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionEdit } from '../../journal/groupEdits.js';
import {
  OWNER_KEY_PREFIX,
  OWNER_NEXT_KEY,
} from '../../journal/ownerDictionary.js';

function accepts(owner: number, id: number | 'inherit'): boolean {
  return id === 'inherit' || id === 0 || id === owner;
}

function acceptsState(
  key: string,
  value: Uint8Array,
  origin: string | undefined,
): boolean {
  return (
    !key.startsWith(OWNER_KEY_PREFIX) ||
    key === OWNER_NEXT_KEY ||
    new TextDecoder().decode(value) === origin
  );
}

function isStructuralFill(
  edit: VersionEdit,
): edit is Extract<
  VersionEdit,
  { kind: 'chronology' | 'densityCalls' | 'recency' }
> {
  return (
    edit.kind === 'chronology' ||
    edit.kind === 'densityCalls' ||
    edit.kind === 'recency'
  );
}

export function recordingAcceptsEdits(
  edits: readonly VersionEdit[],
  owner: number,
  origin: string | undefined,
  streams: boolean,
): boolean {
  return edits.every((edit) => {
    if (isStructuralFill(edit)) return true;
    switch (edit.kind) {
      case 'append':
        return edit.rows.every((row) => accepts(owner, row.owner));
      case 'compress':
        return accepts(owner, edit.summary.owner);
      case 'density':
        return edit.replacements.every((row) =>
          accepts(owner, row.draft.owner),
        );
      case 'purge':
        return edit.rows.every((row) => accepts(owner, row.draft.owner));
      case 'insert':
        return accepts(owner, edit.draft.owner);
      case 'owner':
        return edit.changes.every((change) => accepts(owner, change.owner));
      case 'adopt':
        return edit.rows.every((row) => accepts(owner, row.entry.owner));
      case 'replace':
      case 'adoptAll':
        return streams;
      case 'setState':
        return acceptsState(edit.key, edit.value, origin);
      case 'restore':
      case 'pop':
      case 'clear':
      case 'trimHead':
      case 'fill':
      case 'format':
      case 'factIndex':
      case 'kimi':
      case 'mistral':
      case 'mistralScope':
      case 'checkpoint':
      case 'deleteCheckpoint':
        return true;
      default: {
        const unmapped: never = edit;
        throw new Error(
          `Unmapped recording-primary edit ${JSON.stringify(unmapped)}`,
        );
      }
    }
  });
}

async function* checkedRows<T>(
  rows: Iterable<T> | AsyncIterable<T>,
  owner: number,
  ownerOf: (row: T) => number,
): AsyncGenerator<T> {
  for await (const row of rows) {
    if (!accepts(owner, ownerOf(row))) {
      throw new Error(
        'A single-owner journal stream introduced an unregistered foreign owner',
      );
    }
    yield row;
  }
}

export function checkedRecordingEdits(
  edits: readonly VersionEdit[],
  owner: number,
): readonly VersionEdit[] {
  return edits.map((edit): VersionEdit => {
    if (edit.kind === 'replace') {
      return {
        ...edit,
        rows: checkedRows(edit.rows, owner, (row) => row.owner),
      };
    }
    if (edit.kind === 'adoptAll') {
      return {
        ...edit,
        rows: checkedRows(edit.rows, owner, (row) => row.entry.owner),
      };
    }
    return edit;
  });
}
