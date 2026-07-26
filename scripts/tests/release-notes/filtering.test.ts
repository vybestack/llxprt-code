/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  isProcessNoise,
  parseRefs,
  extractPrIdentity,
} from '../../release-notes/filtering.js';
import type { RawCommit } from '../../release-notes/types.js';

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: 'abcdef0',
    subject: 'fix: something broke',
    author: 'dev',
    isMerge: false,
    parents: [],
    ...overrides,
  };
}

describe('isProcessNoise', () => {
  it('detects CodeRabbit review fixups', () => {
    expect(
      isProcessNoise(makeCommit({ subject: 'Apply CodeRabbit suggestions' })),
    ).toBe(true);
  });

  it.each([
    'fix OCR review findings',
    'refactor: address OCR round 2 findings',
    'fix(test): address Bun migration review findings',
    'Zed ACP: address OCR and CodeRabbit review findings',
    'fix(config): address follow-up migration review findings',
  ])('detects review fixup %s', (subject) => {
    expect(isProcessNoise(makeCommit({ subject }))).toBe(true);
  });

  it.each([
    'lint: fix formatting',
    'style: prettier run',
    'chore: fix lint',
    'fix: lint formatting',
    'chore(format): run prettier',
  ])('detects lint/format process noise: %s', (subject) => {
    expect(isProcessNoise(makeCommit({ subject }))).toBe(true);
  });

  it('detects CI retrigger commits', () => {
    expect(
      isProcessNoise(makeCommit({ subject: 'ci: retrigger workflow' })),
    ).toBe(true);
  });

  it.each([
    'ci: retrigger',
    'ci: retrigger.',
    'ci: retrigger!',
    'ci: rerun',
    'ci: retry',
    'ci(ci): retrigger',
    'ci: retrigger: force build',
  ])('detects bare CI retrigger/rerun/retry noise: %s', (subject) => {
    expect(isProcessNoise(makeCommit({ subject }))).toBe(true);
  });

  it('detects flaky test stabilization commits', () => {
    expect(
      isProcessNoise(
        makeCommit({ subject: 'test: stabilize flaky integration test' }),
      ),
    ).toBe(true);
  });

  it('detects dependency bumps that are chore', () => {
    expect(
      isProcessNoise(
        makeCommit({ subject: 'chore(deps): bump eslint from 9.1.0 to 9.2.0' }),
      ),
    ).toBe(true);
  });

  it('does NOT classify a real feature as noise', () => {
    expect(
      isProcessNoise(
        makeCommit({ subject: 'feat: add streaming support for Ollama' }),
      ),
    ).toBe(false);
  });

  it('does NOT classify a real bug fix as noise', () => {
    expect(
      isProcessNoise(
        makeCommit({ subject: 'fix: resolve deadlock in streaming handler' }),
      ),
    ).toBe(false);
  });

  it('does NOT classify a user-facing refactor as noise', () => {
    expect(
      isProcessNoise(
        makeCommit({
          subject: 'refactor: simplify provider registration API',
        }),
      ),
    ).toBe(false);
  });

  it.each([
    'feat: add OCR review workflow',
    'feat: apply suggestion engine improvement',
    'feat: address review feedback display for users',
    'ci: add trigger feature for webhooks',
    'test: add flaky test detector',
    'chore: address preview release bug',
  ])('preserves legitimate commit %s', (subject) => {
    expect(isProcessNoise(makeCommit({ subject }))).toBe(false);
  });
});

describe('parseRefs', () => {
  it('parses Fixes references', () => {
    expect(parseRefs('fix: crash Fixes #123')).toEqual([
      { number: 123, verb: 'Fixes' },
    ]);
  });

  it('parses Closes references', () => {
    expect(parseRefs('feat: thing Closes #456')).toEqual([
      { number: 456, verb: 'Closes' },
    ]);
  });

  it('parses Resolves references', () => {
    expect(parseRefs('fix: bug Resolves #789')).toEqual([
      { number: 789, verb: 'Resolves' },
    ]);
  });

  it('parses lowercase verbs', () => {
    expect(parseRefs('fix: crash fixes #123')).toEqual([
      { number: 123, verb: 'fixes' },
    ]);
  });

  it('parses multiple references in one subject', () => {
    expect(parseRefs('fix: thing Fixes #1 Closes #2 resolves #3')).toEqual([
      { number: 1, verb: 'Fixes' },
      { number: 2, verb: 'Closes' },
      { number: 3, verb: 'resolves' },
    ]);
  });

  it('parses terminal GitHub PR marker (#N) independently of Fixes/Closes', () => {
    expect(
      parseRefs(
        'Keep Codex provider identity coherent during startup (Fixes #2544) (#2561)',
      ),
    ).toEqual([
      { number: 2544, verb: 'Fixes' },
      { number: 2561, verb: 'pr' },
    ]);
  });

  it('parses Merge pull request #N as a pr ref', () => {
    expect(parseRefs('Merge pull request #123 from foo/bar')).toEqual([
      { number: 123, verb: 'merge' },
    ]);
  });

  it('retains all refs without duplicate numbers', () => {
    const refs = parseRefs('fix: crash Fixes #42 (#42)');
    const numbers = refs.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('returns empty array when no references', () => {
    expect(parseRefs('feat: something cool')).toEqual([]);
  });

  it('parses Fixes plus terminal (#pr) as two distinct refs', () => {
    // Fixes #100 closes an issue, (#200) is the PR — both must be retained.
    const refs = parseRefs('feat: add provider Fixes #100 (#200)');
    expect(refs).toEqual([
      { number: 100, verb: 'Fixes' },
      { number: 200, verb: 'pr' },
    ]);
  });
});

describe('extractPrIdentity', () => {
  it('extracts PR identity from a terminal squash marker', () => {
    expect(
      extractPrIdentity(
        makeCommit({ subject: 'feat: add streaming support (#100)' }),
      ),
    ).toBe(100);
  });

  it('extracts PR identity from a classic merge marker', () => {
    expect(
      extractPrIdentity(
        makeCommit({ subject: 'Merge pull request #123 from foo/bar' }),
      ),
    ).toBe(123);
  });

  it('returns null for a Fixes-only commit (issue ref is NOT PR identity)', () => {
    expect(
      extractPrIdentity(makeCommit({ subject: 'fix: crash Fixes #42' })),
    ).toBeNull();
  });

  it('returns null when no PR marker exists', () => {
    expect(
      extractPrIdentity(makeCommit({ subject: 'feat: standalone change' })),
    ).toBeNull();
  });

  it('prefers the classic merge marker when both merge and terminal exist', () => {
    // This is unusual but tests determinism.
    expect(
      extractPrIdentity(
        makeCommit({ subject: 'Merge pull request #50 (#51)' }),
      ),
    ).toBe(50);
  });
});
