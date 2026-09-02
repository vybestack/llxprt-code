/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { getContainerPath } from './sandbox-env.js';
import {
  addContainerWorkspaceMounts,
  planContainerWorkspaces,
} from './sandbox-workspaces.js';

describe('#3463 container multi-root workspace planning', () => {
  let fixtureRoot = '';
  let primaryRoot = '';
  let includeRootA = '';
  let includeRootB = '';

  beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3463-roots-'));
    primaryRoot = path.join(fixtureRoot, 'primary');
    includeRootA = path.join(fixtureRoot, 'include-a');
    includeRootB = path.join(fixtureRoot, 'include-b');
    fs.mkdirSync(primaryRoot);
    fs.mkdirSync(includeRootA);
    fs.mkdirSync(includeRootB);
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('mounts every distinct accepted include root read-write at path parity', () => {
    const plan = planContainerWorkspaces(primaryRoot, [
      fs.realpathSync(primaryRoot),
      includeRootA,
      includeRootB,
    ]);
    const args = ['run', '--volume', `${primaryRoot}:${primaryRoot}`];

    addContainerWorkspaceMounts(args, plan);

    expect(plan.roots).toStrictEqual([
      primaryRoot,
      fs.realpathSync(includeRootA),
      fs.realpathSync(includeRootB),
    ]);
    expect(args).toStrictEqual([
      'run',
      '--volume',
      `${primaryRoot}:${primaryRoot}`,
      '--volume',
      `${fs.realpathSync(includeRootA)}:${getContainerPath(fs.realpathSync(includeRootA))}`,
      '--volume',
      `${fs.realpathSync(includeRootB)}:${getContainerPath(fs.realpathSync(includeRootB))}`,
    ]);
  });

  it('does not duplicate the primary root when its accepted path uses a symlink-free identity', () => {
    const primaryAlias = path.join(fixtureRoot, 'primary-alias');
    fs.symlinkSync(primaryRoot, primaryAlias);

    const plan = planContainerWorkspaces(primaryAlias, [
      fs.realpathSync(primaryAlias),
      includeRootA,
    ]);
    const args: string[] = [];
    addContainerWorkspaceMounts(args, plan);

    expect(plan.roots).toStrictEqual([
      primaryAlias,
      fs.realpathSync(includeRootA),
    ]);
    expect(args).toStrictEqual([
      '--volume',
      `${fs.realpathSync(includeRootA)}:${getContainerPath(fs.realpathSync(includeRootA))}`,
    ]);
  });

  it('rejects a missing include root with correction guidance', () => {
    const missing = path.join(fixtureRoot, 'missing');

    let thrown: unknown;
    try {
      planContainerWorkspaces(primaryRoot, [primaryRoot, missing]);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(missing);
    expect(thrown.message).toContain('--include-directories');
    expect(thrown.message).toContain('does not exist');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink-cycle include root as a classified preparation error',
    () => {
      // #3475 canonicalization inside the #3463 multi-root planner: a root
      // that cannot be resolved against the real filesystem fails through
      // the shared fail-fast helper, keeping the mount correction guidance.
      const cyclic = path.join(fixtureRoot, 'cycle');
      fs.symlinkSync(cyclic, cyclic);

      let thrown: unknown;
      try {
        planContainerWorkspaces(primaryRoot, [primaryRoot, cyclic]);
      } catch (error) {
        thrown = error;
      }

      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(cyclic);
      expect(thrown.message).toContain('--include-directories');
      expect(thrown.message).toContain('cannot be resolved');
      expect(thrown.cause).toBeInstanceOf(Error);
    },
  );

  it('rejects an accepted root that is not a mountable directory', () => {
    const filePath = path.join(fixtureRoot, 'not-a-directory');
    fs.writeFileSync(filePath, 'file');

    let thrown: unknown;
    try {
      planContainerWorkspaces(primaryRoot, [primaryRoot, filePath]);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(filePath);
    expect(thrown.message).toContain('mountable directory');

    expect(thrown.message).toContain('--include-directories');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a root that cannot be searched by the launching user',
    () => {
      fs.chmodSync(includeRootA, 0o600);

      let thrown: unknown;
      try {
        planContainerWorkspaces(primaryRoot, [primaryRoot, includeRootA]);
      } catch (error) {
        thrown = error;
      }

      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(includeRootA);
      expect(thrown.message).toContain(
        'readable, writable, and searchable by LLxprt',
      );
      expect(thrown.message).toContain('--include-directories');
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a POSIX root that cannot be represented by Docker or Podman volume syntax',
    () => {
      const unsupportedRoot = path.join(fixtureRoot, 'include:unsupported');
      fs.mkdirSync(unsupportedRoot);

      let thrown: unknown;
      try {
        planContainerWorkspaces(primaryRoot, [primaryRoot, unsupportedRoot]);
      } catch (error) {
        thrown = error;
      }

      if (!(thrown instanceof FatalSandboxError)) {
        throw new Error('Expected a FatalSandboxError');
      }
      expect(thrown.message).toContain(unsupportedRoot);
      expect(thrown.message).toContain('volume mount syntax');
      expect(thrown.message).toContain('--include-directories');
    },
  );

  it('rejects an include root nested beneath the primary root', () => {
    const nested = path.join(primaryRoot, 'nested');
    fs.mkdirSync(nested);

    let thrown: unknown;
    try {
      planContainerWorkspaces(primaryRoot, [primaryRoot, nested]);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(primaryRoot);
    expect(thrown.message).toContain(nested);
    expect(thrown.message).toContain('overlap');
    expect(thrown.message).toContain('--include-directories');
  });

  it('rejects include roots that overlap through a symlink', () => {
    const nested = path.join(includeRootA, 'nested');
    const nestedAlias = path.join(fixtureRoot, 'nested-alias');
    fs.mkdirSync(nested);
    fs.symlinkSync(nested, nestedAlias);

    let thrown: unknown;
    try {
      planContainerWorkspaces(primaryRoot, [
        primaryRoot,
        includeRootA,
        nestedAlias,
      ]);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(fs.realpathSync(includeRootA));
    expect(thrown.message).toContain(fs.realpathSync(nestedAlias));
    expect(thrown.message).toContain('overlap');
  });
});
