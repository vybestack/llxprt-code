/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';

export function observeRowOwnership(ownership: RowOwnership): {
  bytes(): number;
  rows(): number;
  close(): void;
} {
  const held = new Map<object, { references: number; bytes: number }>();
  const retain = ownership.retain;
  const release = ownership.release;
  ownership.retain = (row) => {
    retain.call(ownership, row);
    const entry = held.get(row);
    if (entry === undefined)
      held.set(row, {
        references: 1,
        bytes: Buffer.byteLength(JSON.stringify(row)),
      });
    else entry.references++;
  };
  ownership.release = (row) => {
    release.call(ownership, row);
    const entry = held.get(row);
    if (entry === undefined) throw new Error('Unobserved row release');
    entry.references--;
    if (entry.references === 0) held.delete(row);
  };
  return {
    bytes: () =>
      [...held.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    rows: () => held.size,
    close: () => {
      ownership.retain = retain;
      ownership.release = release;
      if (held.size !== 0) throw new Error('Observed rows were not released');
    },
  };
}
