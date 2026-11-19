/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'bun:test';
import {
  buildCurrentSandboxOwner,
  parseSandboxOwner,
  sandboxOwnerIsDead,
  type SandboxOwnerMetadata,
} from './sandbox-owner-labels.js';

function readNamespace(): string | undefined {
  try {
    return fs.readlinkSync('/proc/self/ns/pid');
  } catch {
    return undefined;
  }
}

const hostNamespace = readNamespace();

function deadOwner(
  overrides: Partial<SandboxOwnerMetadata> = {},
): SandboxOwnerMetadata {
  return {
    version: 1,
    hostname: os.hostname(),
    pid: spawnSync('/bin/true').pid,
    startTimeMs: Date.now(),
    startTimeSource: 'observed',
    ...overrides,
  };
}

describe('sandbox owner identity', () => {
  it.skipIf(hostNamespace === undefined)(
    'records the PID namespace of the current process',
    () => {
      expect(buildCurrentSandboxOwner().pidNamespace).toBe(hostNamespace);
    },
  );

  it.skipIf(hostNamespace === undefined)(
    'treats a missing pid in the same PID namespace as a dead owner',
    () => {
      expect(
        sandboxOwnerIsDead(deadOwner({ pidNamespace: hostNamespace })),
      ).toBe(true);
    },
  );

  it('keeps an owner whose pid is missing here but whose PID namespace differs', () => {
    expect(sandboxOwnerIsDead(deadOwner({ pidNamespace: 'pid:[1]' }))).toBe(
      false,
    );
  });

  it('judges a legacy record without a namespace by pid alone', () => {
    // Records written before the field existed keep the old pid-only check.
    expect(sandboxOwnerIsDead(deadOwner())).toBe(true);
  });

  it('round-trips the namespace through the owner label payload', () => {
    const owner = deadOwner({ pidNamespace: 'pid:[4026531836]' });

    expect(parseSandboxOwner(JSON.stringify(owner))).toStrictEqual(owner);
  });

  it('rejects an owner label whose namespace is not a non-empty string', () => {
    expect(
      parseSandboxOwner(JSON.stringify({ ...deadOwner(), pidNamespace: '' })),
    ).toBeUndefined();
    expect(
      parseSandboxOwner(JSON.stringify({ ...deadOwner(), pidNamespace: 7 })),
    ).toBeUndefined();
  });
});
