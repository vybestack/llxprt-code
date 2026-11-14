/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  assertSandboxDevicesSupported,
  buildBwrapDeviceArgs,
  buildContainerDeviceArgs,
  parseSandboxDeviceGrants,
  preflightSandboxDevices,
  resolveSandboxDevices,
  type DeviceEntryStat,
  type SandboxDeviceHost,
} from './sandbox-devices.js';

type EntryKind =
  | 'char'
  | 'block'
  | 'file'
  | 'dir'
  | 'socket'
  | 'fifo'
  | 'symlink';

interface FakeEntry {
  readonly kind: EntryKind;
  readonly target?: string;
  readonly dev?: number;
  readonly denyAccess?: boolean;
  readonly denyOpen?: boolean;
}

function errno(code: string, target: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: ${target}`);
  error.code = code;
  return error;
}

function statOf(entry: FakeEntry): DeviceEntryStat {
  return {
    dev: entry.dev ?? 5,
    isCharacterDevice: () => entry.kind === 'char',
    isBlockDevice: () => entry.kind === 'block',
    isDirectory: () => entry.kind === 'dir',
    isSymbolicLink: () => entry.kind === 'symlink',
    isSocket: () => entry.kind === 'socket',
    isFIFO: () => entry.kind === 'fifo',
  };
}

/**
 * In-memory stand-in for the host `/dev` tree. The test process cannot create
 * block devices, sockets or hostile symlinks under the real `/dev`, so the
 * classification rules are exercised against this tree; the real-device lane
 * covers kernel behavior.
 */
function fakeHost(entries: Readonly<Partial<Record<string, FakeEntry>>>): {
  readonly host: SandboxDeviceHost;
} {
  const exists = (target: string): boolean =>
    entries[target] !== undefined ||
    Object.keys(entries).some((key) => key.startsWith(`${target}/`));
  const resolve = (target: string, depth: number): string => {
    if (depth > 8) throw errno('ELOOP', target);
    let current = '/';
    const parts = target.split('/').filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
      const next = path.posix.join(current, parts[index]);
      const entry = entries[next];
      if (!exists(next)) throw errno('ENOENT', next);
      if (entry?.kind === 'symlink') {
        const linked = path.posix.resolve(current, entry.target ?? '');
        const rest = parts.slice(index + 1).join('/');
        return resolve(path.posix.join(linked, rest), depth + 1);
      }
      current = next;
    }
    return current;
  };
  const host: SandboxDeviceHost = {
    lstat: (target) => {
      const entry = entries[target];
      if (entry === undefined) {
        if (exists(target)) return statOf({ kind: 'dir' });
        throw errno('ENOENT', target);
      }
      return statOf(entry);
    },
    realpath: (target) => resolve(target, 0),
    readdir: (target) => {
      const prefix = `${target}/`;
      return [
        ...new Set(
          Object.keys(entries)
            .filter((key) => key.startsWith(prefix))
            .map((key) => key.slice(prefix.length).split('/')[0]),
        ),
      ].sort();
    },
    access: (target) => {
      if (entries[target]?.denyAccess === true) throw errno('EACCES', target);
    },
    probeOpen: (target) => {
      if (entries[target]?.denyOpen === true) throw errno('EACCES', target);
    },
  };
  return { host };
}

const DRI_TREE: Readonly<Record<string, FakeEntry>> = {
  '/dev/null': { kind: 'char' },
  '/dev/sda': { kind: 'block' },
  '/dev/dri': { kind: 'dir' },
  '/dev/dri/card0': { kind: 'char' },
  '/dev/dri/card1': { kind: 'char' },
  '/dev/dri/renderD128': { kind: 'char' },
  '/dev/dri/by-path': { kind: 'dir' },
  '/dev/dri/by-path/pci-0000:c6:00.0-card': {
    kind: 'symlink',
    target: '../card1',
  },
  '/dev/dri/by-path/pci-0000:c6:00.0-render': {
    kind: 'symlink',
    target: '../renderD128',
  },
};

function fatalMessage(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof FatalSandboxError) return error.message;
    throw error;
  }
  throw new Error('expected a FatalSandboxError');
}

describe('sandbox device grant shape', () => {
  it('treats an absent field and an empty array as no grants', () => {
    expect(parseSandboxDeviceGrants(undefined)).toStrictEqual([]);
    expect(parseSandboxDeviceGrants([])).toStrictEqual([]);
  });

  it('returns lexically normalized absolute device paths', () => {
    expect(
      parseSandboxDeviceGrants(['/dev//dri/./renderD128', '/dev/dri/']),
    ).toStrictEqual(['/dev/dri/renderD128', '/dev/dri']);
  });

  it.each([
    ['null', null, 'devices'],
    ['a string', '/dev/dri', 'devices'],
    ['an object', { path: '/dev/dri' }, 'devices'],
    ['a non-string element', ['/dev/dri', 7], 'devices[1]'],
    ['an empty element', ['/dev/dri', ''], 'devices[1]'],
    ['a control character', ['/dev/dri/render\nD128'], 'devices[0]'],
    ['a NUL byte', ['/dev/dri/render\0D128'], 'devices[0]'],
    ['a DEL byte', ['/dev/dri/render\x7fD128'], 'devices[0]'],
    ['a colon', ['/dev/dri/x:/etc/shadow:rw'], 'devices[0]'],
    ['an overlong path', [`/dev/${'a'.repeat(4091)}`], 'devices[0]'],
    [
      'more than 64 entries',
      Array.from({ length: 65 }, (_, index) => `/dev/dri/n${String(index)}`),
      'devices',
    ],
  ])('rejects %s with the offending field', (_name, raw, field) => {
    expect(fatalMessage(() => parseSandboxDeviceGrants(raw))).toContain(field);
  });

  it.each([
    ['a relative path', 'dev/dri'],
    ['a home shortcut', '~/dev/dri'],
    ['a path outside /dev', '/etc/passwd'],
    ['a sibling that only shares the prefix', '/devices/dri'],
    ['a traversal segment', '/dev/dri/../sda'],
    ['/dev itself', '/dev'],
    ['/dev with a trailing slash', '/dev/'],
    ['/dev/fd', '/dev/fd/1'],
    ['/dev/stdin', '/dev/stdin'],
    ['/dev/pts descendants', '/dev/pts/0'],
    ['/dev/shm descendants', '/dev/shm/segment'],
    ['/dev/mqueue', '/dev/mqueue'],
  ])('rejects %s outside the declared device namespace', (_name, grant) => {
    const message = fatalMessage(() => parseSandboxDeviceGrants([grant]));
    expect(message).toContain('devices[0]');
    expect(message).toContain(grant);
  });
});

describe('sandbox device host resolution', () => {
  it('canonicalizes aliases to one sorted grant and leaves the input untouched', () => {
    const { host } = fakeHost({
      ...DRI_TREE,
      '/dev/gpu': { kind: 'symlink', target: '/dev/dri/renderD128' },
    });
    const input = Object.freeze([
      '/dev/null',
      '/dev/gpu',
      '/dev/dri/renderD128',
    ]);

    const resolved = resolveSandboxDevices(input, host);

    expect(resolved.grants).toStrictEqual(['/dev/dri/renderD128', '/dev/null']);
    expect(resolved.nodes).toStrictEqual(['/dev/dri/renderD128', '/dev/null']);
    expect(resolved.directory).toBeUndefined();
    expect(input).toStrictEqual([
      '/dev/null',
      '/dev/gpu',
      '/dev/dri/renderD128',
    ]);
  });

  it.each([
    ['a missing path', '/dev/absent', /does not exist/],
    ['a block device', '/dev/sda', /block device/],
    [
      'an arbitrary device directory',
      '/dev/input',
      /only the \/dev\/dri directory/,
    ],
  ])('rejects %s', (_name, grant, pattern) => {
    const { host } = fakeHost({
      ...DRI_TREE,
      '/dev/input': { kind: 'dir' },
      '/dev/input/event0': { kind: 'char' },
    });
    const message = fatalMessage(() => resolveSandboxDevices([grant], host));
    expect(message).toMatch(pattern);
    expect(message).toContain('devices[0]');
    expect(message).toContain(grant);
  });

  it.each([
    ['a regular file', 'file'],
    ['a socket', 'socket'],
    ['a FIFO', 'fifo'],
  ] as const)('rejects %s as not a character device', (_name, kind) => {
    const { host } = fakeHost({ '/dev/thing': { kind } });
    expect(
      fatalMessage(() => resolveSandboxDevices(['/dev/thing'], host)),
    ).toMatch(/not a character device/);
  });

  it.each([
    ['an alias escaping /dev', '/etc/passwd', /outside \/dev/],
    ['an alias into a pseudo-filesystem', '/dev/pts/0', /pseudo-filesystem/],
  ])('rejects %s', (_name, target, pattern) => {
    const { host } = fakeHost({
      '/etc/passwd': { kind: 'char' },
      '/dev/pts/0': { kind: 'char' },
      '/dev/sneaky': { kind: 'symlink', target },
    });
    expect(
      fatalMessage(() => resolveSandboxDevices(['/dev/sneaky'], host)),
    ).toMatch(pattern);
  });

  it('expands the dri directory into a stable validated node set', () => {
    const { host } = fakeHost(DRI_TREE);

    const resolved = resolveSandboxDevices(
      ['/dev/dri/renderD128', '/dev/null', '/dev/dri'],
      host,
    );

    expect(resolved.directory).toBe('/dev/dri');
    expect(resolved.grants).toStrictEqual(['/dev/dri', '/dev/null']);
    expect(resolved.nodes).toStrictEqual([
      '/dev/dri/card0',
      '/dev/dri/card1',
      '/dev/dri/renderD128',
      '/dev/null',
    ]);
  });

  it.each([
    ['an empty directory', { '/dev/dri': { kind: 'dir' } }, /no device nodes/],
    [
      'an unexpected regular file',
      {
        ...DRI_TREE,
        '/dev/dri/notes.txt': { kind: 'file' },
      },
      /unexpected entry/,
    ],
    [
      'an unexpected nested directory',
      {
        ...DRI_TREE,
        '/dev/dri/extra': { kind: 'dir' },
      },
      /unexpected entry/,
    ],
    [
      'a nested mount',
      {
        ...DRI_TREE,
        '/dev/dri/card2': { kind: 'char', dev: 99 },
      },
      /nested mount/,
    ],
    [
      'a dangling by-path link',
      {
        ...DRI_TREE,
        '/dev/dri/by-path/gone': { kind: 'symlink', target: '../missing' },
      },
      /dangling or escaping/,
    ],
    [
      'a by-path link escaping the directory',
      {
        ...DRI_TREE,
        '/dev/null2': { kind: 'char' },
        '/dev/dri/by-path/escape': { kind: 'symlink', target: '../../null2' },
      },
      /dangling or escaping/,
    ],
    [
      'a by-path link loop',
      {
        ...DRI_TREE,
        '/dev/dri/by-path/loop': { kind: 'symlink', target: 'loop' },
      },
      /dangling or escaping/,
    ],
  ] as const)('rejects a dri directory with %s', (_name, tree, pattern) => {
    const { host } = fakeHost(tree);
    expect(
      fatalMessage(() => resolveSandboxDevices(['/dev/dri'], host)),
    ).toMatch(pattern);
  });

  it('rejects a dri directory with more than 64 device nodes', () => {
    const crowded: Record<string, FakeEntry> = { '/dev/dri': { kind: 'dir' } };
    for (let index = 0; index < 65; index += 1) {
      crowded[`/dev/dri/card${String(index)}`] = { kind: 'char' };
    }
    const { host } = fakeHost(crowded);
    expect(
      fatalMessage(() => resolveSandboxDevices(['/dev/dri'], host)),
    ).toMatch(/more than 64/);
  });

  it('resolves a real character device on the host', () => {
    expect(resolveSandboxDevices(['/dev/null']).nodes).toStrictEqual([
      '/dev/null',
    ]);
  });

  it('rejects a path that is absent from the real host', () => {
    expect(
      fatalMessage(() => resolveSandboxDevices(['/dev/log-not-present'])),
    ).toMatch(/does not exist/);
  });
});

describe('sandbox device access preflight', () => {
  it('names the path and cause when the launch user cannot read and write a node', () => {
    const { host } = fakeHost({
      '/dev/dri/renderD128': { kind: 'char', denyAccess: true },
    });
    const resolved = resolveSandboxDevices(['/dev/dri/renderD128'], host);

    const message = fatalMessage(() => preflightSandboxDevices(resolved, host));

    expect(message).toContain('/dev/dri/renderD128');
    expect(message).toContain('EACCES');
  });

  it('opens render nodes to prove access that permission bits alone cannot show', () => {
    const { host } = fakeHost({
      '/dev/dri/renderD128': { kind: 'char', denyOpen: true },
    });
    const resolved = resolveSandboxDevices(['/dev/dri/renderD128'], host);

    expect(
      fatalMessage(() => preflightSandboxDevices(resolved, host)),
    ).toContain('/dev/dri/renderD128');
  });

  it('does not open non-render devices because their open can have side effects', () => {
    const { host } = fakeHost({
      '/dev/watchdog': { kind: 'char', denyOpen: true },
    });
    const resolved = resolveSandboxDevices(['/dev/watchdog'], host);

    expect(() => preflightSandboxDevices(resolved, host)).not.toThrow();
  });

  it('accepts a directory grant when the directory and render nodes are accessible', () => {
    const { host } = fakeHost(DRI_TREE);
    const resolved = resolveSandboxDevices(['/dev/dri'], host);

    expect(() => preflightSandboxDevices(resolved, host)).not.toThrow();
  });

  it('rejects a directory grant whose render node cannot be opened', () => {
    const { host } = fakeHost({
      ...DRI_TREE,
      '/dev/dri/renderD128': { kind: 'char', denyOpen: true },
    });
    const resolved = resolveSandboxDevices(['/dev/dri'], host);

    expect(
      fatalMessage(() => preflightSandboxDevices(resolved, host)),
    ).toContain('/dev/dri/renderD128');
  });
});

describe('sandbox device engine support', () => {
  it.each(['bwrap', 'docker', 'podman'] as const)(
    'accepts devices for %s on Linux',
    (command) => {
      expect(() =>
        assertSandboxDevicesSupported(command, ['/dev/dri'], 'linux'),
      ).not.toThrow();
    },
  );

  it('rejects devices for Seatbelt with Linux-only guidance', () => {
    expect(
      fatalMessage(() =>
        assertSandboxDevicesSupported('sandbox-exec', ['/dev/dri'], 'darwin'),
      ),
    ).toMatch(/sandbox-exec does not support Linux devices grants/);
  });

  it.each(['darwin', 'win32'] as const)(
    'rejects container devices on %s hosts',
    (platform) => {
      expect(
        fatalMessage(() =>
          assertSandboxDevicesSupported('docker', ['/dev/dri'], platform),
        ),
      ).toMatch(/Linux host/);
    },
  );

  it.each(['sandbox-exec', 'docker', 'podman', 'bwrap', ''] as const)(
    'ignores absent or empty devices for %s',
    (command) => {
      expect(() =>
        assertSandboxDevicesSupported(command, undefined, 'darwin'),
      ).not.toThrow();
      expect(() =>
        assertSandboxDevicesSupported(command, [], 'win32'),
      ).not.toThrow();
    },
  );
});

describe('sandbox device engine arguments', () => {
  it('maps a render node to a device bind below a created parent', () => {
    expect(
      buildBwrapDeviceArgs({
        grants: ['/dev/dri/renderD128'],
        nodes: ['/dev/dri/renderD128'],
      }),
    ).toStrictEqual([
      '--dir',
      '/dev/dri',
      '--dev-bind',
      '/dev/dri/renderD128',
      '/dev/dri/renderD128',
    ]);
  });

  it('maps the dri directory to one device bind and keeps top-level nodes parentless', () => {
    expect(
      buildBwrapDeviceArgs({
        grants: ['/dev/dri', '/dev/null'],
        nodes: ['/dev/dri/card0', '/dev/dri/renderD128', '/dev/null'],
        directory: '/dev/dri',
      }),
    ).toStrictEqual([
      '--dev-bind',
      '/dev/dri',
      '/dev/dri',
      '--dev-bind',
      '/dev/null',
      '/dev/null',
    ]);
  });

  it('maps every container node to a separate same-path read-write device operand', () => {
    expect(
      buildContainerDeviceArgs({
        grants: ['/dev/dri', '/dev/null'],
        nodes: ['/dev/dri/card0', '/dev/dri/renderD128', '/dev/null'],
        directory: '/dev/dri',
      }),
    ).toStrictEqual([
      '--device',
      '/dev/dri/card0:/dev/dri/card0:rw',
      '--device',
      '/dev/dri/renderD128:/dev/dri/renderD128:rw',
      '--device',
      '/dev/null:/dev/null:rw',
    ]);
  });

  it('adds nothing when no devices are granted', () => {
    const none = { grants: [], nodes: [] };
    expect(buildBwrapDeviceArgs(none)).toStrictEqual([]);
    expect(buildContainerDeviceArgs(none)).toStrictEqual([]);
  });
});

describe('real host render nodes', () => {
  const renderNode = fs.existsSync('/dev/dri')
    ? fs
        .readdirSync('/dev/dri')
        .filter((name) => name.startsWith('renderD'))
        .sort()
        .map((name) => `/dev/dri/${name}`)[0]
    : undefined;

  it.skipIf(renderNode === undefined)(
    'resolves a real render node to its canonical path',
    () => {
      const resolved = resolveSandboxDevices([renderNode ?? '']);
      expect(resolved.nodes).toStrictEqual([renderNode ?? '']);
    },
  );
});
