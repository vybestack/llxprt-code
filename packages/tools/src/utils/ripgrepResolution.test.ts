/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for ripgrep resolution (issue #3278).
 *
 * The suite this replaces lived in packages/core and mocked
 * `child_process.execSync`, a code path the resolver stopped using when the
 * `which rg` lookup became `findInPath()`. Because `findInPath` walks
 * `process.env.PATH` with `statSync`/`accessSync`, the old mocks let the test
 * escape to the developer's real PATH: it passed only where ripgrep was NOT
 * installed, which is exactly the CI runner and no developer machine.
 *
 * Every case here therefore points `process.env.PATH` at a temp directory that
 * either does or does not contain a real executable named `rg`. The only
 * simulated filesystem answers are the hardcoded absolute fallback probes
 * (`/usr/local/bin/rg`, `C:\Program Files\ripgrep\rg.exe`, ...), which cannot
 * be relocated into a temp directory; `mockHardcodedProbes` answers exactly
 * those paths and delegates every other `existsSync` call to the real
 * filesystem.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearRipgrepAvailabilityCache,
  ensureWindowsShortcut,
  getRipgrepPath,
  isRipgrepAvailable,
} from './ripgrepPathResolver.js';

/**
 * Points `@lvce-editor/ripgrep` at a chosen path. Bun evaluates a
 * `mock.module` factory once at registration and snapshots the namespace, so
 * the mock is re-registered per test rather than read from a mutable variable.
 *
 * A path that does not exist stands in for "the package is not installed":
 * `tryPackagedRipgrep` returns null for a missing binary and for a failed
 * import alike, so the two are indistinguishable to every caller.
 */
function usePackagedRipgrep(rgPath: string): void {
  void mock.module('@lvce-editor/ripgrep', () => ({ rgPath }));
}

/**
 * The real packaged path, captured before the first mock registration. Bun has
 * no way to unregister a module mock, so the closest available cleanup is to
 * re-register the real value; without it this file would leave the package
 * pointing at a deleted temp path for every later file in the same process.
 */
const realPackagedRgPath: string | null = await import('@lvce-editor/ripgrep')
  .then((packaged) => packaged.rgPath)
  .catch(() => null);

/** Shape of the field a pkg-bundled build sets on `process`. */
interface ProcessWithPkg {
  pkg?: { entrypoint?: string };
}

function usePkgEntrypoint(entrypoint: string): void {
  (process as unknown as ProcessWithPkg).pkg = { entrypoint };
}

/** Absolute candidates the resolver probes with `existsSync`. */
const UNIX_FALLBACK_PATHS = [
  '/usr/local/bin/rg',
  '/usr/bin/rg',
  '/opt/homebrew/bin/rg',
  '/home/linuxbrew/.linuxbrew/bin/rg',
] as const;

const WINDOWS_FALLBACK_PATHS = [
  'C:\\Program Files\\ripgrep\\rg.exe',
  'C:\\Program Files (x86)\\ripgrep\\rg.exe',
  'C:\\tools\\ripgrep\\rg.exe',
] as const;

const HARDCODED_PROBES: ReadonlySet<string> = new Set<string>([
  ...UNIX_FALLBACK_PATHS,
  ...WINDOWS_FALLBACK_PATHS,
]);

const ELF_HEADER = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const SHELL_SCRIPT = '#!/bin/sh\necho fake rg\n';

const ORIGINAL_PATH = process.env.PATH;
const ORIGINAL_PATHEXT = process.env.PATHEXT;
const ORIGINAL_CWD = process.cwd();

let tempRoot: string;

function makeDir(...segments: string[]): string {
  const target = path.join(tempRoot, ...segments);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function writeExecutable(target: string, contents: Buffer | string): string {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  fs.chmodSync(target, 0o755);
  return target;
}

/** Points PATH at a single directory, so PATH lookups are fully controlled. */
function usePath(directory: string): void {
  process.env.PATH = directory;
}

/**
 * Installs an `rg` a real (unmocked) platform will find on PATH, and returns
 * the path the resolver is expected to pick. With PATHEXT cleared, a Windows
 * resolver probes `rg.EXE` only and never the bare name, so a Windows host
 * needs the extension form. Cases that mock the platform to darwin create the
 * bare name directly instead.
 */
function installSystemRg(directory: string): string {
  const bare = writeExecutable(path.join(directory, 'rg'), SHELL_SCRIPT);
  if (process.platform !== 'win32') {
    return bare;
  }
  return writeExecutable(path.join(directory, 'rg.EXE'), SHELL_SCRIPT);
}

/**
 * Answers the resolver's hardcoded absolute probes, and only those. Every other
 * `existsSync` question (bundle directory, node_modules, packaged binary) still
 * hits the real filesystem.
 */
function mockHardcodedProbes(existing: readonly string[]): void {
  const present = new Set(existing);
  const realExistsSync = fs.existsSync.bind(fs);
  vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
    if (typeof candidate === 'string' && HARDCODED_PROBES.has(candidate)) {
      return present.has(candidate);
    }
    return realExistsSync(candidate);
  });
}

function usePlatform(platform: NodeJS.Platform): void {
  vi.spyOn(os, 'platform').mockReturnValue(platform);
}

beforeEach(() => {
  clearRipgrepAvailabilityCache();
  // realpathSync because process.cwd() reports the resolved path on macOS,
  // where os.tmpdir() is a symlink into /private.
  tempRoot = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rg-resolution-')),
  );
  // An empty directory is the default PATH so no case can see the real one,
  // and the packaged binary is absent unless a case installs one.
  usePath(makeDir('empty-path'));
  usePackagedRipgrep(path.join(tempRoot, 'no-packaged-ripgrep', 'rg'));
  delete process.env.PATHEXT;
});

afterEach(() => {
  vi.restoreAllMocks();
  clearRipgrepAvailabilityCache();
  delete (process as unknown as ProcessWithPkg).pkg;
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_PATH === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = ORIGINAL_PATH;
  }
  if (ORIGINAL_PATHEXT === undefined) {
    delete process.env.PATHEXT;
  } else {
    process.env.PATHEXT = ORIGINAL_PATHEXT;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

afterAll(() => {
  if (realPackagedRgPath !== null) {
    usePackagedRipgrep(realPackagedRgPath);
  }
});

describe('getRipgrepPath packaged binary', () => {
  it('returns the packaged binary when it exists', async () => {
    const packagedRg = writeExecutable(
      path.join(tempRoot, 'packaged', 'rg'),
      SHELL_SCRIPT,
    );
    usePackagedRipgrep(packagedRg);

    await expect(getRipgrepPath()).resolves.toBe(packagedRg);
  });

  it('skips a packaged binary carrying an ELF header on darwin', async () => {
    usePlatform('darwin');
    usePackagedRipgrep(
      writeExecutable(path.join(tempRoot, 'packaged', 'rg'), ELF_HEADER),
    );
    const systemBin = makeDir('system-bin');
    const systemRg = writeExecutable(path.join(systemBin, 'rg'), SHELL_SCRIPT);
    usePath(systemBin);

    await expect(getRipgrepPath()).resolves.toBe(systemRg);
  });

  it('accepts a packaged binary carrying an ELF header on linux', async () => {
    usePlatform('linux');
    const packagedRg = writeExecutable(
      path.join(tempRoot, 'packaged', 'rg'),
      ELF_HEADER,
    );
    usePackagedRipgrep(packagedRg);

    await expect(getRipgrepPath()).resolves.toBe(packagedRg);
  });

  it('falls through when the packaged binary path does not exist', async () => {
    usePackagedRipgrep(path.join(tempRoot, 'packaged', 'missing-rg'));
    const systemBin = makeDir('system-bin');
    const systemRg = installSystemRg(systemBin);
    usePath(systemBin);

    await expect(getRipgrepPath()).resolves.toBe(systemRg);
  });
});

describe('getRipgrepPath system PATH lookup', () => {
  it('returns an executable rg found on PATH when the package is absent', async () => {
    const systemBin = makeDir('system-bin');
    const systemRg = installSystemRg(systemBin);
    usePath(systemBin);

    await expect(getRipgrepPath()).resolves.toBe(systemRg);
  });

  // POSIX only: Windows grants X_OK to every readable file, so a
  // non-executable candidate cannot be expressed there.
  it.skipIf(process.platform === 'win32')(
    'ignores a non-executable rg on PATH and uses a hardcoded Unix path',
    async () => {
      usePlatform('darwin');
      const systemBin = makeDir('system-bin');
      const blocked = path.join(systemBin, 'rg');
      fs.writeFileSync(blocked, SHELL_SCRIPT);
      fs.chmodSync(blocked, 0o644);
      usePath(systemBin);
      mockHardcodedProbes(['/usr/local/bin/rg']);

      await expect(getRipgrepPath()).resolves.toBe('/usr/local/bin/rg');
    },
  );
});

describe('getRipgrepPath hardcoded fallbacks', () => {
  it('uses /usr/local/bin/rg on a non-Windows platform', async () => {
    usePlatform('darwin');
    mockHardcodedProbes(['/usr/local/bin/rg']);

    await expect(getRipgrepPath()).resolves.toBe('/usr/local/bin/rg');
  });

  it('uses the Homebrew path on Apple Silicon when no earlier path exists', async () => {
    usePlatform('darwin');
    mockHardcodedProbes(['/opt/homebrew/bin/rg']);

    await expect(getRipgrepPath()).resolves.toBe('/opt/homebrew/bin/rg');
  });

  it('prefers the earliest Unix candidate when several exist', async () => {
    usePlatform('darwin');
    mockHardcodedProbes(['/usr/bin/rg', '/opt/homebrew/bin/rg']);

    await expect(getRipgrepPath()).resolves.toBe('/usr/bin/rg');
  });

  it('uses a Program Files path on win32', async () => {
    usePlatform('win32');
    mockHardcodedProbes([...WINDOWS_FALLBACK_PATHS]);

    const resolved = await getRipgrepPath();

    expect(resolved).toContain('Program Files');
    expect(resolved.endsWith('rg.exe')).toBe(true);
  });

  it('does not use Unix paths on win32', async () => {
    usePlatform('win32');
    mockHardcodedProbes([...UNIX_FALLBACK_PATHS]);
    const projectRoot = makeDir('windows-project-root');
    makeDir('windows-project-root', 'node_modules');
    process.chdir(projectRoot);

    await expect(getRipgrepPath()).rejects.toThrow('ripgrep not found');
  });
});

describe('getRipgrepPath bundle environment', () => {
  it('uses the bundled binary when node_modules is absent', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const bundleRoot = makeDir('bundle-root');
    const bundledRg = writeExecutable(
      path.join(bundleRoot, 'bundle', 'rg'),
      SHELL_SCRIPT,
    );
    process.chdir(bundleRoot);

    await expect(getRipgrepPath()).resolves.toBe(bundledRg);
  });

  it('uses the bundled binary when process.pkg marks a packaged build', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const projectRoot = makeDir('pkg-root');
    makeDir('pkg-root', 'node_modules');
    const bundledRg = writeExecutable(
      path.join(projectRoot, 'bundle', 'rg'),
      SHELL_SCRIPT,
    );
    process.chdir(projectRoot);
    usePkgEntrypoint(path.join(projectRoot, 'entry.js'));

    await expect(getRipgrepPath()).resolves.toBe(bundledRg);
  });

  it('ignores the bundle directory when node_modules is present', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const projectRoot = makeDir('project-root');
    makeDir('project-root', 'node_modules');
    writeExecutable(path.join(projectRoot, 'bundle', 'rg'), SHELL_SCRIPT);
    process.chdir(projectRoot);

    await expect(getRipgrepPath()).rejects.toThrow('ripgrep not found');
  });

  it('reports every installation option when nothing is found', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const projectRoot = makeDir('bare-root');
    makeDir('bare-root', 'node_modules');
    process.chdir(projectRoot);

    await expect(getRipgrepPath()).rejects.toThrow(
      'ripgrep not found. Please install @lvce-editor/ripgrep or system ripgrep.',
    );
    await expect(getRipgrepPath()).rejects.toThrow('brew install ripgrep');
  });
});

describe('isRipgrepAvailable', () => {
  it('reports true when a binary resolves', async () => {
    const systemBin = makeDir('system-bin');
    installSystemRg(systemBin);
    usePath(systemBin);

    await expect(isRipgrepAvailable()).resolves.toBe(true);
  });

  it('reports false when nothing resolves', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const projectRoot = makeDir('bare-root');
    makeDir('bare-root', 'node_modules');
    process.chdir(projectRoot);

    await expect(isRipgrepAvailable()).resolves.toBe(false);
  });

  it('caches the positive result until the cache is cleared', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const systemBin = makeDir('system-bin');
    const systemRg = writeExecutable(path.join(systemBin, 'rg'), SHELL_SCRIPT);
    usePath(systemBin);

    expect(await isRipgrepAvailable()).toBe(true);

    fs.rmSync(systemRg);
    const projectRoot = makeDir('bare-root');
    makeDir('bare-root', 'node_modules');
    process.chdir(projectRoot);

    expect(await isRipgrepAvailable()).toBe(true);

    clearRipgrepAvailabilityCache();

    expect(await isRipgrepAvailable()).toBe(false);
  });

  it('caches the negative result until the cache is cleared', async () => {
    usePlatform('darwin');
    mockHardcodedProbes([]);
    const projectRoot = makeDir('bare-root');
    makeDir('bare-root', 'node_modules');
    process.chdir(projectRoot);

    expect(await isRipgrepAvailable()).toBe(false);

    const systemBin = makeDir('system-bin');
    writeExecutable(path.join(systemBin, 'rg'), SHELL_SCRIPT);
    usePath(systemBin);

    expect(await isRipgrepAvailable()).toBe(false);

    clearRipgrepAvailabilityCache();

    expect(await isRipgrepAvailable()).toBe(true);
  });
});

describe('ensureWindowsShortcut', () => {
  it('returns false on a non-Windows platform and creates nothing', () => {
    usePlatform('darwin');
    const source = writeExecutable(
      path.join(tempRoot, 'src', 'rg'),
      SHELL_SCRIPT,
    );
    const target = path.join(tempRoot, 'dst', 'rg');

    expect(ensureWindowsShortcut(source, target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('hard links the source into a directory it creates', () => {
    usePlatform('win32');
    const source = writeExecutable(
      path.join(tempRoot, 'src', 'rg'),
      SHELL_SCRIPT,
    );
    const target = path.join(tempRoot, 'dst', 'rg');

    expect(ensureWindowsShortcut(source, target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(SHELL_SCRIPT);
    expect(fs.statSync(target).ino).toBe(fs.statSync(source).ino);
  });

  it('copies the source when hard linking fails', () => {
    usePlatform('win32');
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw new Error('EPERM: hard link not permitted');
    });
    const source = writeExecutable(
      path.join(tempRoot, 'src', 'rg'),
      SHELL_SCRIPT,
    );
    const target = path.join(tempRoot, 'dst', 'rg');

    expect(ensureWindowsShortcut(source, target)).toBe(true);
    expect(fs.readFileSync(target, 'utf8')).toBe(SHELL_SCRIPT);
    expect(fs.statSync(target).ino).not.toBe(fs.statSync(source).ino);
  });

  it('leaves an existing target untouched', () => {
    usePlatform('win32');
    const source = writeExecutable(
      path.join(tempRoot, 'src', 'rg'),
      SHELL_SCRIPT,
    );
    const target = writeExecutable(
      path.join(tempRoot, 'dst', 'rg'),
      'existing\n',
    );

    expect(ensureWindowsShortcut(source, target)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe('existing\n');
  });

  it('returns false when the source does not exist', () => {
    usePlatform('win32');
    const source = path.join(tempRoot, 'src', 'missing-rg');
    const target = path.join(tempRoot, 'dst', 'rg');

    expect(ensureWindowsShortcut(source, target)).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });
});
