/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { join, delimiter as pathDelimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { findInPath } from './ripgrepPathResolver.js';

function makeTempDirs(count: number): { dirs: string[]; cleanup: () => void } {
  const base = join(
    tmpdir(),
    `rg-path-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const dirs: string[] = [];
  for (let i = 0; i < count; i++) {
    const dir = join(base, `d${i}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
  }
  return {
    dirs,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

describe('findInPath executability semantics', () => {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;
  const isWindows = process.platform === 'win32';

  beforeEach(() => {
    process.env.PATHEXT = '';
  });

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalPathExt === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathExt;
    }
  });

  describe.skipIf(isWindows)('POSIX executable candidates', () => {
    it('ignores a non-executable candidate named rg', () => {
      const { dirs, cleanup } = makeTempDirs(1);
      try {
        const candidate = join(dirs[0], 'rg');
        writeFileSync(candidate, '#!/bin/sh\necho fake\n');
        chmodSync(candidate, 0o644);
        process.env.PATH = dirs[0];
        expect(findInPath('rg', false)).toBeNull();
      } finally {
        cleanup();
      }
    });
  });

  describe.skipIf(isWindows)('POSIX executable selection', () => {
    it('selects an executable candidate named rg', () => {
      const { dirs, cleanup } = makeTempDirs(1);
      try {
        const candidate = join(dirs[0], 'rg');
        writeFileSync(candidate, '#!/bin/sh\necho real\n');
        chmodSync(candidate, 0o755);
        process.env.PATH = dirs[0];
        expect(findInPath('rg', false)).toBe(candidate);
      } finally {
        cleanup();
      }
    });
  });

  describe.skipIf(isWindows)('POSIX PATH fallback', () => {
    it('falls back to a later PATH entry when the first is non-executable', () => {
      const { dirs, cleanup } = makeTempDirs(2);
      try {
        const nonExec = join(dirs[0], 'rg');
        writeFileSync(nonExec, '#!/bin/sh\necho blocked\n');
        chmodSync(nonExec, 0o644);

        const exec = join(dirs[1], 'rg');
        writeFileSync(exec, '#!/bin/sh\necho unblocked\n');
        chmodSync(exec, 0o755);

        process.env.PATH = `${dirs[0]}:${dirs[1]}`;
        expect(findInPath('rg', false)).toBe(exec);
      } finally {
        cleanup();
      }
    });
  });
});

describe('findInPath Windows extension resolution', () => {
  const originalPath = process.env.PATH;
  const originalPathExt = process.env.PATHEXT;

  afterEach(() => {
    process.env.PATH = originalPath;
    if (originalPathExt === undefined) {
      delete process.env.PATHEXT;
    } else {
      process.env.PATHEXT = originalPathExt;
    }
  });

  it('finds rg.EXE with normal PATHEXT when isWindows is true', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg.EXE');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(
        pathDelimiter,
      );
      expect(findInPath('rg', true)).toBe(candidate);
    } finally {
      cleanup();
    }
  });

  it('rg.EXE shadows bare rg when both exist with PATHEXT (isWindows=true)', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const exeCandidate = join(dirs[0], 'rg.EXE');
      const bareCandidate = join(dirs[0], 'rg');
      writeFileSync(exeCandidate, 'real');
      writeFileSync(bareCandidate, 'wrong');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(
        pathDelimiter,
      );
      expect(findInPath('rg', true)).toBe(exeCandidate);
    } finally {
      cleanup();
    }
  });

  it('bare rg found as last-resort fallback when PATHEXT is set but no extension matches', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(
        pathDelimiter,
      );
      expect(findInPath('rg', true)).toBe(candidate);
    } finally {
      cleanup();
    }
  });

  it('finds rg.EXE when PATHEXT is absent (fallback .EXE)', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg.EXE');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      delete process.env.PATHEXT;
      expect(findInPath('rg', true)).toBe(candidate);
    } finally {
      cleanup();
    }
  });

  it('returns null when PATHEXT is empty and only bare rg exists (no .EXE fallback match)', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = '';
      expect(findInPath('rg', true)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('PATHEXT order: .COM checked before .EXE', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const comCandidate = join(dirs[0], 'rg.COM');
      const exeCandidate = join(dirs[0], 'rg.EXE');
      writeFileSync(comCandidate, 'first');
      writeFileSync(exeCandidate, 'second');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(
        pathDelimiter,
      );
      expect(findInPath('rg', true)).toBe(comCandidate);
    } finally {
      cleanup();
    }
  });

  it('missing PATHEXT on Windows: only .EXE checked, bare rg not found', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const bareCandidate = join(dirs[0], 'rg');
      writeFileSync(bareCandidate, 'fake');
      process.env.PATH = dirs[0];
      delete process.env.PATHEXT;
      expect(findInPath('rg', true)).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('case/duplicate normalization: deduplicates and uses first-seen extension', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg.exe');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.exe', '.EXE', '.Exe'].join(pathDelimiter);
      const result = findInPath('rg', true);
      expect(result).toBe(candidate);
    } finally {
      cleanup();
    }
  });

  it('does not produce rg.exe.EXE double extension', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const correctCandidate = join(dirs[0], 'rg.EXE');
      const wrongCandidate = join(dirs[0], 'rg.exe.EXE');
      writeFileSync(correctCandidate, 'real');
      writeFileSync(wrongCandidate, 'wrong');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.COM', '.EXE', '.BAT', '.CMD'].join(
        pathDelimiter,
      );
      expect(findInPath('rg', true)).toBe(correctCandidate);
    } finally {
      cleanup();
    }
  });

  it('deduplicates case-insensitive PATHEXT entries', () => {
    const { dirs, cleanup } = makeTempDirs(1);
    try {
      const candidate = join(dirs[0], 'rg.EXE');
      writeFileSync(candidate, 'fake');
      process.env.PATH = dirs[0];
      process.env.PATHEXT = ['.EXE', '.exe', '.EXE'].join(pathDelimiter);
      const result = findInPath('rg', true);
      expect(result).toBe(candidate);
    } finally {
      cleanup();
    }
  });
});
