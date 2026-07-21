/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import {
  loadAggregateModule,
  useTempArtifactsDir,
  runScript,
  writeAttempt,
} from './aggregate-helpers.js';

/**
 * Issue #2605 (CLI expected-attempts strictness): When `--expected-attempts`
 * is present, an invalid or missing value must fail. The value, when valid,
 * must be a nonempty array of unique positive integers. The same strictness
 * applies to the AGGREGATE_EXPECTED_ATTEMPTS env var.
 */
describe('parseExpectedAttempts strict validation', () => {
  async function loadFn() {
    const mod = await loadAggregateModule();
    const fn = mod.parseExpectedAttempts;
    expect(typeof fn, 'must export parseExpectedAttempts').toBe('function');
    return fn;
  }

  it('accepts a valid nonempty array of positive integers', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('accepts a single-element array', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[1]')).toEqual([1]);
  });

  it('accepts non-contiguous positive integers', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[5,10,42]')).toEqual([5, 10, 42]);
  });

  it('rejects an empty array', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[]')).toBeNull();
  });

  it('rejects an empty/whitespace string', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('')).toBeNull();
    expect(parseExpectedAttempts('   ')).toBeNull();
  });

  it('rejects a non-string', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts(/** @type {unknown} */ ([]))).toBeNull();
  });

  it('rejects malformed JSON', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('not-json')).toBeNull();
  });

  it('rejects a JSON value that is not an array', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('5')).toBeNull();
    expect(parseExpectedAttempts('{}')).toBeNull();
  });

  it('rejects an array containing a non-integer', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[1.5]')).toBeNull();
    expect(parseExpectedAttempts('["a"]')).toBeNull();
  });

  it('rejects an array containing a non-positive integer', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[0]')).toBeNull();
    expect(parseExpectedAttempts('[-1,2]')).toBeNull();
  });

  it('rejects an array containing duplicate positive integers', async () => {
    const parseExpectedAttempts = await loadFn();
    expect(parseExpectedAttempts('[1, 1]')).toBeNull();
    expect(parseExpectedAttempts('[2, 2, 3]')).toBeNull();
  });
});

/**
 * Issue #2605 (resolveExpectedAttempts immutability): The default expected
 * attempts fallback must return a COPY so a caller that mutates the returned
 * array cannot corrupt the module-level default for subsequent calls.
 */
describe('aggregate_evals: resolveExpectedAttempts returns a copy of the default', () => {
  async function loadResolveFn() {
    // resolveExpectedAttempts lives in the cardinality module (not re-exported
    // via aggregate_evals.js because it is an internal CLI helper). Import it
    // directly so the mutation-isolation contract is tested at the source.
    const url = pathToFileURL(
      join(import.meta.dirname, '..', 'aggregate-evals-cardinality.js'),
    ).href;
    const mod = await import(url);
    const fn = mod.resolveExpectedAttempts;
    expect(typeof fn, 'must export resolveExpectedAttempts').toBe('function');
    return fn;
  }

  it('does not mutate the module-level default when the caller mutates the result', async () => {
    const resolveExpectedAttempts = await loadResolveFn();

    const first = resolveExpectedAttempts(['node', 'script.js']);
    expect(first).toEqual([1, 2, 3]);
    // Mutate the returned array.
    first.push(99);
    first.sort((a, b) => b - a);

    const second = resolveExpectedAttempts(['node', 'script.js']);
    // The second call must still see the pristine default [1,2,3].
    expect(second).toEqual([1, 2, 3]);
  });

  it('two successive default resolutions are independent arrays', async () => {
    const resolveExpectedAttempts = await loadResolveFn();
    const first = resolveExpectedAttempts(['node', 'script.js']);
    const second = resolveExpectedAttempts(['node', 'script.js']);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});

/**
 * Issue #2605 (process-level CLI/env strictness): End-to-end behavior when
 * `--expected-attempts` is present but malformed must fail closed (nonzero
 * exit), rather than silently falling back to the default [1,2,3]. The same
 * strictness applies to a malformed AGGREGATE_EXPECTED_ATTEMPTS env value.
 */
describe('aggregate_evals: --expected-attempts CLI failures', () => {
  it('fails when --expected-attempts value is an empty array', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[]',
      ]);
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        '--expected-attempts is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('fails when --expected-attempts value is malformed JSON', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        'not-json',
      ]);
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        '--expected-attempts is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('fails when --expected-attempts value contains a non-positive integer', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[0,1]',
      ]);
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        '--expected-attempts is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('fails when --expected-attempts value contains duplicates', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1,1]',
      ]);
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        '--expected-attempts is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('accepts a valid --expected-attempts value and aggregates it', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      const result = runScript(dir, { AGGREGATE_SKIP_HISTORICAL: '1' }, [
        '--expected-attempts',
        '[1]',
      ]);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });
});

/**
 * Issue #2605 (env-level strictness): A malformed AGGREGATE_EXPECTED_ATTEMPTS
 * env value must fail closed (nonzero exit). An empty env value falls back to
 * the default (this is the documented "not provided" behavior, not a failure).
 */
describe('aggregate_evals: AGGREGATE_EXPECTED_ATTEMPTS env failures', () => {
  it('fails when the env value is an empty array', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 5);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '[]',
      });
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        'AGGREGATE_EXPECTED_ATTEMPTS is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('fails when the env value contains a non-positive integer', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 5);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '[0]',
      });
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        'AGGREGATE_EXPECTED_ATTEMPTS is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('fails when the env value contains duplicates', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 5);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '[5,5]',
      });
      expect(result.exitCode, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(
        'AGGREGATE_EXPECTED_ATTEMPTS is not a valid nonempty array of unique positive integers',
      );
    });
  });

  it('accepts a valid env value and aggregates it', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 5);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '[5]',
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });

  it('falls back to default [1,2,3] when env value is an empty string', () => {
    // An empty AGGREGATE_EXPECTED_ATTEMPTS is the documented "not provided"
    // behavior: it must NOT fail closed (unlike a malformed-but-nonempty
    // value), and must silently fall back to the default [1,2,3].
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '',
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });

  it('falls back to default [1,2,3] when env value is whitespace-only', () => {
    useTempArtifactsDir((dir) => {
      writeAttempt(dir, 1);
      writeAttempt(dir, 2);
      writeAttempt(dir, 3);
      const result = runScript(dir, {
        AGGREGATE_SKIP_HISTORICAL: '1',
        AGGREGATE_EXPECTED_ATTEMPTS: '   ',
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Eval Results Summary');
    });
  });
});
