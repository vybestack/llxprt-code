/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addContainerEnvVars } from './sandbox-containers.js';

const PODMAN_CONFIG = { command: 'podman', image: 'test' } as const;

function authfileOperand(args: readonly string[]): string {
  const index = args.indexOf('--authfile');
  expect(index).toBeGreaterThanOrEqual(0);
  return args[index + 1];
}

function podmanArgs(): string[] {
  const args: string[] = [];
  addContainerEnvVars(args, PODMAN_CONFIG, 'test-container', [], '/workspace');
  return args;
}

describe('podman --authfile for sandbox containers', () => {
  let tempRoot: string;
  let originalTmpdir: string | undefined;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-authfile-'));
    originalTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = tempRoot;
  });

  afterEach(() => {
    if (originalTmpdir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = originalTmpdir;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('passes an auth file that holds an empty JSON object', () => {
    const authfile = authfileOperand(podmanArgs());

    expect(JSON.parse(fs.readFileSync(authfile, 'utf-8'))).toStrictEqual({});
  });

  it.skipIf(process.platform === 'win32')(
    'creates the auth file readable only by its owner',
    () => {
      const authfile = authfileOperand(podmanArgs());

      expect(fs.statSync(authfile).mode & 0o077).toBe(0);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'does not overwrite a file reached through a symlink planted at the old fixed path',
    () => {
      const victim = path.join(tempRoot, 'victim.txt');
      fs.writeFileSync(victim, 'precious');
      fs.symlinkSync(victim, path.join(tempRoot, 'empty_auth.json'));

      authfileOperand(podmanArgs());

      expect(fs.readFileSync(victim, 'utf-8')).toBe('precious');
    },
  );

  it('uses a distinct auth file for every container launch', () => {
    const first = authfileOperand(podmanArgs());
    const second = authfileOperand(podmanArgs());

    expect(second).not.toBe(first);
  });

  it('does not pass an auth file for docker', () => {
    const args: string[] = [];
    addContainerEnvVars(
      args,
      { command: 'docker', image: 'test' },
      'test-container',
      [],
      '/workspace',
    );

    expect(args).not.toContain('--authfile');
  });
});
