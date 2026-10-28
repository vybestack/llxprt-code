/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { denyDeletion, denyEntryCreation } from './filesystem-denial.js';

// Root bypasses directory mode bits, so a POSIX denial cannot hold there.
const canDeny = process.getuid?.() !== 0;

describe('filesystem denial fixtures', () => {
  describe.skipIf(!canDeny)('on POSIX as a non-root user', () => {
    let root = '';
    beforeEach(() => {
      root = mkdtempSync(path.join(tmpdir(), 'fs-denial-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    it('refuses to delete the file until the denial is lifted', () => {
      const file = path.join(root, 'secret.env');
      writeFileSync(file, 'token');

      const restore = denyDeletion(file, root);
      try {
        expect(() => unlinkSync(file)).toThrow(/EACCES|EPERM/);
        expect(existsSync(file)).toBe(true);
      } finally {
        restore();
      }

      unlinkSync(file);
      expect(existsSync(file)).toBe(false);
    });

    it('refuses to create files and directories until the denial is lifted', () => {
      const restore = denyEntryCreation(root);
      try {
        expect(() => writeFileSync(path.join(root, 'new.txt'), '')).toThrow(
          /EACCES|EPERM/,
        );
        expect(() => mkdirSync(path.join(root, 'new-dir'))).toThrow(
          /EACCES|EPERM/,
        );
      } finally {
        restore();
      }

      writeFileSync(path.join(root, 'new.txt'), '');
      expect(existsSync(path.join(root, 'new.txt'))).toBe(true);
    });
  });
});
