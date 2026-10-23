/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  listFixtureEntries,
  parseHandleOwners,
  throwShimCleanupError,
} from './issue-2978-node-shim-helpers.ts';

describe('profile fixture cleanup diagnostics', () => {
  it('retains handle holder metadata without object paths or unrelated output', () => {
    const owners = parseHandleOwners(
      [
        'Sysinternals Handle banner',
        'C:\\private\\bun.exe pid: 1234 type: File  7C: C:\\secret\\fixture',
        'node.exe pid: 5678 type: File  A0: C:\\secret\\fixture\\shim-stdout.log',
        'Access denied: secret diagnostic text',
      ].join('\r\n'),
    );
    expect(owners).toEqual([
      { image: 'bun.exe', pid: 1234, kind: 'File', handle: '7C' },
      { image: 'node.exe', pid: 5678, kind: 'File', handle: 'A0' },
    ]);
    expect(JSON.stringify(owners)).not.toContain('secret');
    expect(JSON.stringify(owners)).not.toContain('private');
  });

  it('does not infer a holder from empty, denied or unrecognized handle output', () => {
    expect(parseHandleOwners('')).toEqual([]);
    expect(
      parseHandleOwners('No matching handles found.\nAccess is denied.'),
    ).toEqual([]);
  });

  it.each(['EACCES', 'EBUSY'])(
    'rethrows the identical cleanup exception for %s with an exhausted diagnostic budget',
    (code) => {
      const original = Object.assign(new Error('cleanup failed'), { code });
      let caught: unknown;
      try {
        throwShimCleanupError(
          original,
          path.join(tmpdir(), 'llxprt-shim-profile-diagnostic'),
          performance.now() - 1,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(original);
    },
  );

  describe('remaining fixture entries', () => {
    let fixture: string;

    afterEach(() => {
      rmSync(fixture, { recursive: true, force: true });
    });

    it('names the survivors of a failed removal, so an empty root is distinguishable from a locked child', () => {
      fixture = mkdtempSync(path.join(tmpdir(), 'llxprt-shim-profile-list-'));
      expect(listFixtureEntries(fixture)).toEqual([]);

      mkdirSync(path.join(fixture, 'bin'));
      writeFileSync(path.join(fixture, 'bin', 'bun.exe'), 'abc');

      expect(
        listFixtureEntries(fixture).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      ).toEqual([
        { name: 'bin', kind: 'directory', size: expect.any(Number) },
        { name: path.join('bin', 'bun.exe'), kind: 'file', size: 3 },
      ]);
    });
  });
});
