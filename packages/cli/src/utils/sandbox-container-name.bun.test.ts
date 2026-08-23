/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'bun:test';
import { execSync } from 'node:child_process';
import { assignContainerName } from './sandbox-containers.js';

// Only execSync is stubbed: it is the process-launching boundary that queries
// the container runtime for existing names. Everything under test is real.
void vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
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

  it('passes the claimed name as both --name and --hostname', () => {
    stubContainerNames([]);
    const args: string[] = [];
    const name = assignContainerName(args, config, config.image);
    const nameIdx = args.indexOf('--name');
    const hostIdx = args.indexOf('--hostname');
    expect(args[nameIdx + 1]).toBe(name);
    expect(args[hostIdx + 1]).toBe(name);
  });
});
