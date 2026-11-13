/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a reviewer may reword a refused message but must keep every
 * fact in it. These cases pin which facts the host treats as literal.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { findDroppedLiterals } from './protectedLiterals.js';

const REAL_SUMMARY = readFileSync(
  new URL('./fixtures/classifier-summary-excerpt.txt', import.meta.url),
  'utf8',
);

const ORIGINAL =
  'Run 3 killed 42 of 50 mutants (84%) in 3.5s on commit 9fceb02d0ae598e95dc970b74767f19372d61724. ' +
  'The file src/core/a.ts and C:\\work\\repo\\b.ts changed; see https://example.com/report?id=7 ' +
  'and MAX_RETRIES via config.runtime.limit. Use `pkill -f server` or:\n' +
  '```sh\nmake test\n```\n';

const REPHRASED =
  'Run 3 terminated 42 of 50 mutants (84%) in 3.5s on commit 9fceb02d0ae598e95dc970b74767f19372d61724. ' +
  'The file src/core/a.ts and C:\\work\\repo\\b.ts changed; see https://example.com/report?id=7 ' +
  'and MAX_RETRIES via config.runtime.limit. Use `pkill -f server` or:\n' +
  '```sh\nmake test\n```\n';

describe('protected literals', () => {
  it('accepts a rewording that keeps every fact', () => {
    expect(findDroppedLiterals(ORIGINAL, REPHRASED)).toStrictEqual([]);
  });

  const dropped: ReadonlyArray<readonly [string, string, string]> = [
    ['a posix path', 'src/core/a.ts', 'The file src/core/b.ts changed'],
    [
      'a windows path',
      'C:\\work\\repo\\b.ts',
      'The file D:\\other\\b.ts changed',
    ],
    ['a url', 'https://example.com/report?id=7', 'see the report online'],
    ['an integer', '42', 'killed 41 of 50 mutants'],
    ['a decimal with a unit', '3.5s', 'took 3.5 seconds'],
    ['a percentage', '84%', 'about 84 percent'],
    [
      'a commit hash',
      '9fceb02d0ae598e95dc970b74767f19372d61724',
      'on the latest commit',
    ],
    ['a SCREAMING_CASE token', 'MAX_RETRIES', 'the retry limit'],
    ['a dotted identifier', 'config.runtime.limit', 'via the runtime limit'],
    ['a backtick span', '`pkill -f server`', 'use pkill on the server'],
    ['a fenced code block', '```sh\nmake test\n```', 'run the tests'],
  ];

  it.each(dropped)(
    'reports %s that the rewrite dropped',
    (_name, literal, edit) => {
      const replacement = ORIGINAL.split(literal).join(edit);

      expect(findDroppedLiterals(ORIGINAL, replacement)).toContain(literal);
    },
  );

  it('does not treat ordinary words or abbreviations as facts', () => {
    const original = 'The defaced page, e.g. a decade old, was fixed.';
    const replacement =
      'The vandalized page, for example ten years old, was fixed.';

    expect(findDroppedLiterals(original, replacement)).toStrictEqual([]);
  });

  it('lists each dropped literal once', () => {
    const original = 'Fix MAX_RETRIES and again MAX_RETRIES.';

    expect(findDroppedLiterals(original, 'Fix the limit.')).toStrictEqual([
      'MAX_RETRIES',
    ]);
  });

  const corrupted: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      'a number that gained a leading digit',
      'Run 42 tests in 5 ms',
      '142 tests in 15 ms',
      '42',
    ],
    [
      'a path that gained a suffix',
      'Edit src/core/a.ts now',
      'Edit src/core/a.ts.bak now',
      'src/core/a.ts',
    ],
    [
      'a path that gained a parent directory',
      'Edit src/core/a.ts now',
      'Edit vendor/src/core/a.ts now',
      'src/core/a.ts',
    ],
    [
      'a hash that gained a digit',
      'Fixed in 9fceb02d0ae5',
      'Fixed in 9fceb02d0ae51',
      '9fceb02d0ae5',
    ],
    [
      'a url that gained a query',
      'See https://example.com/report',
      'See https://example.com/report?draft=1',
      'https://example.com/report',
    ],
    [
      'a url that lost a significant trailing bang',
      'Fetch https://example.com/run!',
      'Fetch https://example.com/run',
      'https://example.com/run!',
    ],
    [
      'a url that gained a significant trailing bang',
      'Fetch https://example.com/run',
      'Fetch https://example.com/run!',
      'https://example.com/run',
    ],
    [
      'a code span that gained an argument',
      'Run `pkill -f server` first',
      'Run `pkill -f server -9` first',
      '`pkill -f server`',
    ],
    [
      'a version that lost a segment',
      'Needs crossterm 0.28.1',
      'Needs crossterm 0.28',
      '0.28.1',
    ],
    [
      'an identifier that gained a segment',
      'Read config.runtime.limit',
      'Read config.runtime.limit.max',
      'config.runtime.limit',
    ],
  ];

  it.each(corrupted)(
    'reports %s',
    (_name, original, replacement, expectedLiteral) => {
      expect(findDroppedLiterals(original, replacement)).toContain(
        expectedLiteral,
      );
    },
  );

  it('ignores sentence punctuation after a url', () => {
    expect(
      findDroppedLiterals(
        'See https://example.com/run, then stop.',
        'Stop after you see https://example.com/run.',
      ),
    ).toStrictEqual([]);
  });

  it('accepts a number and its unit written with or without a space', () => {
    expect(
      findDroppedLiterals('It took 5 ms and 20 MB', 'It took 5ms and 20MB'),
    ).toStrictEqual([]);
  });

  it('accepts a literal that the rewrite moved or repeated, and new literals', () => {
    const original = 'Edit src/core/a.ts, then run 42 tests.';
    const replacement =
      'Run 42 tests after you edit src/core/a.ts (also src/core/b.ts, 7 files).';

    expect(findDroppedLiterals(original, replacement)).toStrictEqual([]);
  });

  describe('a realistic compression summary (synthetic fixture)', () => {
    const plainWording: ReadonlyArray<readonly [string, string]> = [
      ['Be concise.', 'Keep answers short.'],
      ['Fix built.', 'Fix implemented.'],
      ['Two architect review rounds', 'Two rounds of architect review'],
      ['is probably also infra', 'is probably an infrastructure problem too'],
      ['Steering is verified working.', 'Steering has been verified to work.'],
      ['Tool limits.', 'Limits of the shell tool.'],
    ];

    function reworded(): string {
      return plainWording.reduce((text, [from, to]) => {
        expect(text).toContain(from);
        return text.replaceAll(from, to);
      }, REAL_SUMMARY);
    }

    it('is long enough to be a realistic multi-KB input', () => {
      expect(REAL_SUMMARY.length).toBeGreaterThan(4000);
    });

    it('accepts a plain-wording rewrite that keeps every fact', () => {
      const replacement = reworded();

      expect(replacement).not.toBe(REAL_SUMMARY);
      expect(findDroppedLiterals(REAL_SUMMARY, replacement)).toStrictEqual([]);
    });

    it('rejects the same rewrite once an issue number is altered', () => {
      const replacement = reworded().replaceAll('#3998', '#4998');

      expect(findDroppedLiterals(REAL_SUMMARY, replacement)).toContain('3998');
    });
  });
});
