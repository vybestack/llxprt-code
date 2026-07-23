/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
describe('eval JSON output contract', () => {
  /** @type {(prompt: string) => string[]} */
  let buildEvalArgs;
  /** @type {(output: string) => string} */
  let extractModelResponse;
  /** @type {(capture: { stdout: string, stderr: string, exitCode: number | null, timedOut: boolean } | null, toolCalls: unknown) => string} */
  let formatEvalLog;

  beforeAll(async () => {
    const url = pathToFileURL(join(ROOT, 'evals/test-helper.ts')).href;
    const mod = await import(url);
    buildEvalArgs = mod.buildEvalArgs;
    extractModelResponse = mod.extractModelResponse;
    formatEvalLog = mod.formatEvalLog;
  });

  it('requests structured JSON output for eval prompts', () => {
    expect(buildEvalArgs('--remember this')).toEqual([
      '--prompt=--remember this',
      '--output-format',
      'json',
    ]);
  });

  it('preserves special characters and empty prompts as a single argument', () => {
    const prompt = 'line one\n"quoted" \\path --flag';
    expect(buildEvalArgs(prompt)).toEqual([
      `--prompt=${prompt}`,
      '--output-format',
      'json',
    ]);
    expect(buildEvalArgs('')[0]).toBe('--prompt=');
  });

  it('extracts only the assistant response from CLI JSON output', () => {
    const cliOutput = JSON.stringify({
      session_id: 'session-1',
      response: '$blue$',
      stats: { tools: { totalCalls: 1 } },
    });

    expect(extractModelResponse(cliOutput)).toBe('$blue$');
  });

  it('rejects malformed CLI JSON output', () => {
    expect(() => extractModelResponse('not json')).toThrow(
      /valid JSON output/i,
    );
  });

  it('rejects CLI JSON output without a response', () => {
    expect(() =>
      extractModelResponse(JSON.stringify({ session_id: 'session-1' })),
    ).toThrow(/string response/i);
  });

  it('rejects CLI JSON output with a non-string response', () => {
    expect(() =>
      extractModelResponse(
        JSON.stringify({ session_id: 'session-1', response: 42 }),
      ),
    ).toThrow(/string response/i);
    expect(() =>
      extractModelResponse(
        JSON.stringify({ session_id: 'session-1', response: null }),
      ),
    ).toThrow(/string response/i);
  });

  it('preserves an empty string response for the eval assertion to validate', () => {
    expect(
      extractModelResponse(
        JSON.stringify({ session_id: 'session-1', response: '' }),
      ),
    ).toBe('');
  });

  it('includes structured run capture and tool calls in the eval artifact log', () => {
    const capture = {
      stdout: '{"response":"$blue$"}',
      stderr: 'some diagnostic',
      exitCode: 0,
      timedOut: false,
    };
    const toolCalls = [{ toolRequest: { name: 'save_memory' } }];

    expect(JSON.parse(formatEvalLog(capture, toolCalls))).toEqual({
      schemaVersion: 1,
      capture,
      toolCalls,
    });
  });

  it('serializes a null capture when no run has occurred', () => {
    expect(JSON.parse(formatEvalLog(null, []))).toEqual({
      schemaVersion: 1,
      capture: null,
      toolCalls: [],
    });
  });
});

/**
 * Issue #2605: The save_memory eval contract is deterministic. The prompt tells
 * the model to save exactly the canonical fact "My favorite color is blue" and
 * answer exactly "$blue$". Validators must compare the FULL normalized value,
 * not scan for substrings or parse grammar. Anything that is not the exact
 * canonical value — paraphrases, negations, wrong tokens, bare mentions,
 * surrounding prose — must be rejected.
 */
describe('saveMemoryFactEquals predicate (deterministic exact-value)', () => {
  /** @type {(token: string) => (args: string) => boolean} */
  let saveMemoryFactEquals;

  beforeAll(async () => {
    const url = pathToFileURL(join(ROOT, 'evals/test-helper.ts')).href;
    const mod = await import(url);
    expect(
      typeof mod.saveMemoryFactEquals,
      'evals/test-helper.ts must export saveMemoryFactEquals',
    ).toBe('function');
    saveMemoryFactEquals = mod.saveMemoryFactEquals;
  });

  it('accepts the canonical fact exactly', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'My favorite color is blue' }))).toBe(
      true,
    );
  });

  it('is case-insensitive', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'MY FAVORITE COLOR IS BLUE' }))).toBe(
      true,
    );
  });

  it('ignores outer and extra internal whitespace', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(
        JSON.stringify({ fact: '   My    favorite   color   is   blue   ' }),
      ),
    ).toBe(true);
  });

  it('rejects a paraphrase ("I like blue best")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'I like blue best' }))).toBe(false);
  });

  it('rejects least favorite ("my least favorite color is blue")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(JSON.stringify({ fact: 'my least favorite color is blue' })),
    ).toBe(false);
  });

  it('rejects "blueberry" (a different token, not blue)', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color is blueberry' })),
    ).toBe(false);
  });

  it('rejects unrelated mention of blue ("the sky is blue")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'the sky is blue' }))).toBe(false);
  });

  it('rejects a temporal correction ("my favorite color used to be blue")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color used to be blue' })),
    ).toBe(false);
  });

  it('rejects negation ("my favorite color is not blue")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(JSON.stringify({ fact: 'my favorite color is not blue' })),
    ).toBe(false);
  });

  it('rejects red-not-blue ("red is not blue")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'red is not blue' }))).toBe(false);
  });

  it('rejects the wrong color ("my favorite color is red")', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'my favorite color is red' }))).toBe(
      false,
    );
  });

  it('rejects surrounding prose on the fact', () => {
    const match = saveMemoryFactEquals('blue');
    expect(
      match(
        JSON.stringify({ fact: 'Sure! My favorite color is blue. Thanks!' }),
      ),
    ).toBe(false);
  });

  it('rejects a fact that omits the token', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 'I like green' }))).toBe(false);
  });

  it('rejects args missing the fact field entirely', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ scope: 'project' }))).toBe(false);
  });

  it('rejects a non-string fact', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match(JSON.stringify({ fact: 42 }))).toBe(false);
  });

  it('rejects malformed JSON args without throwing', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match('{not valid json')).toBe(false);
  });

  it('rejects a JSON array without throwing', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match('["fact", "blue"]')).toBe(false);
  });

  it('rejects JSON null without throwing', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match('null')).toBe(false);
  });

  it('rejects a JSON primitive without throwing', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match('42')).toBe(false);
  });

  it('rejects a JSON string without throwing', () => {
    const match = saveMemoryFactEquals('blue');
    expect(match('"blue"')).toBe(false);
  });

  it('rejects a non-object args argument without throwing', () => {
    const match = saveMemoryFactEquals('blue');
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
  /** @type {(output: string) => void} */
  let assertFavoriteColorBlueOutput;

  beforeAll(async () => {
    const url = pathToFileURL(join(ROOT, 'evals/test-helper.ts')).href;
    const mod = await import(url);
    expect(
      typeof mod.assertFavoriteColorBlueOutput,
      'evals/test-helper.ts must export assertFavoriteColorBlueOutput',
    ).toBe('function');
    assertFavoriteColorBlueOutput = mod.assertFavoriteColorBlueOutput;
  });

  it('accepts the canonical "$blue$" output', () => {
    expect(() => assertFavoriteColorBlueOutput('$blue$')).not.toThrow();
  });

  it('accepts case-insensitive "$BLUE$" output', () => {
    expect(() => assertFavoriteColorBlueOutput('$BLUE$')).not.toThrow();
  });

  it('accepts the answer with harmless outer whitespace', () => {
    expect(() => assertFavoriteColorBlueOutput('   $blue$   ')).not.toThrow();
  });

  it('rejects "red" (wrong color, even dollar-wrapped)', () => {
    expect(() => assertFavoriteColorBlueOutput('$red$')).toThrow(
      /exact answer/i,
    );
  });

  it('rejects "blue" without dollar delimiters', () => {
    expect(() => assertFavoriteColorBlueOutput('blue')).toThrow(
      /exact answer/i,
    );
  });

  it('rejects "blueberry" wrapped in dollars', () => {
    expect(() => assertFavoriteColorBlueOutput('$blueberry$')).toThrow(
      /exact answer/i,
    );
  });

  it('rejects the dollar-wrapped form embedded in a sentence', () => {
    expect(() =>
      assertFavoriteColorBlueOutput('Your favorite color is $blue$ obviously.'),
    ).toThrow(/exact answer/i);
  });

  it('rejects multiple answers', () => {
    expect(() => assertFavoriteColorBlueOutput('$blue$ $red$')).toThrow(
      /exact answer/i,
    );
  });

  it('rejects surrounding prose', () => {
    expect(() =>
      assertFavoriteColorBlueOutput('The answer is $blue$.'),
    ).toThrow(/exact answer/i);
  });

  it('rejects empty output', () => {
    expect(() => assertFavoriteColorBlueOutput('')).toThrow(/some output/i);
  });

  it('rejects whitespace-only output', () => {
    expect(() => assertFavoriteColorBlueOutput('   \n\t  ')).toThrow(
      /some output/i,
    );
  });

  it('rejects non-string input without throwing a TypeError', () => {
    expect(() =>
      assertFavoriteColorBlueOutput(/** @type {unknown} */ (null)),
    ).toThrow(/some output/i);
    expect(() =>
      assertFavoriteColorBlueOutput(/** @type {unknown} */ (undefined)),
    ).toThrow(/some output/i);
    expect(() =>
      assertFavoriteColorBlueOutput(/** @type {unknown} */ (42)),
    ).toThrow(/some output/i);
  });
});
