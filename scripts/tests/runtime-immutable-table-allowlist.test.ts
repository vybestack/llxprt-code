/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  loadImmutableTableAllowlist,
  parseImmutableTableAllowlist,
} from '../runtime-immutable-table-allowlist.ts';

describe('immutable table allowlist file', () => {
  it('parses entries with file, declaration and reason', () => {
    const entry = { file: 'a.ts', declaration: 'table', reason: 'Fixed.' };
    expect(parseImmutableTableAllowlist(JSON.stringify([entry]))).toEqual([
      entry,
    ]);
  });

  it('rejects non-array content, non-object entries and blank fields', () => {
    expect(() => parseImmutableTableAllowlist('{}')).toThrow('array');
    expect(() => parseImmutableTableAllowlist('[1]')).toThrow('not an object');
    expect(() =>
      parseImmutableTableAllowlist(
        JSON.stringify([{ file: 'a.ts', declaration: 'x', reason: ' ' }]),
      ),
    ).toThrow('nonblank "reason"');
    expect(() =>
      parseImmutableTableAllowlist(JSON.stringify([{ file: 'a.ts' }])),
    ).toThrow('nonblank "declaration"');
  });

  it('loads the committed allowlist with a justification on every entry', () => {
    for (const entry of loadImmutableTableAllowlist())
      expect(entry.reason.trim().length).toBeGreaterThan(0);
  });
});
