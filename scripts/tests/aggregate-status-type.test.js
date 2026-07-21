/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  useTempArtifactsDir,
  writeReport,
  runWithOneExpected,
} from './aggregate-helpers.js';

/**
 * Final review finding (strict testResult.status type): When testResult has a
 * PRESENT status property, it must be a string and one of the recognized
 * values (passed/failed). A numeric, boolean, null, array, or object status is
 * invalid and must fail closed. Only an OMITTED status is accepted (real
 * Vitest reports may omit it — see the "omits status entirely" test in
 * aggregate-schema.test.js).
 */
describe('aggregate_evals: testResult.status must be a string when present', () => {
  it('rejects a numeric testResult.status', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/numeric.eval.ts',
            status: 1,
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /testResult.*status.*string|status.*must be a string/i,
      );
    });
  });

  // Data-driven: boolean statuses must be rejected (typeof true === 'boolean',
  // not 'string'). Each value hits the same !string guard.
  for (const status of [true, false]) {
    it(`rejects a boolean testResult.status (${status})`, () => {
      useTempArtifactsDir((dir) => {
        writeReport(dir, {
          testResults: [
            {
              name: '/repo/evals/boolean.eval.ts',
              status,
              assertionResults: [
                { title: 'a', fullName: 'a', status: 'passed' },
              ],
            },
          ],
        });

        const result = runWithOneExpected(dir);

        expect(result.exitCode, result.stdout).not.toBe(0);
        expect(result.stderr).toMatch(
          /testResult.*status.*string|status.*must be a string/i,
        );
      });
    });
  }

  it('rejects a null testResult.status', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/null.eval.ts',
            status: null,
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /testResult.*status.*string|status.*must be a string/i,
      );
    });
  });

  it('rejects an array testResult.status', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/array.eval.ts',
            status: ['failed'],
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /testResult.*status.*string|status.*must be a string/i,
      );
    });
  });

  it('rejects an object testResult.status', () => {
    useTempArtifactsDir((dir) => {
      writeReport(dir, {
        testResults: [
          {
            name: '/repo/evals/object.eval.ts',
            status: { failed: true },
            assertionResults: [{ title: 'a', fullName: 'a', status: 'passed' }],
          },
        ],
      });

      const result = runWithOneExpected(dir);

      expect(result.exitCode, result.stdout).not.toBe(0);
      expect(result.stderr).toMatch(
        /testResult.*status.*string|status.*must be a string/i,
      );
    });
  });
});
