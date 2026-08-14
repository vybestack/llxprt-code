/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the portable file request channel (scripts/memory/request.ts).
 * Exercises real production functions against temp directories: no mocks of
 * internal logic, only a real temp filesystem.
 */

import { describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { isPosixPlatform } from '../../memory/perms.ts';
import {
  DEFAULT_STALE_MS,
  REQUEST_ID_MAX_LENGTH,
  REQUEST_ID_PATTERN,
  REQUEST_TEMP_MAX_AGE_MS,
  REQUEST_VERSION,
  type RequestKind,
  claimNextRequest,
  cleanStaleRequestTemps,
  finishRequest,
  isValidRequestId,
  makeRequestId,
  queueRequest,
  validateRequest,
  type MemRequest,
} from '../../memory/request.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'memprobe-req-'));
}

const fixedNow = () => 1_700_000_000_000;

describe('queueRequest — atomic unique request creation', () => {
  it('publishes a single valid .json request and leaves no temp file', () => {
    const dir = tempDir();
    try {
      const queued = queueRequest('sample', {
        requestDir: dir,
        now: fixedNow,
        random: () => 0.5,
        pid: 4242,
      });
      const files = readdirSync(dir);
      expect(files).toHaveLength(1);
      expect(files[0]).toEndWith('.json');
      const parsed = JSON.parse(
        readFileSync(queued.path, 'utf8'),
      ) as MemRequest;
      expect(parsed.version).toBe(REQUEST_VERSION);
      expect(parsed.kind).toBe('sample');
      expect(parsed.id.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('produces unique ids and files for repeated calls', () => {
    const dir = tempDir();
    try {
      const a = queueRequest('sample', {
        requestDir: dir,
        now: fixedNow,
        random: () => 0.1,
        pid: 1,
      });
      const b = queueRequest('snapshot', {
        requestDir: dir,
        now: fixedNow,
        random: () => 0.2,
        pid: 1,
      });
      expect(a.request.id).not.toBe(b.request.id);
      expect(a.path).not.toBe(b.path);
      expect(readdirSync(dir)).toHaveLength(2);
      expect(a.request.kind).toBe('sample');
      expect(b.request.kind).toBe('snapshot');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('claimNextRequest / finishRequest — exactly-once claim', () => {
  it('claims a published request once, then reports nothing pending', () => {
    const dir = tempDir();
    try {
      queueRequest('sample', {
        requestDir: dir,
        now: fixedNow,
        random: () => 0.3,
        pid: 1,
      });
      const first = claimNextRequest(dir);
      expect(first).not.toBeNull();
      const second = claimNextRequest(dir);
      expect(second).toBeNull();
      finishRequest(first!.path);
      expect(claimNextRequest(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing directory', () => {
    expect(
      claimNextRequest(join(tmpdir(), 'definitely-missing-dir')),
    ).toBeNull();
  });
});

describe('makeRequestId — grammar, uniqueness, and path safety', () => {
  it('embeds the producing pid and stays inside the bounded grammar', () => {
    const id = makeRequestId(fixedNow(), 4242, 0.4);
    expect(isValidRequestId(id)).toBe(true);
    expect(id).toContain(`p${(4242).toString(36)}`);
  });

  it('returns distinct ids even for equal inputs via an internal counter', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(makeRequestId(fixedNow(), 7, 0.4));
    }
    expect(ids.size).toBe(50);
  });

  it('every derived path stays inside the request directory', () => {
    // Provable containment: an ID that validates can only be a plain file
    // name, so join(dir, `${id}.json`), the claimed variant, and the done
    // marker are all direct children of their intended directories.
    const dir = tempDir();
    try {
      const queued = queueRequest('sample', {
        requestDir: dir,
        now: fixedNow,
        random: () => 0.5,
        pid: 9,
      });
      expect(dirname(queued.path)).toBe(dir);
      expect(queued.path.startsWith(dir + sep)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isValidRequestId — the bounded grammar gate', () => {
  it('accepts multi-segment alphanumeric ids', () => {
    expect(isValidRequestId('abc-1')).toBe(true);
    expect(isValidRequestId('l3z0k0-pabc-1-0zz')).toBe(true);
  });

  it('rejects single segments and empty ids', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('abc')).toBe(false);
  });

  it('rejects POSIX and Windows separators (traversal)', () => {
    expect(isValidRequestId('a/b')).toBe(false);
    expect(isValidRequestId('a\\b')).toBe(false);
    expect(isValidRequestId('..')).toBe(false);
    expect(isValidRequestId('a/../b')).toBe(false);
  });

  it('rejects drive-like forms and colons', () => {
    expect(isValidRequestId('C:tmp')).toBe(false);
    expect(isValidRequestId('c-sys-temp')).toBe(true); // colon-free is fine
  });

  it('rejects dot segments, doubled hyphens, and leading/trailing hyphens', () => {
    expect(isValidRequestId('.')).toBe(false);
    expect(isValidRequestId('a.')).toBe(false);
    expect(isValidRequestId('.a-b')).toBe(false);
    expect(isValidRequestId('a--b')).toBe(false);
    expect(isValidRequestId('-a-b')).toBe(false);
    expect(isValidRequestId('a-b-')).toBe(false);
  });

  it('rejects uppercase, whitespace, and oversized ids', () => {
    expect(isValidRequestId('Abc-1')).toBe(false);
    expect(isValidRequestId('a b')).toBe(false);
    expect(isValidRequestId('a\nb')).toBe(false);
    const tooLong = 'a'.repeat(REQUEST_ID_MAX_LENGTH) + '-b';
    expect(tooLong.length).toBeGreaterThan(REQUEST_ID_MAX_LENGTH);
    expect(isValidRequestId(tooLong)).toBe(false);
    expect(REQUEST_ID_PATTERN.test('a-b')).toBe(true);
  });
});

describe('validateRequest — schema, staleness, and ID security', () => {
  const valid = (overrides: Partial<MemRequest> = {}): unknown => ({
    version: REQUEST_VERSION,
    id: 'abc-1',
    createdAt: fixedNow(),
    kind: 'sample' as RequestKind,
    ...overrides,
  });
  const opts = { now: fixedNow, staleMs: DEFAULT_STALE_MS };

  it('accepts a well-formed current request', () => {
    const req = validateRequest(valid(), opts);
    expect(req.kind).toBe('sample');
    expect(req.id).toBe('abc-1');
  });

  it('accepts a request exactly at the staleness boundary', () => {
    const boundary = valid({ createdAt: fixedNow() - DEFAULT_STALE_MS });
    expect(() => validateRequest(boundary, opts)).not.toThrow();
  });

  it('rejects a non-object', () => {
    expect(() => validateRequest('nope', opts)).toThrow();
    expect(() => validateRequest(null, opts)).toThrow();
  });

  it('rejects a wrong version', () => {
    expect(() => validateRequest(valid({ version: 99 }), opts)).toThrow(
      /version/,
    );
  });

  it('rejects an empty or missing id', () => {
    expect(() => validateRequest(valid({ id: '' }), opts)).toThrow(/id/);
    expect(() =>
      validateRequest({ version: 1, createdAt: 1, kind: 'sample' }, opts),
    ).toThrow(/id/);
  });

  it('rejects an id outside the grammar as malformed (path safety)', () => {
    for (const id of [
      '../escape',
      '..\\escape',
      'C:\\evil',
      'a/b',
      'a.b',
      'UPPER-case',
      'a b',
      'x'.repeat(200) + '-y',
    ]) {
      expect(() => validateRequest(valid({ id }), opts)).toThrow(
        /malformed|id/,
      );
    }
  });

  it('rejects an unknown kind', () => {
    expect(() =>
      validateRequest(valid({ kind: 'restart' as RequestKind }), opts),
    ).toThrow(/kind/);
  });

  it('rejects a stale request', () => {
    const stale = valid({ createdAt: fixedNow() - DEFAULT_STALE_MS - 1 });
    expect(() => validateRequest(stale, opts)).toThrow(/stale/);
  });

  it('rejects an implausibly future-dated request', () => {
    const future = valid({ createdAt: fixedNow() + DEFAULT_STALE_MS + 1 });
    expect(() => validateRequest(future, opts)).toThrow(/future/);
  });

  it('ignores an absent requests directory without throwing', () => {
    const gone = join(tmpdir(), 'no-such-req-dir');
    expect(existsSync(gone)).toBe(false);
    expect(claimNextRequest(gone)).toBeNull();
  });
});

describe('cleanStaleRequestTemps — injected-time temp cleanup', () => {
  it('removes only temp files older than the cutoff', () => {
    const dir = tempDir();
    try {
      const now = fixedNow();
      const fresh = join(dir, 'req-fresh.json.1.tmp');
      const stale = join(dir, 'req-stale.json.1.tmp');
      writeFileSync(fresh, '{}');
      writeFileSync(stale, '{}');
      const longAgo = new Date(now - REQUEST_TEMP_MAX_AGE_MS - 5_000);
      utimesSync(stale, longAgo, longAgo);
      const kept = join(dir, 'keep.json');
      writeFileSync(kept, '{}');
      expect(cleanStaleRequestTemps(dir, now, REQUEST_TEMP_MAX_AGE_MS)).toBe(1);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(fresh)).toBe(true);
      expect(existsSync(kept)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns zero for a missing directory', () => {
    expect(
      cleanStaleRequestTemps(
        join(tmpdir(), 'definitely-missing-temps'),
        fixedNow(),
        REQUEST_TEMP_MAX_AGE_MS,
      ),
    ).toBe(0);
  });
});

describe('claim-read failure — recoverable, claim not destroyed', () => {
  it.skipIf(!isPosixPlatform())(
    'restores the request to .json when the claimed file cannot be read',
    () => {
      const dir = tempDir();
      try {
        const queued = queueRequest('sample', {
          requestDir: dir,
          now: fixedNow,
          random: () => 0.5,
          pid: 1,
        });
        // A concurrent claim that leaves an unreadable .claimed file (a
        // genuinely external filesystem condition) must not delete work: the
        // error propagates and the request stays recoverable.
        chmodSync(queued.path, 0o000);
        expect(() => claimNextRequest(dir)).toThrow();
        // Restore readability; the file must still exist in some recoverable
        // form (.json restored, or .claimed preserved for startup recovery).
        const names = readdirSync(dir).filter(
          (n) => n.endsWith('.json') || n.endsWith('.claimed'),
        );
        expect(names).toHaveLength(1);
        expect(names[0]).toEndWith('.json');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
