/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { resolveBwrapExecutable } from './sandbox-bwrap-executable.js';

const scratch: string[] = [];

function binDirectory(executable: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-exe-'));
  scratch.push(dir);
  const file = path.join(dir, 'bwrap');
  fs.writeFileSync(file, '#!/bin/sh\n');
  fs.chmodSync(file, executable ? 0o755 : 0o644);
  return dir;
}

function removeScratchDirectories(): void {
  for (const dir of scratch.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('bwrap executable lookup', () => {
  afterEach(removeScratchDirectories);

  it.skipIf(process.platform === 'win32')(
    'returns the absolute path of the first executable bwrap on the search path',
    () => {
      const first = binDirectory(true);
      const second = binDirectory(true);

      expect(resolveBwrapExecutable([first, second].join(path.delimiter))).toBe(
        path.join(first, 'bwrap'),
      );
    },
  );

  it.skipIf(process.platform === 'win32')(
    'skips a file that is not executable and entries that are not absolute',
    () => {
      const plain = binDirectory(false);
      const real = binDirectory(true);

      expect(
        resolveBwrapExecutable(['bin', plain, real].join(path.delimiter)),
      ).toBe(path.join(real, 'bwrap'));
    },
  );

  it('returns undefined when no entry holds bwrap', () => {
    expect(resolveBwrapExecutable('')).toBeUndefined();
  });
});
