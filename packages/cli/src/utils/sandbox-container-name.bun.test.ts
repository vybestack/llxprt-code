/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { automock } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'bun:test';
import { execFileSync, execSync } from 'node:child_process';
import os from 'node:os';
import type { SandboxConfig } from '@vybestack/llxprt-code-core';
import { assignContainerName } from './sandbox-containers.js';

const realNodeChildProcessModule = {
  ...(await import('node:child_process')),
};

void vi.mock('node:child_process', () => ({
  ...automock(realNodeChildProcessModule),
  execFileSync: realNodeChildProcessModule.execFileSync,
}));

const config = {
  command: 'podman',
  image: 'ghcr.io/vybestack/llxprt-code/sandbox:0.11.0',
} as const;

function stubContainerNames(names: readonly string[]): void {
  (execSync as Mock<typeof execSync>).mockReturnValue(names.join('\n'));
}

// Snapshot the real descriptor once so every stubbed pid is restored.
const realPidDescriptor = Object.getOwnPropertyDescriptor(process, 'pid');

function stubPid(value: number): void {
  Object.defineProperty(process, 'pid', { value, configurable: true });
}

function readEstimatedStartTime(owner: unknown): number {
  if (
    typeof owner !== 'object' ||
    owner === null ||
    !('startTimeMs' in owner) ||
    typeof owner.startTimeMs !== 'number'
  ) {
    throw new Error('Sandbox owner start time was not numeric');
  }
  return owner.startTimeMs;
}

describe('assignContainerName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (realPidDescriptor) {
      Object.defineProperty(process, 'pid', realPidDescriptor);
    }
  });

  it('keeps non-stubbed child-process execution real', () => {
    const version = execFileSync(process.execPath, ['--version'], {
      encoding: 'utf8',
    });
    const bunVersion = process.versions.bun;
    if (bunVersion === undefined) {
      throw new Error('This Bun test did not run under Bun');
    }

    expect(version.trim()).toBe(bunVersion);
  });

  it('claims distinct names for concurrent launches that see the same runtime snapshot', () => {
    // Two launches racing: both list existing containers before either
    // container exists, so both see the identical (empty) name set.
    stubContainerNames([]);
    stubPid(111);
    const first = assignContainerName([], config, config.image);
    stubPid(222);
    const second = assignContainerName([], config, config.image);

    expect(first).not.toBe(second);
  });

  it('skips names still held by stale containers that share the pid', () => {
    const pid = process.pid;
    stubContainerNames([`sandbox-0.11.0-${pid}`]);
    const args: string[] = [];
    const name = assignContainerName(args, config, config.image);
    expect(name).toBe(`sandbox-0.11.0-${pid}-1`);
  });

  it('claims the exact base name when only a longer prefix-sharing name exists', () => {
    // A substring check would see `sandbox-0.11.0-111` as occupying
    // `sandbox-0.11.0-11` and needlessly flee to the -2 suffix.
    stubPid(11);
    stubContainerNames(['sandbox-0.11.0-111', 'unrelated']);
    const name = assignContainerName([], config, config.image);
    expect(name).toBe('sandbox-0.11.0-11');
  });

  it('passes the claimed name as both --name and --hostname', () => {
    stubContainerNames([]);
    const args: string[] = [];
    const name = assignContainerName(args, config, config.image);
    const nameIdx = args.indexOf('--name');

    const hostIdx = args.indexOf('--hostname');
    expect(args[nameIdx + 1]).toBe(name);
    expect(args[hostIdx + 1]).toBe(name);
  });

  it.each(['docker', 'podman'])(
    '%s main containers receive ownership labels',
    (command) => {
      stubContainerNames([]);
      const args: string[] = [];
      const engineConfig: SandboxConfig = { ...config, command };

      const name = assignContainerName(args, engineConfig, engineConfig.image);

      const labels = args.flatMap((arg, index) =>
        arg === '--label' ? [args[index + 1]] : [],
      );
      const ownerLabel = labels.find((label) =>
        label.startsWith('com.vybestack.llxprt.sandbox-owner='),
      );
      if (ownerLabel === undefined) {
        throw new Error('Sandbox owner label was not emitted');
      }
      const ownerPayload = ownerLabel.slice(ownerLabel.indexOf('=') + 1);
      const owner: unknown = JSON.parse(ownerPayload);
      expect({ labels, owner, nameArgs: args.slice(-4) }).toStrictEqual({
        labels: expect.arrayContaining([
          'com.vybestack.llxprt.sandbox-managed=true',
        ]),
        owner: expect.objectContaining({
          version: 1,
          hostname: os.hostname(),
          pid: process.pid,
          startTimeMs: expect.any(Number),
          startTimeSource: expect.stringMatching(/^(observed|estimated)$/),
        }),
        nameArgs: ['--name', name, '--hostname', name],
      });
    },
  );

  it('uses estimated owner identity when process start observation is unavailable', () => {
    stubContainerNames([]);
    const originalPath = process.env.PATH;
    process.env.PATH = '/llxprt-test-no-executables';
    const args: string[] = [];
    const toleranceMs = 30_000;
    const earliestStartTimeMs =
      Date.now() - process.uptime() * 1000 - toleranceMs;

    try {
      assignContainerName(args, config, config.image);
    } finally {
      process.env.PATH = originalPath;
    }
    const latestStartTimeMs =
      Date.now() - process.uptime() * 1000 + toleranceMs;

    const ownerLabel = args.find((arg) =>
      arg.startsWith('com.vybestack.llxprt.sandbox-owner='),
    );
    if (ownerLabel === undefined) {
      throw new Error('Sandbox owner label was not emitted');
    }
    const owner: unknown = JSON.parse(
      ownerLabel.slice(ownerLabel.indexOf('=') + 1),
    );
    const estimatedStartTimeMs = readEstimatedStartTime(owner);
    expect(owner).toStrictEqual(
      expect.objectContaining({
        pid: process.pid,
        startTimeSource: 'estimated',
      }),
    );
    expect(estimatedStartTimeMs).toBeGreaterThanOrEqual(earliestStartTimeMs);
    expect(estimatedStartTimeMs).toBeLessThanOrEqual(latestStartTimeMs);
  });
});
