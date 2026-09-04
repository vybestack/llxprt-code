/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { Storage } from '@vybestack/llxprt-code-storage';
import { useFakeEngine } from '../../test-utils/fake-dependency-engine-harness.js';
import { addPrivateDependencyMounts } from './sandbox-node-modules.js';

const RUN_ROOT_PREFIX = 'sandbox-node-modules-';

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-ws-'));
}

/**
 * Points the production Storage resolver at a private temp cache root so
 * the tests never create or inspect run directories in the shared live
 * user cache (#3450 remediation F8).
 */
function isolateCacheEnv(): () => void {
  const saved = process.env.LLXPRT_CACHE_HOME;
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-cache-'));
  process.env.LLXPRT_CACHE_HOME = isolated;
  return () => {
    if (saved === undefined) {
      delete process.env.LLXPRT_CACHE_HOME;
    } else {
      process.env.LLXPRT_CACHE_HOME = saved;
    }
    fs.rmSync(isolated, { recursive: true, force: true });
  };
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeBytes(filePath: string, bytes: Uint8Array): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function elfBytes(): Uint8Array {
  return Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
}

function machOBytes(): Uint8Array {
  // 0xCFFAEDFE on disk: the little-endian 64-bit thin Mach-O header.
  return Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00, 0x00, 0x01]);
}

function writeUint32BE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

/**
 * Complete big-endian 32-bit universal binary header: the 0xCAFEBABE magic,
 * the declared architecture count, and every declared 20-byte fat_arch
 * record (cputype, cpusubtype, offset, size, align, all big-endian).
 */
function machOFatBytes(architectureCount = 2): Uint8Array {
  const bytes = new Uint8Array(8 + architectureCount * 20);
  writeUint32BE(bytes, 0, 0xcafebabe);
  writeUint32BE(bytes, 4, architectureCount);
  for (let index = 0; index < architectureCount; index++) {
    const record = 8 + index * 20;
    writeUint32BE(bytes, record, 0x01000007); // cputype: x86_64
    writeUint32BE(bytes, record + 4, 0x00000003); // cpusubtype
    writeUint32BE(bytes, record + 8, 0x00001000); // slice offset
    writeUint32BE(bytes, record + 12, 0x00000100); // slice size
    writeUint32BE(bytes, record + 16, 0x0000000c); // alignment
  }
  return bytes;
}

/**
 * Complete big-endian 64-bit universal binary header: the 0xCAFEBABF magic
 * and every declared 32-byte fat_arch_64 record (cputype, cpusubtype,
 * 64-bit offset, 64-bit size, align, reserved, all big-endian).
 */
function machOFat64Bytes(architectureCount = 2): Uint8Array {
  const bytes = new Uint8Array(8 + architectureCount * 32);
  writeUint32BE(bytes, 0, 0xcafebabf);
  writeUint32BE(bytes, 4, architectureCount);
  for (let index = 0; index < architectureCount; index++) {
    const record = 8 + index * 32;
    writeUint32BE(bytes, record, 0x0100000c); // cputype: arm64
    writeUint32BE(bytes, record + 4, 0x00000000); // cpusubtype
    writeUint32BE(bytes, record + 8, 0x00001000); // slice offset, high half
    writeUint32BE(bytes, record + 12, 0x00000000); // slice offset, low half
    writeUint32BE(bytes, record + 16, 0x00000100); // slice size, high half
    writeUint32BE(bytes, record + 20, 0x00000000); // slice size, low half
    writeUint32BE(bytes, record + 24, 0x0000000c); // alignment
    writeUint32BE(bytes, record + 28, 0x00000000); // reserved
  }
  return bytes;
}

function peBytes(): Uint8Array {
  const bytes = new Uint8Array(0x84);
  bytes[0] = 0x4d; // 'M'
  bytes[1] = 0x5a; // 'Z'
  // e_lfanew at 0x3c pointing at 0x80, little-endian.
  bytes[0x3c] = 0x80;
  // "PE\0\0" signature at 0x80.
  bytes[0x80] = 0x50;
  bytes[0x81] = 0x45;
  bytes[0x82] = 0x00;
  bytes[0x83] = 0x00;
  return bytes;
}

/** PE whose validated e_lfanew (0x300) lies beyond the 512-byte probe. */
function peBytesWithDistantHeader(): Uint8Array {
  const bytes = new Uint8Array(0x304);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes[0x3c] = 0x00;
  bytes[0x3d] = 0x03;
  bytes[0x3e] = 0x00;
  bytes[0x3f] = 0x00;
  bytes[0x300] = 0x50;
  bytes[0x301] = 0x45;
  bytes[0x302] = 0x00;
  bytes[0x303] = 0x00;
  return bytes;
}

/** MZ header whose e_lfanew points past the end of the file. */
function peBytesTruncatedDistantHeader(): Uint8Array {
  const bytes = new Uint8Array(0x84);
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes[0x3c] = 0x00;
  bytes[0x3d] = 0x03;
  bytes[0x3e] = 0x00;
  bytes[0x3f] = 0x00;
  return bytes;
}

function danglingBinLink(
  workdir: string,
  target: string,
  tree = 'node_modules',
): string {
  const binDir = path.join(workdir, ...tree.split('/'), '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const linkPath = path.join(binDir, 'tool');
  fs.symlinkSync(target, linkPath);
  return linkPath;
}

function privateRunRoots(): string[] {
  const cacheDir = Storage.getGlobalCacheDir();
  return fs
    .readdirSync(cacheDir)
    .filter((entry) => entry.startsWith(RUN_ROOT_PREFIX))
    .map((entry) => path.join(cacheDir, entry));
}

describe('#3450 bounded wrong-platform contamination preflight', () => {
  const engine = useFakeEngine();
  let workdir = '';
  let restoreCacheEnv: () => void;

  beforeEach(() => {
    workdir = makeWorkspace();
    restoreCacheEnv = isolateCacheEnv();
    writeJson(path.join(workdir, 'package.json'), {
      workspaces: ['packages/nested'],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (workdir !== '') fs.rmSync(workdir, { recursive: true, force: true });
    restoreCacheEnv();
  });

  function prepareOnHost(): {
    readonly args: string[];
    readonly cleanup: () => void;
  } {
    const args: string[] = [];
    const lifecycle = addPrivateDependencyMounts(engine.config, args, workdir);
    return { args, cleanup: () => lifecycle.release() };
  }

  /** The no-contamination cases still create storage; release it again. */
  function prepareAndTearDownOnHost(): void {
    const { cleanup } = prepareOnHost();
    cleanup();
  }

  it('fails on an ELF native addon on a macOS host', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      elfBytes(),
    );

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', 'pkg', 'addon.node'),
    );
    expect(() => prepareOnHost()).toThrowError('ELF');
    expect(() => prepareOnHost()).toThrowError('Linux');
    expect(() => prepareOnHost()).toThrowError('macOS');
    expect(() => prepareOnHost()).toThrowError('reinstall on the host');
  });

  it('fails on a Mach-O native addon in a nested root on a Linux host', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    writeBytes(
      path.join(
        workdir,
        'packages',
        'nested',
        'node_modules',
        'pkg',
        'addon.node',
      ),
      machOBytes(),
    );

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('packages', 'nested', 'node_modules', 'pkg', 'addon.node'),
    );
    expect(() => prepareOnHost()).toThrowError('Mach-O');
    expect(() => prepareOnHost()).toThrowError('macOS');
    expect(() => prepareOnHost()).toThrowError('Linux');
    expect(() => prepareOnHost()).toThrowError('Remove the affected');
  });

  it('recognizes complete fat/universal Mach-O binaries', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      machOFatBytes(),
    );
    expect(() => prepareOnHost()).toThrowError('Mach-O');
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', 'pkg', 'addon.node'),
    );

    fs.rmSync(path.join(workdir, 'node_modules', 'pkg', 'addon.node'));
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon2.node'),
      machOFat64Bytes(),
    );
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', 'pkg', 'addon2.node'),
    );
  });

  it('recognizes a complete universal binary whose declared table extends beyond the initial probe', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    // 30 declared 20-byte records need 608 bytes, past the 512-byte probe;
    // the complete table is still present in the file.
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      machOFatBytes(30),
    );
    expect(() => prepareOnHost()).toThrowError('Mach-O');
  });

  it.each([
    [
      'a bare 32-bit magic-plus-nfat_arch prefix',
      () => machOFatBytes(1).subarray(0, 8),
    ],
    [
      'a 32-bit header one byte short of its second fat_arch record',
      () => machOFatBytes(2).subarray(0, 8 + 20 + 19),
    ],
    [
      'a bare 64-bit magic-plus-nfat_arch prefix',
      () => machOFat64Bytes(1).subarray(0, 8),
    ],
    [
      'a 64-bit header one byte short of its second fat_arch_64 record',
      () => machOFat64Bytes(2).subarray(0, 8 + 32 + 31),
    ],
    [
      'a 32-bit header truncated 108 bytes short of its declared table',
      () => machOFatBytes(30).subarray(0, 500),
    ],
  ])('does not treat %s as Mach-O', (_label, truncatedBytes) => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      truncatedBytes(),
    );
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it.each([
    ['the 32-bit FAT_CIGAM byte order', [0xbe, 0xba, 0xfe, 0xca]],
    ['the 64-bit FAT_CIGAM_64 byte order', [0xbf, 0xba, 0xfe, 0xca]],
  ])('does not treat %s as an on-disk Mach-O format', (_label, magic) => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    // FAT_CIGAM/FAT_CIGAM_64 are host-memory byte-swapped constants;
    // Apple stores fat structures big-endian, so these byte orders never
    // occur in file bytes and must not classify.
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      Uint8Array.from([...magic, 0x00, 0x00, 0x00, 0x02]),
    );
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('does not treat a fat magic with an impossible architecture count as Mach-O', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      machOFatBytes(0xff),
    );
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('fails on a PE executable reached through a .bin symlink on a macOS host', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'tool.exe'),
      peBytes(),
    );
    const binDir = path.join(workdir, 'node_modules', '.bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync('../pkg/tool.exe', path.join(binDir, 'tool'));

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', '.bin', 'tool'),
    );
    expect(() => prepareOnHost()).toThrowError('PE');
    expect(() => prepareOnHost()).toThrowError('Windows');
  });

  it('fails on a wrong-platform regular executable directly in .bin', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(path.join(workdir, 'node_modules', '.bin', 'tool'), elfBytes());

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', '.bin', 'tool'),
    );
    expect(() => prepareOnHost()).toThrowError('ELF');
  });

  it('fails on a symlinked .node file through its contained target', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    // The stored target deliberately does not end in `.node`: the walk also
    // inspects regular `.node` files in place, so naming it `real-addon.node`
    // would make the store copy a second, independent contamination source and
    // the reported path would depend on `fs.readdirSync` order (which of `pkg`
    // and `store` is visited first varies by filesystem). Leaving the symlink
    // as the only trigger keeps the asserted path deterministic everywhere.
    writeBytes(
      path.join(workdir, 'node_modules', 'store', 'real-addon.bin'),
      elfBytes(),
    );
    fs.mkdirSync(path.join(workdir, 'node_modules', 'pkg'), {
      recursive: true,
    });
    fs.symlinkSync(
      '../store/real-addon.bin',
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
    );

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', 'pkg', 'addon.node'),
    );
    expect(() => prepareOnHost()).toThrowError('ELF');
  });

  it('recognizes a PE whose validated e_lfanew lies beyond the initial probe', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      peBytesWithDistantHeader(),
    );

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError('PE');
    expect(() => prepareOnHost()).toThrowError('Windows');
  });

  it('fails on a dangling absolute .bin symlink into the image-global bun location', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    danglingBinLink(workdir, '/usr/local/bun/bin/bun');

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(() => prepareOnHost()).toThrowError(
      path.join('node_modules', '.bin', 'tool'),
    );
    expect(() => prepareOnHost()).toThrowError('/usr/local/bun/bin/bun');
    expect(() => prepareOnHost()).toThrowError('retry');
  });

  it.each([
    '/usr/bin/issue3450-missing-tool',
    '/usr/local/bin/issue3450-missing-tool',
    '/bin/issue3450-missing-tool',
    '/opt/issue3450/bin/tool',
  ])(
    'does not fail on a dangling absolute target outside the validated image-global location (%s)',
    (target) => {
      vi.spyOn(os, 'platform').mockReturnValue('darwin');
      danglingBinLink(workdir, target);
      expect(() => prepareAndTearDownOnHost()).not.toThrow();
    },
  );

  it('does not fail on an absolute .bin symlink whose target exists on this host', () => {
    danglingBinLink(workdir, '/usr/bin/env');
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('does not inspect a .bin symlink target that escapes the workspace', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3450-out-'));
    try {
      // A foreign-platform binary that exists OUTSIDE the workspace: the
      // preflight resolves contained targets only, so this never fails.
      writeBytes(path.join(outside, 'elf-tool'), elfBytes());
      const binDir = path.join(workdir, 'node_modules', '.bin');
      fs.mkdirSync(binDir, { recursive: true });
      const relativeTarget = path.relative(
        binDir,
        path.join(outside, 'elf-tool'),
      );
      fs.symlinkSync(relativeTarget, path.join(binDir, 'tool'));
      expect(() => prepareAndTearDownOnHost()).not.toThrow();
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('does not fail for a matching-host native addon', () => {
    vi.spyOn(os, 'platform').mockReturnValue('linux');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      elfBytes(),
    );
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it.each([
    [
      'a shebang script in .bin',
      () => {
        const binDir = path.join(workdir, 'node_modules', '.bin');
        fs.mkdirSync(binDir, { recursive: true });
        fs.writeFileSync(
          path.join(binDir, 'tool'),
          '#!/usr/bin/env node\nconsole.log("ok");\n',
        );
      },
    ],
    [
      'unknown bytes in a .node file',
      () => {
        writeBytes(
          path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
          Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]),
        );
      },
    ],
    [
      'truncated PE bytes (MZ without a reachable PE signature)',
      () => {
        writeBytes(
          path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
          Uint8Array.from([0x4d, 0x5a]),
        );
      },
    ],
    [
      'a PE whose e_lfanew points past the end of the file',
      () => {
        writeBytes(
          path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
          peBytesTruncatedDistantHeader(),
        );
      },
    ],
    [
      'a relative dangling .bin symlink',
      () => {
        danglingBinLink(workdir, '../does-not-exist-anywhere');
      },
    ],
  ])('continues without an error for %s', (_label, seed) => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    seed();
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('continues without an error for an empty protected tree', () => {
    fs.mkdirSync(path.join(workdir, 'node_modules'), { recursive: true });
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('continues without an error for foreign-platform prebuilds directories', () => {
    // node-gyp-build packages ship one prebuilds/ tree with binaries for
    // every platform; only the current platform's file is ever loaded, so
    // foreign .node files there are inert data (this repository's own
    // node_modules contains tree-sitter win32 prebuilds, for example).
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(
        workdir,
        'node_modules',
        'tree-sitter-bash',
        'prebuilds',
        'win32-arm64',
        'tree-sitter-bash.node',
      ),
      peBytes(),
    );
    writeBytes(
      path.join(
        workdir,
        'node_modules',
        'tree-sitter-bash',
        'prebuilds',
        'linux-x64-gnu',
        'tree-sitter-bash.node',
      ),
      elfBytes(),
    );
    expect(() => prepareAndTearDownOnHost()).not.toThrow();
  });

  it('runs the preflight before creating any private storage', () => {
    vi.spyOn(os, 'platform').mockReturnValue('darwin');
    writeBytes(
      path.join(workdir, 'node_modules', 'pkg', 'addon.node'),
      elfBytes(),
    );

    expect(() => prepareOnHost()).toThrowError(FatalSandboxError);
    expect(privateRunRoots()).toStrictEqual([]);
    // No engine resource was created: the launch stopped before the very
    // first engine invocation.
    expect(engine.snapshot().invocations).toStrictEqual([]);
    expect(engine.volumeNames()).toStrictEqual([]);
  });
});
