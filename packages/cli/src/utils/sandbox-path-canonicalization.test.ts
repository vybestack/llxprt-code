/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  canonicalizeExistingPath,
  canonicalizeNearestExistingPath,
  hasFilesystemErrorCode,
  type SandboxPathFilesystem,
} from './sandbox-path-canonicalization.js';

/**
 * Builds a bounded filesystem seam that reproduces the #3475 race
 * deterministically: `vanishedPath` still answers "exists" at discovery,
 * but real-path resolution fails exactly as it would after a concurrent
 * removal (`ENOENT`) or replacement with a symlink cycle (`ELOOP`).
 * Every other path delegates to the real filesystem.
 */
function filesystemWhereDiscoveredPathFails(
  vanishedPath: string,
  code: 'ENOENT' | 'ELOOP',
): SandboxPathFilesystem {
  return {
    existsSync: (targetPath) =>
      targetPath === vanishedPath || fs.existsSync(targetPath),
    realpathSync: (targetPath) => {
      if (targetPath !== vanishedPath) return fs.realpathSync(targetPath);
      throw Object.assign(
        new Error(
          `${code}: no such file or directory, realpathSync '${vanishedPath}'`,
        ),
        { code },
      );
    },
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3475-canon-'));
}

describe('#3475 canonicalizeExistingPath', () => {
  it('resolves a real path through symlinks to its real target', () => {
    const root = makeTempDir();
    try {
      const realDir = path.join(root, 'real');
      fs.mkdirSync(realDir);
      const link = path.join(root, 'link');
      fs.symlinkSync(realDir, link);
      expect(canonicalizeExistingPath(link, 'resolve the test path')).toBe(
        fs.realpathSync(realDir),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails with a classified error naming the path and operation when resolution fails after the path was seen', () => {
    const root = makeTempDir();
    try {
      const raced = path.join(root, 'raced');
      let thrown: unknown;
      try {
        canonicalizeExistingPath(
          raced,
          'resolve the sandbox workspace root',
          filesystemWhereDiscoveredPathFails(raced, 'ENOENT'),
        );
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(raced);
      expect(thrown.message).toContain('resolve the sandbox workspace root');
      expect(thrown.message).toContain('ENOENT');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlink cycle with a classified error naming the path and operation', () => {
    const root = makeTempDir();
    try {
      const cyclic = path.join(root, 'cycle');
      fs.symlinkSync(cyclic, cyclic);
      let thrown: unknown;
      try {
        canonicalizeExistingPath(cyclic, 'resolve the sandbox executable');
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(cyclic);
      expect(thrown.message).toContain('resolve the sandbox executable');
      expect(thrown.message).toContain('ELOOP');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a malformed path with a classified error naming the path and operation', () => {
    const malformed = `${makeTempDir()}/bad\u0000path`;
    let thrown: unknown;
    try {
      canonicalizeExistingPath(
        malformed,
        'resolve the sandbox temporary directory',
      );
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain('resolve the sandbox temporary directory');
    expect(thrown.message).toContain('without null bytes');
  });

  it('records the filesystem cause so callers can inspect errno codes', () => {
    const root = makeTempDir();
    try {
      const raced = path.join(root, 'raced');
      const filesystem = filesystemWhereDiscoveredPathFails(raced, 'ELOOP');
      let thrown: unknown;
      try {
        canonicalizeExistingPath(
          raced,
          'resolve the sandbox mount source',
          filesystem,
        );
      } catch (error) {
        thrown = error;
      }
      expect(hasFilesystemErrorCode(thrown, 'ELOOP')).toBe(true);
      expect(hasFilesystemErrorCode(thrown, 'ENOENT')).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('#3475 canonicalizeNearestExistingPath', () => {
  it('canonicalizes the nearest existing ancestor and appends the missing tail', () => {
    const root = makeTempDir();
    try {
      const existing = path.join(root, 'existing');
      fs.mkdirSync(existing);
      const candidate = path.join(existing, 'not', 'yet', 'node_modules');
      expect(
        canonicalizeNearestExistingPath(
          candidate,
          'resolve the protected sandbox dependency destination',
        ),
      ).toBe(
        path.join(fs.realpathSync(existing), 'not', 'yet', 'node_modules'),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails with a classified error naming the discovered path when it is removed between discovery and resolution', () => {
    const root = makeTempDir();
    try {
      const raced = path.join(root, 'node_modules');
      let thrown: unknown;
      try {
        canonicalizeNearestExistingPath(
          path.join(raced, 'pkg', 'bin'),
          'resolve the protected sandbox dependency destination',
          filesystemWhereDiscoveredPathFails(raced, 'ENOENT'),
        );
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(raced);
      expect(thrown.message).toContain(
        'resolve the protected sandbox dependency destination',
      );
      expect(thrown.message).toContain('ENOENT');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails with a classified error when the discovered path is replaced by a symlink cycle before resolution', () => {
    const root = makeTempDir();
    try {
      const raced = path.join(root, 'linked-workspace');
      let thrown: unknown;
      try {
        canonicalizeNearestExistingPath(
          path.join(raced, 'package.json'),
          'resolve the sandbox workspace root',
          filesystemWhereDiscoveredPathFails(raced, 'ELOOP'),
        );
      } catch (error) {
        thrown = error;
      }
      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(raced);
      expect(thrown.message).toContain('resolve the sandbox workspace root');
      expect(thrown.message).toContain('ELOOP');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves a fully missing candidate under an existing root without an error', () => {
    const root = makeTempDir();
    try {
      const candidate = path.join(root, 'a', 'b', 'c');
      expect(
        canonicalizeNearestExistingPath(candidate, 'resolve the test path'),
      ).toBe(path.join(fs.realpathSync(root), 'a', 'b', 'c'));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('#3475 hasFilesystemErrorCode', () => {
  it('matches the code on the error itself and on its recorded cause', () => {
    const direct = Object.assign(new Error('direct'), { code: 'EACCES' });
    expect(hasFilesystemErrorCode(direct, 'EACCES')).toBe(true);
    const wrapped = new FatalSandboxError('wrapped');
    wrapped.cause = Object.assign(new Error('cause'), { code: 'EACCES' });
    expect(hasFilesystemErrorCode(wrapped, 'EACCES')).toBe(true);
    expect(hasFilesystemErrorCode(wrapped, 'ENOENT')).toBe(false);
    expect(hasFilesystemErrorCode('not an error', 'ENOENT')).toBe(false);
  });
});
