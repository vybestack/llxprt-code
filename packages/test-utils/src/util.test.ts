/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { restoreEnv, setEnv } from './env-test-helpers.js';
import { validateModelOutput } from './util.js';

/**
 * Issue #2605: validateModelOutput must be stateless and non-destructive to the
 * caller's RegExp objects. RegExp.test() advances lastIndex on /g and /y
 * regexes; calling a validator must not leak that state back to the caller
 * (which would break subsequent uses of the same regex).
 */
describe('regex state is preserved for validateModelOutput', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('preserves the caller lastIndex of a global regex', () => {
    setEnv('VERBOSE', 'false');
    const pattern = /\d+/g;
    pattern.lastIndex = 5;
    expect(validateModelOutput('answer is 42', pattern)).toBe(true);
    expect(pattern.lastIndex).toBe(5);
  });

  it('preserves the caller lastIndex of a sticky regex', () => {
    setEnv('VERBOSE', 'false');
    // Sticky patterns anchor at lastIndex; the validator resets to 0 for a
    // stateless match, so /the/y matches at the start of this input.
    const pattern = /the/y;
    pattern.lastIndex = 7;
    expect(validateModelOutput('the color is blue', pattern)).toBe(true);
    expect(pattern.lastIndex).toBe(7);
  });

  it('is repeatable for a global regex across calls', () => {
    setEnv('VERBOSE', 'false');
    const pattern = /answer/g;
    expect(validateModelOutput('answer is 42', pattern)).toBe(true);
    expect(validateModelOutput('answer is 42', pattern)).toBe(true);
    expect(validateModelOutput('answer is 42', pattern)).toBe(true);
  });
});

/**
 * Ensure the legacy validateModelOutput behavior (warn-only) is preserved so
 * existing integration tests that rely on the soft warning are not affected.
 */
describe('validateModelOutput (legacy warn-only behavior preserved)', () => {
  afterEach(() => {
    restoreEnv();
  });

  it('returns false but does not throw when expected content is missing', () => {
    setEnv('VERBOSE', 'false');
    expect(() => validateModelOutput('color is green', 'blue')).not.toThrow();
    expect(validateModelOutput('color is green', 'blue')).toBe(false);
  });

  it('returns true when expected content is present', () => {
    setEnv('VERBOSE', 'false');
    expect(validateModelOutput('color is blue', 'blue')).toBe(true);
  });

  it('does not echo any raw model output (only safe metadata) in its warning when content is missing', () => {
    setEnv('VERBOSE', 'true');
    const sensitive = 'super-secret-token-1234567890';
    const longOutput = `${'a'.repeat(250)}${sensitive}${'b'.repeat(250)}`;
    const captured = captureVerbose(() =>
      expect(validateModelOutput(longOutput, 'not-present')).toBe(false),
    );
    // The warning must not leak any raw output (which may contain secrets).
    expect(captured).not.toContain(sensitive);
    expect(captured).not.toMatch(/Actual output:/i);
    expect(captured).not.toMatch(/output preview/i);
    // Safe metadata (length) is reported instead.
    expect(captured).toMatch(/length/i);
  });

  it('does not leak a secret placed at the very beginning of the output', () => {
    setEnv('VERBOSE', 'true');
    const secret = 'AKIA-SECRET-AT-THE-START-9876543210';
    const longOutput = `${secret}${'x'.repeat(200)}`;
    const captured = captureVerbose(() =>
      expect(validateModelOutput(longOutput, 'not-present')).toBe(false),
    );
    expect(captured).not.toContain(secret);
  });
});

function captureVerbose(fn: () => void): string {
  const captured: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  const stub: (chunk: unknown) => boolean = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  process.stdout.write = stub;
  try {
    fn();
  } finally {
    process.stdout.write = original;
  }
  return captured.join('');
}
