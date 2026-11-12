/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: a reviewer may reword a refused message but must keep every
 * fact in it. These cases pin which facts the host treats as literal.
 */

import { describe, expect, it } from 'bun:test';
import { findDroppedLiterals } from './protectedLiterals.js';

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
});
