/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from '@vybestack/llxprt-code-core';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import { buildSeatbeltArgs } from './sandbox-seatbelt.js';

// Extracted from sandbox-seatbelt.test.ts (#3479 max-lines precedent): the
// suite owning the seatbelt profile behavior had reached its line boundary,
// so the #3475 canonicalization coverage lives here.

describe('#3475 seatbelt path canonicalization', () => {
  let tmpRoot: string;
  const savedEnv: Record<string, string | undefined> = {};

  const ENV_KEYS = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_CACHE_HOME',
    'HOME',
  ] as const;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue3475-sb-'));
    for (const dir of ['config', 'data', 'log', 'cache']) {
      fs.mkdirSync(path.join(tmpRoot, dir), { recursive: true });
    }
    process.env.LLXPRT_CONFIG_HOME = path.join(tmpRoot, 'config');
    process.env.LLXPRT_DATA_HOME = path.join(tmpRoot, 'data');
    process.env.LLXPRT_LOG_HOME = path.join(tmpRoot, 'log');
    process.env.LLXPRT_CACHE_HOME = path.join(tmpRoot, 'cache');
    process.env.HOME = tmpRoot;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('fails with a classified error naming the directory when an include directory is a symlink cycle', () => {
    const cyclic = path.join(tmpRoot, 'cycle');
    fs.symlinkSync(cyclic, cyclic);
    const cliConfig = {
      getTargetDir: () => tmpRoot,
      getWorkspaceContext: () => ({ getDirectories: () => [cyclic] }),
    } as unknown as Config;
    let thrown: unknown;
    try {
      buildSeatbeltArgs('/tmp/profile.sb', 'node-opts', cliConfig);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(cyclic);
    expect(thrown.message).toContain('resolve a sandbox include directory');
  });

  it('fails fast instead of using a lexical path when a canonical Storage root is a symlink cycle', () => {
    const cyclic = path.join(tmpRoot, 'cyclic-config');
    fs.symlinkSync(cyclic, cyclic);
    process.env.LLXPRT_CONFIG_HOME = cyclic;
    expect(() =>
      buildSeatbeltArgs('/tmp/profile.sb', 'node-opts'),
    ).toThrowError(FatalSandboxError);
  });

  it('fails with a classified error naming the target directory when it is a symlink cycle', () => {
    const cyclic = path.join(tmpRoot, 'cyclic-target');
    fs.symlinkSync(cyclic, cyclic);
    const cliConfig = {
      getTargetDir: () => cyclic,
      getWorkspaceContext: () => ({ getDirectories: () => [] }),
    } as unknown as Config;
    let thrown: unknown;
    try {
      buildSeatbeltArgs('/tmp/profile.sb', 'node-opts', cliConfig);
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof FatalSandboxError)) {
      throw new Error('Expected a FatalSandboxError');
    }
    expect(thrown.message).toContain(cyclic);
    expect(thrown.message).toContain('resolve the sandbox target directory');
  });
});
