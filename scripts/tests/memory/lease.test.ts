/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the portable probe lease (scripts/memory/lease.ts).
 * Real production functions run against real temp directories; only the
 * clock is injected. No signals, process.kill, sockets, or shells appear in
 * the lease itself — liveness is decided purely by file state and time.
 */

import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type LeaseDeps,
  LEASE_FILE_NAME,
  LEASE_STALE_MS,
  acquireLease,
  checkLease,
  defaultLeaseDeps,
  leasePath,
  makeLeaseOwner,
  parseLease,
  releaseLease,
  renewLease,
} from '../../memory/lease.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'memprobe-lease-'));
}

/** Real filesystem deps with an injected clock and fixed identity. */
function clockDeps(at: number, pid = 4242): LeaseDeps {
  return {
    ...defaultLeaseDeps,
    now: () => at,
    pid: () => pid,
    random: () => 0.42,
  };
}

describe('parseLease — strict record validation', () => {
  it('accepts a well-formed record', () => {
    const lease = parseLease(
      JSON.stringify({ owner: 'pab-000abc', pid: 4242, heartbeatAt: 1000 }),
    );
    expect(lease).not.toBeNull();
    expect(lease?.owner).toBe('pab-000abc');
    expect(lease?.pid).toBe(4242);
  });

  it('rejects malformed JSON, wrong shapes, and bad fields', () => {
    expect(parseLease('not-json{')).toBeNull();
    expect(parseLease('"a string"')).toBeNull();
    expect(parseLease('[]')).toBeNull();
    expect(parseLease('{}')).toBeNull();
    // Bad owner grammar (path-significant characters rejected).
    expect(
      parseLease(JSON.stringify({ owner: '../evil', pid: 1, heartbeatAt: 1 })),
    ).toBeNull();
    expect(
      parseLease(JSON.stringify({ owner: 'a\\b', pid: 1, heartbeatAt: 1 })),
    ).toBeNull();
    // Non-integer/nonpositive pid.
    expect(
      parseLease(
        JSON.stringify({ owner: 'pab-000abc', pid: 1.5, heartbeatAt: 1 }),
      ),
    ).toBeNull();
    expect(
      parseLease(
        JSON.stringify({ owner: 'pab-000abc', pid: 0, heartbeatAt: 1 }),
      ),
    ).toBeNull();
    // Non-finite heartbeat.
    expect(
      parseLease(
        JSON.stringify({ owner: 'pab-000abc', pid: 1, heartbeatAt: 'x' }),
      ),
    ).toBeNull();
  });
});

describe('checkLease — status classification', () => {
  it('reports missing when no lease file exists', () => {
    const dir = tempDir();
    try {
      expect(checkLease(dir).status).toBe('missing');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports active while the heartbeat is fresh', () => {
    const dir = tempDir();
    try {
      const now = 1_700_000_000_000;
      writeFileSync(
        leasePath(dir),
        JSON.stringify({
          owner: 'pab-000abc',
          pid: 9,
          heartbeatAt: now - 1000,
        }),
      );
      const check = checkLease(dir, clockDeps(now));
      expect(check.status).toBe('active');
      expect(check.lease?.owner).toBe('pab-000abc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports stale when the heartbeat is older than LEASE_STALE_MS', () => {
    const dir = tempDir();
    try {
      const now = 1_700_000_000_000;
      writeFileSync(
        leasePath(dir),
        JSON.stringify({
          owner: 'pab-000abc',
          pid: 9,
          heartbeatAt: now - LEASE_STALE_MS - 1,
        }),
      );
      expect(checkLease(dir, clockDeps(now)).status).toBe('stale');
      // Exactly at the boundary it is still active.
      writeFileSync(
        leasePath(dir),
        JSON.stringify({
          owner: 'pab-000abc',
          pid: 9,
          heartbeatAt: now - LEASE_STALE_MS,
        }),
      );
      expect(checkLease(dir, clockDeps(now)).status).toBe('active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports malformed for garbage lease contents', () => {
    const dir = tempDir();
    try {
      writeFileSync(leasePath(dir), 'garbage{');
      expect(checkLease(dir).status).toBe('malformed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports unreadable when the file cannot be read (external fs failure)', () => {
    const dir = tempDir();
    try {
      const throwing: LeaseDeps = {
        ...clockDeps(1),
        exists: () => true,
        readFile: () => {
          throw new Error('EACCES: permission denied');
        },
      };
      expect(checkLease(dir, throwing).status).toBe('unreadable');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('acquireLease — ownership races', () => {
  it('acquires a missing lease and records the owner', () => {
    const dir = tempDir();
    try {
      const now = 1_700_000_000_000;
      const result = acquireLease(dir, clockDeps(now, 4242));
      expect(result.outcome).toBe('acquired');
      if (result.outcome === 'acquired') {
        expect(result.lease.pid).toBe(4242);
      }
      const check = checkLease(dir, clockDeps(now));
      expect(check.status).toBe('active');
      expect(check.lease?.pid).toBe(4242);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses when a fresh lease names another owner (live competing probe)', () => {
    const dir = tempDir();
    try {
      const now = 1_700_000_000_000;
      const first = acquireLease(dir, clockDeps(now, 111));
      expect(first.outcome).toBe('acquired');
      // A second probe with a different pid tries to take over immediately.
      const second = acquireLease(dir, clockDeps(now, 222));
      expect(second.outcome).toBe('refused');
      if (second.outcome === 'refused') {
        expect(second.check.status).toBe('active');
      }
      // The first probe still owns the directory.
      const check = checkLease(dir, clockDeps(now));
      expect(check.lease?.pid).toBe(111);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses on an unreadable lease (could be a live probe hidden by an fs error)', () => {
    const dir = tempDir();
    try {
      writeFileSync(leasePath(dir), JSON.stringify({ owner: 'x', pid: 1 }));
      const deps: LeaseDeps = {
        ...clockDeps(1, 222),
        exists: () => true,
        readFile: () => {
          throw new Error('EIO');
        },
      };
      expect(acquireLease(dir, deps).outcome).toBe('refused');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a stale lease (dead probe)', () => {
    const dir = tempDir();
    try {
      const now = 1_700_000_000_000;
      writeFileSync(
        leasePath(dir),
        JSON.stringify({
          owner: 'pdead-000111',
          pid: 111,
          heartbeatAt: now - LEASE_STALE_MS - 1,
        }),
      );
      const result = acquireLease(dir, clockDeps(now, 222));
      expect(result.outcome).toBe('acquired');
      expect(checkLease(dir, clockDeps(now)).lease?.pid).toBe(222);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a malformed lease', () => {
    const dir = tempDir();
    try {
      writeFileSync(leasePath(dir), '{corrupt');
      expect(acquireLease(dir, clockDeps(1, 222)).outcome).toBe('acquired');
      expect(checkLease(dir, clockDeps(1)).status).toBe('active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishes the lease atomically: no temp file remains', () => {
    const dir = tempDir();
    try {
      acquireLease(dir, clockDeps(1_700_000_000_000, 4242));
      const names = existsSync(leasePath(dir));
      expect(names).toBe(true);
      const raw = JSON.parse(readFileSync(leasePath(dir), 'utf8')) as {
        owner: string;
      };
      expect(raw.owner).toBe(makeLeaseOwner(4242, () => 0.42));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renewLease — owner-safe heartbeats', () => {
  it('refreshes the heartbeat for the owner', () => {
    const dir = tempDir();
    try {
      const t0 = 1_700_000_000_000;
      const acquired = acquireLease(dir, clockDeps(t0, 111));
      expect(acquired.outcome).toBe('acquired');
      if (acquired.outcome !== 'acquired') {
        return;
      }
      const t1 = t0 + 5_000;
      expect(renewLease(dir, acquired.lease.owner, clockDeps(t1, 111))).toBe(
        'renewed',
      );
      expect(checkLease(dir, clockDeps(t1)).lease?.heartbeatAt).toBe(t1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports ownership loss when another owner now holds the lease', () => {
    const dir = tempDir();
    try {
      const t0 = 1_700_000_000_000;
      writeFileSync(
        leasePath(dir),
        JSON.stringify({
          owner: 'pother-000222',
          pid: 222,
          heartbeatAt: t0,
        }),
      );
      expect(renewLease(dir, 'pme-000111', clockDeps(t0, 111))).toBe('lost');
      // The other owner's record is untouched.
      expect(checkLease(dir, clockDeps(t0)).lease?.pid).toBe(222);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-publishes a vanished lease and keeps ownership', () => {
    const dir = tempDir();
    try {
      const t0 = 1_700_000_000_000;
      const acquired = acquireLease(dir, clockDeps(t0, 111));
      if (acquired.outcome !== 'acquired') {
        throw new Error('expected acquisition');
      }
      // External deletion of the lease file.
      rmSync(leasePath(dir));
      expect(checkLease(dir).status).toBe('missing');
      expect(renewLease(dir, acquired.lease.owner, clockDeps(t0, 111))).toBe(
        'renewed',
      );
      expect(checkLease(dir, clockDeps(t0)).lease?.pid).toBe(111);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports malformed lease state as indeterminate', () => {
    const dir = tempDir();
    try {
      writeFileSync(leasePath(dir), '{bad json');
      expect(renewLease(dir, 'pme-000111', clockDeps(1, 111))).toBe(
        'indeterminate',
      );
      expect(readFileSync(leasePath(dir), 'utf8')).toBe('{bad json');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports unreadable lease state as indeterminate', () => {
    const dir = tempDir();
    try {
      writeFileSync(
        leasePath(dir),
        JSON.stringify({ owner: 'pme-000111', pid: 111, heartbeatAt: 1 }),
      );
      const deps: LeaseDeps = {
        ...clockDeps(1, 111),
        readFile: () => {
          throw new Error('access denied');
        },
      };
      expect(renewLease(dir, 'pme-000111', deps)).toBe('indeterminate');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('releaseLease — owner-checked cleanup on normal exit', () => {
  it('removes the lease only for its owner', () => {
    const dir = tempDir();
    try {
      const t0 = 1_700_000_000_000;
      const acquired = acquireLease(dir, clockDeps(t0, 111));
      if (acquired.outcome !== 'acquired') {
        throw new Error('expected acquisition');
      }
      // A foreign "release" must not delete a live probe's lease.
      releaseLease(dir, 'pother-000222', clockDeps(t0, 222));
      expect(checkLease(dir, clockDeps(t0)).status).toBe('active');
      // The owner's release removes it.
      releaseLease(dir, acquired.lease.owner, clockDeps(t0, 111));
      expect(existsSync(join(dir, LEASE_FILE_NAME))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when no lease exists', () => {
    const dir = tempDir();
    try {
      expect(() => releaseLease(dir, 'pab-000abc', clockDeps(1))).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
