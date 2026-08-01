/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

/**
 * Typed wrapper around the CommonJS canonical module. We declare the module
 * surface locally and validate at the boundary — no `any`, no type
 * assertions. The `.cjs` is loaded via createRequire so the test exercises
 * the real production file.
 */
interface TrustedMarkerUser {
  type: string;
  login: string;
}

interface TrustedMarkerComment {
  id: number;
  body: string;
  user: TrustedMarkerUser;
}

interface OcrTrustedMarkerModule {
  OCR_DEFAULT_TRUSTED_MARKER_LOGINS: string[];
  normalizeTrustedMarkerLogin: (value: unknown) => string;
  resolveTrustedMarkerLogins: (...sources: unknown[]) => Set<string>;
  isTrustedMarkerAuthor: (user: unknown, trustedLogins: unknown) => boolean;
  isTrustedMarkerComment: (
    comment: unknown,
    trustedLogins: unknown,
    marker: unknown,
  ) => boolean;
  trustedMarkerComments: (
    comments: unknown,
    trustedLogins: unknown,
    marker: unknown,
  ) => TrustedMarkerComment[];
  canonicalMarkerComment: (
    comments: unknown,
    trustedLogins: unknown,
    marker: unknown,
  ) => TrustedMarkerComment | null;
  newestTrustedMarkerMatching: (
    comments: unknown,
    trustedLogins: unknown,
    marker: unknown,
    predicate: unknown,
  ) => TrustedMarkerComment | null;
  parseHiddenAutoCount: (body: unknown) => number;
  resolveHiddenAutoCount: (
    comments: unknown,
    trustedLogins: unknown,
    marker: unknown,
  ) => number;
}

const requireFromModule = createRequire(import.meta.url);
const rawModule = requireFromModule(
  '../../.github/scripts/ocr-trusted-marker.cjs',
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadModule(): OcrTrustedMarkerModule {
  if (!isRecord(rawModule)) {
    throw new Error('ocr-trusted-marker.cjs should export an object');
  }
  const expectedKeys: ReadonlyArray<keyof OcrTrustedMarkerModule> = [
    'OCR_DEFAULT_TRUSTED_MARKER_LOGINS',
    'normalizeTrustedMarkerLogin',
    'resolveTrustedMarkerLogins',
    'isTrustedMarkerAuthor',
    'isTrustedMarkerComment',
    'trustedMarkerComments',
    'canonicalMarkerComment',
    'newestTrustedMarkerMatching',
    'parseHiddenAutoCount',
    'resolveHiddenAutoCount',
  ];
  for (const key of expectedKeys) {
    if (!(key in rawModule)) {
      throw new Error(`ocr-trusted-marker.cjs should export ${key}`);
    }
  }
  return rawModule as unknown as OcrTrustedMarkerModule;
}

const mod = loadModule();

const MARKER = '<!-- llxprt-code-ocr-review -->';

function trustedBot(
  login: string,
  overrides: Partial<TrustedMarkerUser> = {},
): TrustedMarkerUser {
  return { type: 'Bot', login, ...overrides };
}

function markerComment(
  id: number,
  body: string,
  user: TrustedMarkerUser = trustedBot('github-actions[bot]'),
): TrustedMarkerComment {
  return { id, body, user };
}

describe('ocr-trusted-marker.cjs — normalizeTrustedMarkerLogin', () => {
  it('trims and lowercases a string login', () => {
    expect(mod.normalizeTrustedMarkerLogin('  GitHub-Actions[Bot]  ')).toBe(
      'github-actions[bot]',
    );
  });

  it('returns empty string for non-string input', () => {
    expect(mod.normalizeTrustedMarkerLogin(undefined)).toBe('');
    expect(mod.normalizeTrustedMarkerLogin(null)).toBe('');
    expect(mod.normalizeTrustedMarkerLogin(123)).toBe('');
    expect(mod.normalizeTrustedMarkerLogin({ login: 'x' })).toBe('');
  });
});

describe('ocr-trusted-marker.cjs — resolveTrustedMarkerLogins (AM4)', () => {
  it('always includes github-actions[bot] by default', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(logins.has('github-actions[bot]')).toBe(true);
  });

  it('includes the default from OCR_DEFAULT_TRUSTED_MARKER_LOGINS', () => {
    expect(mod.OCR_DEFAULT_TRUSTED_MARKER_LOGINS).toContain(
      'github-actions[bot]',
    );
    const logins = mod.resolveTrustedMarkerLogins();
    for (const login of mod.OCR_DEFAULT_TRUSTED_MARKER_LOGINS) {
      expect(logins.has(login)).toBe(true);
    }
  });

  it('adds a single OCR_BOT_LOGIN without removing defaults', () => {
    const logins = mod.resolveTrustedMarkerLogins('custom-app[bot]');
    expect(logins.has('custom-app[bot]')).toBe(true);
    expect(logins.has('github-actions[bot]')).toBe(true);
  });

  it('splits a comma-separated list', () => {
    const logins = mod.resolveTrustedMarkerLogins('app1[bot], app2[bot]');
    expect(logins.has('app1[bot]')).toBe(true);
    expect(logins.has('app2[bot]')).toBe(true);
    expect(logins.has('github-actions[bot]')).toBe(true);
  });

  it('splits a semicolon-separated list', () => {
    const logins = mod.resolveTrustedMarkerLogins('a[bot]; b[bot]');
    expect(logins.has('a[bot]')).toBe(true);
    expect(logins.has('b[bot]')).toBe(true);
  });

  it('splits a space-separated list', () => {
    const logins = mod.resolveTrustedMarkerLogins('a[bot] b[bot]');
    expect(logins.has('a[bot]')).toBe(true);
    expect(logins.has('b[bot]')).toBe(true);
  });

  it('tolerates padding and mixed case', () => {
    const logins = mod.resolveTrustedMarkerLogins(
      '  My-App[Bot] ,, Other[BOT] ',
    );
    expect(logins.has('my-app[bot]')).toBe(true);
    expect(logins.has('other[bot]')).toBe(true);
  });

  it('does not narrow the set for empty/undefined/null/number sources', () => {
    expect(mod.resolveTrustedMarkerLogins('').has('github-actions[bot]')).toBe(
      true,
    );
    expect(
      mod.resolveTrustedMarkerLogins(undefined).has('github-actions[bot]'),
    ).toBe(true);
    expect(
      mod.resolveTrustedMarkerLogins(null).has('github-actions[bot]'),
    ).toBe(true);
    expect(mod.resolveTrustedMarkerLogins(42).has('github-actions[bot]')).toBe(
      true,
    );
  });

  it('accepts an array source with normalization', () => {
    const logins = mod.resolveTrustedMarkerLogins(['A[Bot]', 'B[bot]']);
    expect(logins.has('a[bot]')).toBe(true);
    expect(logins.has('b[bot]')).toBe(true);
  });

  it('drops empty tokens', () => {
    const logins = mod.resolveTrustedMarkerLogins(',,, ,');
    expect(logins.size).toBe(1);
    expect(logins.has('github-actions[bot]')).toBe(true);
  });
});

describe('ocr-trusted-marker.cjs — isTrustedMarkerAuthor (AM5, AM6)', () => {
  it('trusts a Bot author in the trusted set', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(
      mod.isTrustedMarkerAuthor(trustedBot('github-actions[bot]'), logins),
    ).toBe(true);
  });

  it('rejects a User author even with a matching login (AM5)', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(
      mod.isTrustedMarkerAuthor(
        { type: 'User', login: 'github-actions[bot]' },
        logins,
      ),
    ).toBe(false);
  });

  it('rejects an unrelated bot (AM6)', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(
      mod.isTrustedMarkerAuthor(trustedBot('coderabbitai[bot]'), logins),
    ).toBe(false);
  });

  it('does not throw for malformed input', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(() => mod.isTrustedMarkerAuthor(null, logins)).not.toThrow();
    expect(() => mod.isTrustedMarkerAuthor(undefined, logins)).not.toThrow();
    expect(() => mod.isTrustedMarkerAuthor('string', logins)).not.toThrow();
    expect(() => mod.isTrustedMarkerAuthor({}, logins)).not.toThrow();
    expect(() =>
      mod.isTrustedMarkerAuthor({ type: 'Bot' }, logins),
    ).not.toThrow();
    expect(() => mod.isTrustedMarkerAuthor({}, 'not-a-set')).not.toThrow();
  });

  it('rejects when trustedLogins is not a Set', () => {
    expect(
      mod.isTrustedMarkerAuthor(trustedBot('github-actions[bot]'), [
        'github-actions[bot]',
      ]),
    ).toBe(false);
  });
});

describe('ocr-trusted-marker.cjs — isTrustedMarkerComment', () => {
  it('returns true for a trusted bot marker comment', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comment = markerComment(1, `${MARKER} summary`);
    expect(mod.isTrustedMarkerComment(comment, logins, MARKER)).toBe(true);
  });

  it('rejects missing user', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(
      mod.isTrustedMarkerComment({ id: 1, body: MARKER }, logins, MARKER),
    ).toBe(false);
  });

  it('rejects non-string body', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(
      mod.isTrustedMarkerComment(
        { id: 1, body: 123, user: trustedBot('github-actions[bot]') },
        logins,
        MARKER,
      ),
    ).toBe(false);
  });

  it('rejects empty marker', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comment = markerComment(1, MARKER);
    expect(mod.isTrustedMarkerComment(comment, logins, '')).toBe(false);
  });

  it('rejects a comment whose body does not include the marker', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comment = markerComment(1, 'no marker here');
    expect(mod.isTrustedMarkerComment(comment, logins, MARKER)).toBe(false);
  });

  it('does not throw for malformed input', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(() =>
      mod.isTrustedMarkerComment(null, logins, MARKER),
    ).not.toThrow();
    expect(() =>
      mod.isTrustedMarkerComment(undefined, logins, MARKER),
    ).not.toThrow();
    expect(() => mod.isTrustedMarkerComment('x', logins, MARKER)).not.toThrow();
  });
});

describe('ocr-trusted-marker.cjs — trustedMarkerComments', () => {
  it('returns trusted markers sorted ascending by id', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(300, MARKER),
      markerComment(100, MARKER),
      markerComment(200, MARKER),
    ];
    const result = mod.trustedMarkerComments(comments, logins, MARKER);
    expect(result.map((c) => c.id)).toEqual([100, 200, 300]);
  });

  it('does not mutate the input array', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [markerComment(300, MARKER), markerComment(100, MARKER)];
    const snapshot = comments.map((c) => c.id);
    mod.trustedMarkerComments(comments, logins, MARKER);
    expect(comments.map((c) => c.id)).toEqual(snapshot);
  });

  it('filters out untrusted comments', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(1, MARKER),
      markerComment(2, MARKER, trustedBot('coderabbitai[bot]')),
      markerComment(3, MARKER, { type: 'User', login: 'attacker' }),
      markerComment(4, 'no marker'),
    ];
    const result = mod.trustedMarkerComments(comments, logins, MARKER);
    expect(result.map((c) => c.id)).toEqual([1]);
  });

  it('returns empty array for non-array input', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(mod.trustedMarkerComments(null, logins, MARKER)).toEqual([]);
    expect(mod.trustedMarkerComments(undefined, logins, MARKER)).toEqual([]);
    expect(mod.trustedMarkerComments('x', logins, MARKER)).toEqual([]);
  });

  it.each([
    ['null', null],
    ['whitespace string', '  '],
    ['numeric string', '12'],
    ['zero', 0],
    ['negative', -1],
    ['MAX_SAFE_INTEGER + 1', Number.MAX_SAFE_INTEGER + 1],
  ])(
    'rejects comments with invalid id: %s',
    (_label: string, badId: unknown) => {
      const logins = mod.resolveTrustedMarkerLogins();
      const comments: unknown[] = [
        { id: badId, body: MARKER, user: trustedBot('github-actions[bot]') },
      ];
      const result = mod.trustedMarkerComments(comments, logins, MARKER);
      expect(result).toEqual([]);
    },
  );

  it('filters out comments with non-safe-integer ids', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments: unknown[] = [
      { id: 'abc', body: MARKER, user: trustedBot('github-actions[bot]') },
      { id: 50, body: MARKER, user: trustedBot('github-actions[bot]') },
      { id: 'xyz', body: MARKER, user: trustedBot('github-actions[bot]') },
      { id: 10, body: MARKER, user: trustedBot('github-actions[bot]') },
    ];
    const result = mod.trustedMarkerComments(comments, logins, MARKER);
    expect(result.map((c) => c.id)).toEqual([10, 50]);
  });

  it('deduplicates trusted markers with the same id', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const bot = trustedBot('github-actions[bot]');
    const comments: unknown[] = [
      { id: 100, body: MARKER, user: bot },
      { id: 100, body: MARKER, user: bot },
      { id: 200, body: MARKER, user: bot },
    ];
    const result = mod.trustedMarkerComments(comments, logins, MARKER);
    expect(result.map((c) => c.id)).toEqual([100, 200]);
  });
});

describe('ocr-trusted-marker.cjs — canonicalMarkerComment', () => {
  it('picks the oldest trusted marker', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(300, MARKER),
      markerComment(100, MARKER),
      markerComment(200, MARKER),
    ];
    const canonical = mod.canonicalMarkerComment(comments, logins, MARKER);
    expect(canonical?.id).toBe(100);
  });

  it('returns null when no trusted markers exist', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(1, MARKER, { type: 'User', login: 'attacker' }),
    ];
    expect(mod.canonicalMarkerComment(comments, logins, MARKER)).toBe(null);
  });

  it('returns null for empty input', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    expect(mod.canonicalMarkerComment([], logins, MARKER)).toBe(null);
  });
});

describe('ocr-trusted-marker.cjs — newestTrustedMarkerMatching', () => {
  it('picks the newest trusted marker matching the predicate', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(100, `${MARKER} count:0`),
      markerComment(200, `${MARKER} count:2`),
      markerComment(300, `${MARKER} count:0`),
    ];
    const result = mod.newestTrustedMarkerMatching(
      comments,
      logins,
      MARKER,
      (c: TrustedMarkerComment) => c.body.includes('count:2'),
    );
    expect(result?.id).toBe(200);
  });

  it('returns the newest overall when predicate is not a function', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(100, MARKER),
      markerComment(300, MARKER),
      markerComment(200, MARKER),
    ];
    const result = mod.newestTrustedMarkerMatching(
      comments,
      logins,
      MARKER,
      null,
    );
    expect(result?.id).toBe(300);
  });

  it('returns null when no marker matches the predicate', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [markerComment(100, MARKER)];
    const result = mod.newestTrustedMarkerMatching(
      comments,
      logins,
      MARKER,
      () => false,
    );
    expect(result).toBe(null);
  });
});

describe('ocr-trusted-marker.cjs — parseHiddenAutoCount', () => {
  it('parses a valid ocr-auto-count comment', () => {
    expect(mod.parseHiddenAutoCount('text <!-- ocr-auto-count:3 -->')).toBe(3);
  });

  it('returns 0 for absent input', () => {
    expect(mod.parseHiddenAutoCount('no count here')).toBe(0);
  });

  it('returns 0 for null/undefined/garbage (not NaN)', () => {
    expect(mod.parseHiddenAutoCount(null)).toBe(0);
    expect(mod.parseHiddenAutoCount(undefined)).toBe(0);
    expect(mod.parseHiddenAutoCount(123)).toBe(0);
    expect(Number.isNaN(mod.parseHiddenAutoCount('garbage'))).toBe(false);
  });

  it('handles whitespace around the number', () => {
    expect(mod.parseHiddenAutoCount('<!-- ocr-auto-count:  5  -->')).toBe(5);
  });

  it('returns 0 for a digit run that overflows to Infinity', () => {
    const hugeDigits = '9'.repeat(500);
    const result = mod.parseHiddenAutoCount(
      `<!-- ocr-auto-count:${hugeDigits} -->`,
    );
    expect(Number.isSafeInteger(result)).toBe(true);
    expect(result).toBe(0);
  });

  it('returns MAX_SAFE_INTEGER count that is still safe', () => {
    const result = mod.parseHiddenAutoCount(
      `<!-- ocr-auto-count:${Number.MAX_SAFE_INTEGER} -->`,
    );
    expect(result).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('ocr-trusted-marker.cjs — resolveHiddenAutoCount', () => {
  it('takes the maximum count when it is on a later, higher-id comment', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(100, `${MARKER}<!-- ocr-auto-count:0 -->`),
      markerComment(200, `${MARKER}<!-- ocr-auto-count:5 -->`),
    ];
    expect(mod.resolveHiddenAutoCount(comments, logins, MARKER)).toBe(5);
  });

  it('takes the maximum count when it is on the first, lower-id comment', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(100, `${MARKER}<!-- ocr-auto-count:5 -->`),
      markerComment(200, `${MARKER}<!-- ocr-auto-count:0 -->`),
    ];
    expect(mod.resolveHiddenAutoCount(comments, logins, MARKER)).toBe(5);
  });

  it('returns 0 when no trusted markers carry a count', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [markerComment(100, `${MARKER} no count`)];
    expect(mod.resolveHiddenAutoCount(comments, logins, MARKER)).toBe(0);
  });

  it('ignores untrusted comments', () => {
    const logins = mod.resolveTrustedMarkerLogins();
    const comments = [
      markerComment(100, `${MARKER}<!-- ocr-auto-count:9 -->`, {
        type: 'User',
        login: 'attacker',
      }),
    ];
    expect(mod.resolveHiddenAutoCount(comments, logins, MARKER)).toBe(0);
  });
});
