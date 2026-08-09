/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'bun:test';
import * as os from 'node:os';
import {
  _resetProcessStartTimeForTests,
  buildOwnerMetadata,
  buildCurrentProcessOwnerMetadata,
  getProcessStartTimeMs,
  parseOwnerMetadata,
  probeOwnerLiveness,
  serializeOwnerMetadata,
  type LockOwnerMetadata,
} from '../lock-owner.js';

describe('LockOwnerMetadata startTimeSource quality (issue #2819)', () => {
  it('records canonical startTimeSource when OS-observed start time is available', async () => {
    const owner = await buildCurrentProcessOwnerMetadata();
    expect(owner.startTimeSource).toBeDefined();
    expect(['canonical', 'approximate', 'unavailable']).toContain(
      owner.startTimeSource,
    );
  });

  it('re-probes after an approximate result and caches only a canonical result', async () => {
    _resetProcessStartTimeForTests();
    const canonicalStartTime = 1_725_000_000_000;
    let probeCount = 0;
    const readProcessStartTime = async (): Promise<number | null> => {
      probeCount += 1;
      return probeCount === 1 ? null : canonicalStartTime;
    };

    const first = await buildCurrentProcessOwnerMetadata(
      250,
      readProcessStartTime,
    );
    const second = await buildCurrentProcessOwnerMetadata(
      250,
      readProcessStartTime,
    );
    const third = await buildCurrentProcessOwnerMetadata(
      250,
      readProcessStartTime,
    );

    expect(first.startTimeSource).toBe('approximate');
    expect(second).toMatchObject({
      startTimeMs: canonicalStartTime,
      startTimeSource: 'canonical',
    });
    expect(third).toMatchObject({
      startTimeMs: canonicalStartTime,
      startTimeSource: 'canonical',
    });
    expect(probeCount).toBe(2);
  });

  it('marks owner as dead only when startTimeSource is canonical and start-time mismatch proves PID reuse', async () => {
    const kill = vi.fn();
    const liveness = await probeOwnerLiveness(
      {
        version: 1,
        ownerToken: 'old-owner',
        pid: 4242,
        hostname: os.hostname(),
        startTimeMs: 1000,
        startTimeSource: 'canonical',
      },
      {
        currentHostname: os.hostname(),
        currentPid: 9999,
        kill,
        getProcessStartTimeMs: async () => 5000,
      },
    );
    expect(liveness.status).toBe('dead');
  });

  it('does NOT mark an owner dead when startTimeSource is approximate and start-time mismatches', async () => {
    const kill = vi.fn();
    const liveness = await probeOwnerLiveness(
      {
        version: 1,
        ownerToken: 'approx-owner',
        pid: 4242,
        hostname: os.hostname(),
        startTimeMs: 1000,
        startTimeSource: 'approximate',
      },
      {
        currentHostname: os.hostname(),
        currentPid: 9999,
        kill,
        getProcessStartTimeMs: async () => 5000,
      },
    );
    expect(liveness.status).toBe('unverifiable');
  });

  it('still marks an owner dead via ESRCH even with approximate startTimeSource', async () => {
    const kill = vi.fn(() => {
      const err: NodeJS.ErrnoException = new Error('No such process');
      err.code = 'ESRCH';
      throw err;
    });
    const liveness = await probeOwnerLiveness(
      {
        version: 1,
        ownerToken: 'esrch-owner',
        pid: 4242,
        hostname: os.hostname(),
        startTimeMs: 1000,
        startTimeSource: 'approximate',
      },
      {
        currentHostname: os.hostname(),
        currentPid: 9999,
        kill,
      },
    );
    expect(liveness.status).toBe('dead');
  });

  it('treats an owner with unavailable startTimeSource as unverifiable (not dead) on start-time mismatch', async () => {
    const kill = vi.fn();
    const liveness = await probeOwnerLiveness(
      {
        version: 1,
        ownerToken: 'no-start-owner',
        pid: 4242,
        hostname: os.hostname(),
        startTimeMs: 1000,
        startTimeSource: 'unavailable',
      },
      {
        currentHostname: os.hostname(),
        currentPid: 9999,
        kill,
        getProcessStartTimeMs: async () => 5000,
      },
    );
    expect(liveness.status).toBe('unverifiable');
  });

  it('serializes and parses startTimeSource round-trip', () => {
    const owner: LockOwnerMetadata = {
      version: 1,
      ownerToken: 'roundtrip-owner',
      pid: 4242,
      hostname: os.hostname(),
      startTimeMs: 5000,
      startTimeSource: 'canonical',
    };
    const serialized = serializeOwnerMetadata(owner);
    const parsed = parseOwnerMetadata(serialized);
    expect(parsed).toStrictEqual(owner);
  });

  it('defaults an invalid startTimeSource to approximate (preventing PID-reuse proof)', () => {
    const owner = buildOwnerMetadata(getProcessStartTimeMs());
    const parsed = parseOwnerMetadata(
      JSON.stringify({ ...owner, startTimeSource: 'bogus' }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.startTimeSource).toBe('approximate');
  });
});
