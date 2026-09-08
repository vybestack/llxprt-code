/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral self-tests for the recursive filtered-copy primitives in
 * legacyCopyEngine. Real temp directories and real filesystem operations —
 * no mocking of the module under test. These lock in the legacy-path guard
 * semantics: existing canonical entries are never overwritten (COPYFILE_EXCL),
 * and symlink cycles are detected so recursion terminates.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DebugLogger } from '@vybestack/llxprt-code-core';

import {
  copyDirFiltered,
  copyDirFilteredWithInterceptor,
} from './legacyCopyEngine.js';

const logger = new DebugLogger('legacy-copy-engine-test');

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-copy-engine-test-'));
}

describe('copyDirFiltered', () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = makeTempDir();
    dest = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('copies a nested directory tree so all files exist at the destination', () => {
    // Build a source tree: src/a.txt and src/sub/b.txt
    fs.mkdirSync(path.join(src, 'sub'));
    fs.writeFileSync(path.join(src, 'a.txt'), 'alpha');
    fs.writeFileSync(path.join(src, 'sub', 'b.txt'), 'beta');

    const errors: string[] = [];
    const count = copyDirFiltered(
      src,
      dest,
      src,
      dest,
      new Set<string>(),
      errors,
      logger,
    );

    // Two files copied.
    expect(count).toBe(2);
    expect(errors).toHaveLength(0);
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('alpha');
    expect(fs.readFileSync(path.join(dest, 'sub', 'b.txt'), 'utf8')).toBe(
      'beta',
    );
  });

  it('does not overwrite an existing destination file (COPYFILE_EXCL)', () => {
    fs.writeFileSync(path.join(src, 'a.txt'), 'source-content');
    // Pre-create the canonical destination with different content.
    fs.writeFileSync(path.join(dest, 'a.txt'), 'canonical-wins');

    const errors: string[] = [];
    copyDirFiltered(src, dest, src, dest, new Set<string>(), errors, logger);

    // The existing canonical content must be preserved.
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe(
      'canonical-wins',
    );
  });

  describe.skipIf(process.platform === 'win32')(
    'on non-Windows systems',
    () => {
      it('clones a directory symlink without following it into a cycle', () => {
        // Build a directory that contains a symlink pointing at an ancestor.
        fs.mkdirSync(path.join(src, 'loop'));
        fs.symlinkSync(src, path.join(src, 'loop', 'back-to-root'));

        const errors: string[] = [];
        // Directory symlinks return isDirectory() === false from readdir
        // Dirent, so copyDirFiltered clones the symlink entry rather than
        // recursing into it. The function must return promptly without
        // infinite recursion.
        const count = copyDirFiltered(
          src,
          dest,
          src,
          dest,
          new Set<string>(),
          errors,
          logger,
        );

        // The symlink entry is cloned (counted), but its target directory
        // is not followed — so recursion terminates without infinite looping.
        expect(count).toBe(1);
        expect(errors).toHaveLength(0);
        // The symlink was created at the destination.
        expect(
          fs
            .lstatSync(path.join(dest, 'loop', 'back-to-root'))
            .isSymbolicLink(),
        ).toBe(true);
      });
    },
  );
});

describe('copyDirFilteredWithInterceptor', () => {
  let src: string;
  let dest: string;

  beforeEach(() => {
    src = makeTempDir();
    dest = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('invokes the file interceptor for each regular file and copies its content', () => {
    fs.mkdirSync(path.join(src, 'nested'));
    fs.writeFileSync(path.join(src, 'one.txt'), '1');
    fs.writeFileSync(path.join(src, 'nested', 'two.txt'), '2');

    const seen: Array<{ srcPath: string; destPath: string }> = [];
    const errors: string[] = [];
    // The interceptor writes the destination file itself (mirroring how the
    // profiles normalization publishes normalized content).
    const count = copyDirFilteredWithInterceptor(
      src,
      dest,
      src,
      dest,
      new Set<string>(),
      errors,
      (srcPath, destPath) => {
        seen.push({ srcPath, destPath });
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_EXCL);
        return 1;
      },
      logger,
    );

    expect(count).toBe(2);
    expect(seen).toHaveLength(2);
    // Both files were written through the interceptor.
    expect(fs.readFileSync(path.join(dest, 'one.txt'), 'utf8')).toBe('1');
    expect(fs.readFileSync(path.join(dest, 'nested', 'two.txt'), 'utf8')).toBe(
      '2',
    );
  });

  it('skips a regular file whose destination already exists (excluded-entry handling)', () => {
    fs.writeFileSync(path.join(src, 'exists.txt'), 'from-source');
    // Pre-existing destination must NOT be overwritten.
    fs.writeFileSync(path.join(dest, 'exists.txt'), 'already-here');

    const seen: Array<{ srcPath: string; destPath: string }> = [];
    const errors: string[] = [];
    copyDirFilteredWithInterceptor(
      src,
      dest,
      src,
      dest,
      new Set<string>(),
      errors,
      (srcPath, destPath) => {
        seen.push({ srcPath, destPath });
        return 0;
      },
      logger,
    );

    // The interceptor is NOT called for the pre-existing destination file.
    expect(seen).toHaveLength(0);
    expect(fs.readFileSync(path.join(dest, 'exists.txt'), 'utf8')).toBe(
      'already-here',
    );
  });
});
