/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  FatalSandboxError,
  type SandboxConfig,
} from '@vybestack/llxprt-code-core';
import { buildContainerRunArgs } from './sandbox-containers.js';

const ORIGINAL_ENV = { ...process.env };
const scratch: string[] = [];

function runArgs(config: SandboxConfig): string[] {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1c-container-'));
  scratch.push(workdir);
  return buildContainerRunArgs(
    config,
    'test-image',
    workdir,
    '/workspace',
    workdir,
  );
}

function deviceOperands(args: readonly string[]): string[] {
  return args.flatMap((arg, index) =>
    arg === '--device' ? [args[index + 1]] : [],
  );
}

const hostDriNodes = fs.existsSync('/dev/dri')
  ? fs
      .readdirSync('/dev/dri')
      .map((name) => `/dev/dri/${name}`)
      .filter((node) => fs.lstatSync(node).isCharacterDevice())
      .sort()
  : [];

const notLinux = process.platform !== 'linux';

describe('container device grants', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SANDBOX_FLAGS;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    for (const directory of scratch.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.skipIf(notLinux)(
    'sends one same-path read-write device operand per granted node',
    () => {
      const args = runArgs({
        command: 'docker',
        image: 'test-image',
        devices: ['/dev/null', '/dev/zero'],
      });

      expect(deviceOperands(args)).toStrictEqual([
        '/dev/null:/dev/null:rw',
        '/dev/zero:/dev/zero:rw',
      ]);
    },
  );

  it.skipIf(notLinux)(
    'grants devices without privileged mode or a raw /dev volume',
    () => {
      const args = runArgs({
        command: 'podman',
        image: 'test-image',
        devices: ['/dev/null'],
      });

      expect(args).not.toContain('--privileged');
      expect(args.filter((arg) => arg.startsWith('/dev:'))).toStrictEqual([]);
      expect(args).not.toContain('/dev');
    },
  );

  it.skipIf(notLinux)('adds no device operands when none are granted', () => {
    expect(
      deviceOperands(runArgs({ command: 'docker', image: 'test-image' })),
    ).toStrictEqual([]);
    expect(
      deviceOperands(
        runArgs({ command: 'docker', image: 'test-image', devices: [] }),
      ),
    ).toStrictEqual([]);
  });

  it.skipIf(notLinux || hostDriNodes.length === 0)(
    'expands the dri directory into the host character nodes in stable order',
    () => {
      const args = runArgs({
        command: 'docker',
        image: 'test-image',
        devices: ['/dev/dri'],
      });

      expect(deviceOperands(args)).toStrictEqual(
        hostDriNodes.map((node) => `${node}:${node}:rw`),
      );
    },
  );

  it.skipIf(notLinux)(
    'fails before building a launch when a granted device is missing',
    () => {
      expect(() =>
        runArgs({
          command: 'docker',
          image: 'test-image',
          devices: ['/dev/phase1c-missing-device'],
        }),
      ).toThrow(FatalSandboxError);
    },
  );
});
