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

/** The origin id a journal record's payload carries, if any. */
export function payloadOrigin(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const origin = (payload as { origin?: unknown }).origin;
  return typeof origin === 'string' ? origin : undefined;
}

/**
 * Rows without an origin (external producers, pre-origin journals, and
 * operations that name no owner) are unowned. The rule for them is explicit:
 * an unowned row belongs to every origin, so each recorder mirror carries it
 * and each newly attached mirror is seeded with it. Rows an origin writes are
 * stamped with that origin and reach only its own mirror.
 */
export function acceptsHistoryOrigin(
  recorderOrigin: string,
  rowOrigin: string | undefined,
): boolean {
  return rowOrigin === undefined || rowOrigin === recorderOrigin;
}
