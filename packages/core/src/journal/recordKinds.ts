/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/** Record kinds of design section 2.3. */
export const RECORD_KIND = {
  ROW: 0x01,
  RTNODE: 0x02,
  ITNODE: 0x03,
  LENS: 0x04,
  VALUE: 0x05,
  EVENT: 0x06,
  TNODE: 0x08,
  TRAILER: 0x7f,
} as const;

export type RecordKind = (typeof RECORD_KIND)[keyof typeof RECORD_KIND];

const KNOWN_KINDS: ReadonlySet<number> = new Set(Object.values(RECORD_KIND));

export function isRecordKind(code: number): code is RecordKind {
  return KNOWN_KINDS.has(code);
}

/**
 * What a commit group did, named by the trailer (design 2.5). The design lists
 * the names and not their numbers; they are numbered from 1 in the order the
 * design lists them, and 0 stays invalid.
 */
export const MUTATION = {
  append: 1,
  pop: 2,
  compress: 3,
  replace: 4,
  density: 5,
  purge: 6,
  clear: 7,
  insert: 8,
  owner: 9,
  fill: 10,
  state: 11,
  clone: 12,
  restore: 13,
} as const;

export type MutationCode = (typeof MUTATION)[keyof typeof MUTATION];

const KNOWN_MUTATIONS: ReadonlySet<number> = new Set(Object.values(MUTATION));

export function isMutationCode(code: number): code is MutationCode {
  return KNOWN_MUTATIONS.has(code);
}
