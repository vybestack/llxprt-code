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
import { addContainerVolumeMounts } from './sandbox-containers.js';

describe('#3475 mount-source canonicalization', () => {
  let environmentSnapshot: NodeJS.ProcessEnv;
  const tempDirs: string[] = [];

  beforeEach(() => {
    environmentSnapshot = { ...process.env };
    tempDirs.length = 0;
    delete process.env.LLXPRT_SANDBOX_MOUNTS;
    delete process.env.SANDBOX_MOUNTS;
  });

  afterEach(() => {
    process.env = environmentSnapshot;
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with a classified error naming the source, mount variable, and cause when a mount source is absent', () => {
    const missing = path.join(os.tmpdir(), 'issue3475-absent-mount-source');
    process.env.LLXPRT_SANDBOX_MOUNTS = missing;
    let thrown: unknown;
    try {
      addContainerVolumeMounts([]);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(missing);
    expect(thrown.message).toContain('LLXPRT_SANDBOX_MOUNTS');
    expect(thrown.message).toContain('ENOENT');
  });

  it('rejects a mount source that is a symlink cycle with a classified error', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3475-cycle-'));
    tempDirs.push(root);
    const cyclic = path.join(root, 'cycle');
    fs.symlinkSync(cyclic, cyclic);
    process.env.LLXPRT_SANDBOX_MOUNTS = cyclic;
    let thrown: unknown;
    try {
      addContainerVolumeMounts([]);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(cyclic);
    expect(thrown.message).toContain('ELOOP');
  });

  it('still mounts an existing source after real-path validation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3475-mount-'));
    tempDirs.push(root);
    process.env.LLXPRT_SANDBOX_MOUNTS = `${root}:/target:rw`;
    const args: string[] = [];
    addContainerVolumeMounts(args);
    expect(args).toContain('--volume');
    expect(args).toContain(`${root}:/target:rw`);
  });
});
