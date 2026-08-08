/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the active `process.env.VITEST` reference detector in
 * scripts/check-no-vitest.ts (issue #2578). Extracted from the main guard
 * suite to keep both files under the max-lines lint limit.
 *
 * No repository execution path sets `VITEST`, so any active source reference
 * is stale compatibility behavior. Comment and string-literal mentions must
 * NOT be flagged (the guard masks them).
 */

import { describe, expect, it } from 'bun:test';
import {
  bunAvailable,
  runScript,
  withFixture,
} from './no-vitest-guard-helpers.ts';

const missingBunMessage =
  '[no-vitest] Bun runtime not found — install Bun or set BUN_EXECUTABLE.';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-no-vitest env reference detection',
  () => {
    it('Bun is available in CI (required for guard tests)', () => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(`${missingBunMessage} Guard tests cannot run in CI.`);
      }
    });

    describe('active process.env.VITEST reference detection', () => {
      it('FAILS an active process.env.VITEST dot-notation reference', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/rogue-env.ts',
            'const isTest = process.env.VITEST !== undefined;\nexport const x = 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-env.ts');
        expect(stdout).toContain('no-vitest guard FAILED');
      });

      it('FAILS an active process.env["VITEST"] bracket-notation reference', () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/rogue-bracket.ts',
            'const isTest = process.env["VITEST"] !== undefined;\nexport const x = 1;\n',
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-bracket.ts');
      });

      it("FAILS an active process.env['VITEST'] single-quote bracket reference", () => {
        const { code, stdout } = withFixture(({ root, write }) => {
          write('packages/cli/src/clean.ts', 'export const ok = 1;\n');
          write(
            'packages/cli/src/rogue-sq.ts',
            "const isTest = process.env['VITEST'] !== undefined;\nexport const x = 1;\n",
          );
          return runScript(root, 1);
        });
        expect(code).toBe(1);
        expect(stdout).toContain('rogue-sq.ts');
      });

      it('does NOT flag process.env.NODE_ENV (false-positive guard)', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/env.ts',
            'const isTest = process.env.NODE_ENV === "test";\nexport const x = 1;\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag process.env.VITEST inside a line comment', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/note.ts',
            '// We used to check process.env.VITEST but removed it.\nexport const x = 1;\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });

      it('does NOT flag process.env.VITEST inside a string literal', () => {
        const { code } = withFixture(({ root, write }) => {
          write(
            'packages/cli/src/note.ts',
            'export const msg = "checking process.env.VITEST is gone";\n',
          );
          return runScript(root, 0);
        });
        expect(code).toBe(0);
      });
    });
  },
);
