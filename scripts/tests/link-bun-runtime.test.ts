/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  OVEN_PACKAGE_VERSION,
  type HostPlatformInput,
} from '../../packages/cli/src/launcher/oven-bun-variants.ts';
import { linkBunRuntime } from '../link-bun-runtime.ts';

const LINUX_X64_AVX2: HostPlatformInput = {
  os: 'linux',
  arch: 'x64',
  abi: undefined,
  avx2: true,
};
const LINUX_X64_BASELINE: HostPlatformInput = {
  ...LINUX_X64_AVX2,
  avx2: false,
};
const PLACEHOLDER = 'placeholder written by the bun package tarball';

function writePackage(
  root: string,
  name: string,
  version: string,
  files: Record<string, string>,
): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
  for (const [relative, content] of Object.entries(files)) {
    writeFileSync(join(dir, relative), content);
  }
}

function writeBunPlaceholder(root: string, version: string): void {
  writePackage(root, 'bun', version, {
    'bin/bun.exe': PLACEHOLDER,
    'bin/bunx.exe': PLACEHOLDER,
  });
}

describe('linkBunRuntime', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'link-bun-runtime-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('replaces the placeholder with the lockfile-installed AVX2 variant', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);
    writePackage(root, '@oven/bun-linux-x64', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'avx2 binary',
    });
    writePackage(root, '@oven/bun-linux-x64-baseline', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'baseline binary',
    });

    const result = linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 });

    const bunExe = join(root, 'node_modules', 'bun', 'bin', 'bun.exe');
    const bunxExe = join(root, 'node_modules', 'bun', 'bin', 'bunx.exe');
    expect(result.bunExe).toBe(bunExe);
    expect(readFileSync(bunExe, 'utf8')).toBe('avx2 binary');
    expect(readFileSync(bunxExe, 'utf8')).toBe('avx2 binary');
    const linked = statSync(bunExe);
    expect(linked.isFile()).toBe(true);
    expect(linked.size).toBe(Buffer.byteLength('avx2 binary'));
    // Windows has no POSIX execute bits; the fixture payload is text, so the
    // content and size assertions above are its whole contract there.
    if (process.platform !== 'win32') {
      expect(linked.mode & 0o111).not.toBe(0);
    }
  });

  it('falls back to the baseline variant on a host without AVX2', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);
    writePackage(root, '@oven/bun-linux-x64', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'avx2 binary',
    });
    writePackage(root, '@oven/bun-linux-x64-baseline', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'baseline binary',
    });

    linkBunRuntime({ repoRoot: root, host: LINUX_X64_BASELINE });

    const bunExe = join(root, 'node_modules', 'bun', 'bin', 'bun.exe');
    expect(readFileSync(bunExe, 'utf8')).toBe('baseline binary');
  });

  it('is idempotent and never writes through into the variant package', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);
    writePackage(root, '@oven/bun-linux-x64', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'avx2 binary',
    });

    linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 });
    linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 });

    const source = join(root, 'node_modules', '@oven', 'bun-linux-x64', 'bin');
    expect(readFileSync(join(source, 'bun'), 'utf8')).toBe('avx2 binary');
  });

  it('fails with the variants it looked for when none is installed', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);

    expect(() =>
      linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 }),
    ).toThrow(/@oven\/bun-linux-x64.*@oven\/bun-linux-x64-baseline/);
    const bunExe = join(root, 'node_modules', 'bun', 'bin', 'bun.exe');
    expect(readFileSync(bunExe, 'utf8')).toBe(PLACEHOLDER);
  });

  it('fails when the bun package is not installed', () => {
    writePackage(root, '@oven/bun-linux-x64', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'avx2 binary',
    });

    expect(() =>
      linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 }),
    ).toThrow(/npm ci --ignore-scripts/);
  });

  it('fails when the installed bun version is not the pinned one', () => {
    writeBunPlaceholder(root, '1.0.0');
    writePackage(root, '@oven/bun-linux-x64', OVEN_PACKAGE_VERSION, {
      'bin/bun': 'avx2 binary',
    });

    expect(() =>
      linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 }),
    ).toThrow(/pins 1\.4\.4/);
  });

  it('fails when the variant version differs from the bun package', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);
    writePackage(root, '@oven/bun-linux-x64', '1.0.0', {
      'bin/bun': 'avx2 binary',
    });

    expect(() =>
      linkBunRuntime({ repoRoot: root, host: LINUX_X64_AVX2 }),
    ).toThrow(/is 1\.0\.0 but node_modules\/bun is/);
  });

  it('fails on an unsupported host', () => {
    writeBunPlaceholder(root, OVEN_PACKAGE_VERSION);

    expect(() => linkBunRuntime({ repoRoot: root, host: null })).toThrow(
      /Unsupported host/,
    );
  });
});
