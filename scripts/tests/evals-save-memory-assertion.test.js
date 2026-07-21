/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Issue #2605: The save_memory eval contract is deterministic. The prompt tells
 * the model to save exactly the canonical fact "My favorite color is blue" and
 * answer exactly "$blue$". Validators must compare the FULL normalized value,
 * not scan for substrings or parse grammar. Anything that is not the exact
 * canonical value — paraphrases, negations, wrong tokens, bare mentions,
 * surrounding prose — must be rejected.
 */
describe('saveMemoryFactEquals predicate (deterministic exact-value)', () => {
  async function loadHelper() {
    const url = pathToFileURL(join(ROOT, 'evals/test-helper.ts')).href;
    const mod = await import(url);
    expect(
      typeof mod.saveMemoryFactEquals,
      'evals/test-helper.ts must export saveMemoryFactEquals',
    ).toBe('function');
    return /** @type {(token: string) => (args: string) => boolean} */ (
      mod.saveMemoryFactEquals
    );
  }

  it('accepts the canonical fact exactly', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'My favorite color is blue' }))).toBe(
      true,
    );
  });

  it('is case-insensitive', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'MY FAVORITE COLOR IS BLUE' }))).toBe(
      true,
    );
  });

  it('ignores outer and extra internal whitespace', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(
        JSON.stringify({ fact: '   My    favorite   color   is   blue   ' }),
      ),
    ).toBe(true);
  });

  it('rejects a paraphrase ("I like blue best")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'I like blue best' }))).toBe(false);
  });

  it('rejects least favorite ("my least favorite color is blue")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(JSON.stringify({ fact: 'my least favorite color is blue' })),
    ).toBe(false);
  });

  it('rejects "blueberry" (a different token, not blue)', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color is blueberry' })),
    ).toBe(false);
  });

  it('rejects unrelated mention of blue ("the sky is blue")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'the sky is blue' }))).toBe(false);
  });

  it('rejects a temporal correction ("my favorite color used to be blue")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color used to be blue' })),
    ).toBe(false);
  });

  it('rejects negation ("my favorite color is not blue")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color is not blue' })),
    ).toBe(false);
  });

  it('rejects red-not-blue ("red is not blue")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'red is not blue' }))).toBe(false);
  });

  it('rejects the wrong color ("my favorite color is red")', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'my favorite color is red' }))).toBe(
      false,
    );
  });

  it('rejects surrounding prose on the fact', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(
      match(
        JSON.stringify({ fact: 'Sure! My favorite color is blue. Thanks!' }),
      ),
    ).toBe(false);
  });

  it('rejects a fact that omits the token', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 'I like green' }))).toBe(false);
  });

  it('rejects args missing the fact field entirely', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ scope: 'project' }))).toBe(false);
  });

  it('rejects a non-string fact', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(JSON.stringify({ fact: 42 }))).toBe(false);
  });

  it('rejects malformed JSON args without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match('{not valid json')).toBe(false);
  });

  it('rejects a JSON array without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match('["fact", "blue"]')).toBe(false);
  });

  it('rejects JSON null without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match('null')).toBe(false);
  });

  it('rejects a JSON primitive without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match('42')).toBe(false);
  });

  it('rejects a JSON string without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match('"blue"')).toBe(false);
  });

  it('rejects a non-object args argument without throwing', async () => {
    const predicate = await loadHelper();
    const match = predicate('blue');
    expect(match(/** @type {unknown} */ (null))).toBe(false);
    expect(match(/** @type {unknown} */ (undefined))).toBe(false);
    expect(match(/** @type {unknown} */ (42))).toBe(false);
  });
});

/**
 * Issue #2605: The save_memory eval prompt asks the model to answer exactly
 * "$blue$" and nothing else. The assertion helper must validate that the FULL
 * output equals the canonical answer after case/outer-whitespace normalization.
 * Surrounding prose, missing delimiters, the wrong color, or any extra text is
 * rejected.
 */
describe('assertFavoriteColorBlueOutput predicate (deterministic exact-value)', () => {
  async function loadHelper() {
    const url = pathToFileURL(join(ROOT, 'evals/test-helper.ts')).href;
    const mod = await import(url);
    expect(
      typeof mod.assertFavoriteColorBlueOutput,
      'evals/test-helper.ts must export assertFavoriteColorBlueOutput',
    ).toBe('function');
    return /** @type {(output: string) => void} */ (
      mod.assertFavoriteColorBlueOutput
    );
  }

  it('accepts the canonical "$blue$" output', async () => {
    const assert = await loadHelper();
    expect(() => assert('$blue$')).not.toThrow();
  });

  it('accepts case-insensitive "$BLUE$" output', async () => {
    const assert = await loadHelper();
    expect(() => assert('$BLUE$')).not.toThrow();
  });

  it('accepts the answer with harmless outer whitespace', async () => {
    const assert = await loadHelper();
    expect(() => assert('   $blue$   ')).not.toThrow();
  });

  it('rejects "red" (wrong color, even dollar-wrapped)', async () => {
    const assert = await loadHelper();
    expect(() => assert('$red$')).toThrow(/exact answer/i);
  });

  it('rejects "blue" without dollar delimiters', async () => {
    const assert = await loadHelper();
    expect(() => assert('blue')).toThrow(/exact answer/i);
  });

  it('rejects "blueberry" wrapped in dollars', async () => {
    const assert = await loadHelper();
    expect(() => assert('$blueberry$')).toThrow(/exact answer/i);
  });

  it('rejects the dollar-wrapped form embedded in a sentence', async () => {
    const assert = await loadHelper();
    expect(() => assert('Your favorite color is $blue$ obviously.')).toThrow(
      /exact answer/i,
    );
  });

  it('rejects multiple answers', async () => {
    const assert = await loadHelper();
    expect(() => assert('$blue$ $red$')).toThrow(/exact answer/i);
  });

  it('rejects surrounding prose', async () => {
    const assert = await loadHelper();
    expect(() => assert('The answer is $blue$.')).toThrow(/exact answer/i);
  });

  it('rejects empty output', async () => {
    const assert = await loadHelper();
    expect(() => assert('')).toThrow(/some output/i);
  });

  it('rejects whitespace-only output', async () => {
    const assert = await loadHelper();
    expect(() => assert('   \n\t  ')).toThrow(/some output/i);
  });

  it('rejects non-string input without throwing a TypeError', async () => {
    const assert = await loadHelper();
    expect(() => assert(/** @type {unknown} */ (null))).toThrow(/some output/i);
    expect(() => assert(/** @type {unknown} */ (undefined))).toThrow(
      /some output/i,
    );
    expect(() => assert(/** @type {unknown} */ (42))).toThrow(/some output/i);
  });
});
