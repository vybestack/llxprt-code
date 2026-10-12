/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomBytes } from 'node:crypto';

/**
 * Stable, small, persisted identity for a history origin (an owner object).
 * Journal rows cannot carry object identity, so each origin object is mapped
 * once to an 8 character random id that is written on the rows it publishes.
 * The map is weak: it holds nothing that grows with context.
 */
const ids = new WeakMap<object, string>();

export function historyOriginId(origin: object): string {
  const existing = ids.get(origin);
  if (existing !== undefined) return existing;
  const id = randomBytes(6).toString('base64url');
  ids.set(origin, id);
  return id;
}

/** Rows without an origin (external producers, pre-origin journals) are unowned. */
export function acceptsHistoryOrigin(
  recorderOrigin: string,
  rowOrigin: string | undefined,
): boolean {
  return rowOrigin === undefined || rowOrigin === recorderOrigin;
}
