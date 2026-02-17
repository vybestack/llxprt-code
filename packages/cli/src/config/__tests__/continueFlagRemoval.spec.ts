/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P28 Tests for --resume flag removal
 *
 * Phase 28 tests for:
 * 1. Removal of --resume / -r flags (should FAIL before P29, PASS after P29)
 * 2. Preservation of --continue / -C, --list-sessions, --delete-session flags
 *
 * These tests verify CLI argument parsing for session management flags.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { parseArguments } from '../config.js';
import type { Settings } from '../settings.js';

describe('CLI --resume flag removal', () => {
  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P28 Tests for --resume flag removal
   */

  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
  });

  describe('Removal Tests (should FAIL before P29, then PASS after P29)', () => {
    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @plan PLAN-20260214-SESSIONBROWSER.P29 — Updated to expect rejection
     * @requirement REQ-RR-001 --resume flag should be rejected
     *
     * Tests that parsing ['--resume', 'some-id'] should fail or produce no
     * resume field in the parsed arguments.
     *
     * EXPECTED: FAIL before P29 (when --resume still exists), PASS after P29
     */
    it('--resume flag rejected', async () => {
      process.argv = ['node', 'script.js', '--resume', 'some-id'];

      // After P29, yargs strict mode rejects unknown options by calling process.exit(1).
      // Mock process.exit to capture this rejection behavior.
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit called with code ${code}`);
        });

      try {
        await expect(parseArguments({} as Settings)).rejects.toThrow(
          /process\.exit called/,
        );
      } finally {
        mockExit.mockRestore();
      }
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @plan PLAN-20260214-SESSIONBROWSER.P29 — Updated to expect rejection
     * @requirement REQ-RR-001 -r alias should be rejected
     *
     * Tests that parsing ['-r', 'some-id'] should fail or produce no
     * resume field in the parsed arguments.
     *
     * EXPECTED: FAIL before P29 (when -r still exists), PASS after P29
     */
    it('-r alias rejected', async () => {
      process.argv = ['node', 'script.js', '-r', 'some-id'];

      // After P29, yargs strict mode rejects unknown options by calling process.exit(1).
      // Mock process.exit to capture this rejection behavior.
      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation((code?: string | number | null | undefined) => {
          throw new Error(`process.exit called with code ${code}`);
        });

      try {
        await expect(parseArguments({} as Settings)).rejects.toThrow(
          /process\.exit called/,
        );
      } finally {
        mockExit.mockRestore();
      }
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-002 No resume field in parsed args
     *
     * Tests that after parsing valid args, the result object should not have
     * a resume property at all.
     *
     * EXPECTED: FAIL before P29 (CliArgs interface still has resume),
     * PASS after P29 (resume removed from CliArgs)
     */
    it('No resume field in parsed args', async () => {
      process.argv = ['node', 'script.js', '--continue'];

      const result = await parseArguments({} as Settings);

      // The result object should not have a 'resume' property at all
      // (not even as undefined in the interface)
      const keys = Object.keys(result);
      expect(keys).not.toContain('resume');
    });
  });

  describe('Preservation Tests (should PASS before and after P29)', () => {
    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006 --continue flag should be accepted
     *
     * Tests that parsing ['--continue'] produces the continue flag.
     */
    it('--continue flag accepted', async () => {
      process.argv = ['node', 'script.js', '--continue'];

      const result = await parseArguments({} as Settings);

      // --continue with no value should produce true or empty string
      expect(result.continue === '' || result.continue === true).toBe(true);
      expect(result.continue).not.toBe('true'); // Should not be string "true"
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006 -C alias should be accepted
     *
     * Tests that parsing ['-C'] produces the continue flag.
     */
    it('-C alias accepted', async () => {
      process.argv = ['node', 'script.js', '-C'];

      const result = await parseArguments({} as Settings);

      // -C with no value should produce true or empty string
      expect(result.continue === '' || result.continue === true).toBe(true);
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-007 --list-sessions flag should be accepted
     *
     * Tests that parsing ['--list-sessions'] is recognized.
     */
    it('--list-sessions flag accepted', async () => {
      process.argv = ['node', 'script.js', '--list-sessions'];

      const result = await parseArguments({} as Settings);

      expect(result.listSessions).toBe(true);
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-008 --delete-session flag should be accepted
     *
     * Tests that parsing ['--delete-session', 'some-id'] is recognized.
     */
    it('--delete-session flag accepted', async () => {
      process.argv = ['node', 'script.js', '--delete-session', 'some-id'];

      const result = await parseArguments({} as Settings);

      expect(result.deleteSession).toBe('some-id');
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006 --continue with session ID should be accepted
     *
     * Tests that parsing ['--continue', 'session-123'] produces the correct
     * continue value.
     */
    it('--continue with session ID accepted', async () => {
      process.argv = ['node', 'script.js', '--continue', 'session-123'];

      const result = await parseArguments({} as Settings);

      expect(result.continue).toBe('session-123');
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006 --continue should not consume following flags
     *
     * Tests that parsing ['--continue', '--debug'] correctly recognizes both
     * flags without --continue consuming --debug as its argument.
     */
    it('--continue does not consume following flags', async () => {
      process.argv = ['node', 'script.js', '--continue', '--debug'];

      const result = await parseArguments({} as Settings);

      // --continue should be true/empty, not "--debug"
      expect(result.continue === '' || result.continue === true).toBe(true);
      expect(result.debug).toBe(true);
    });
  });

  describe('Property-Based Tests', () => {
    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006, REQ-RR-008 Preserved flags always accepted
     *
     * Property-based test: For any valid session reference string,
     * ['--continue', ref] and ['--delete-session', ref] are accepted.
     */
    it('Preserved flags always accepted with valid session references', async () => {
      // Generate valid session reference strings (alphanumeric with hyphens)
      const sessionRefArb = fc
        .string({ minLength: 1, maxLength: 36 })
        .filter((s: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s));

      await fc.assert(
        fc.asyncProperty(sessionRefArb, async (ref: string) => {
          // Test --continue with session reference
          process.argv = ['node', 'script.js', '--continue', ref];
          const continueResult = await parseArguments({} as Settings);
          expect(continueResult.continue).toBe(ref);

          // Test --delete-session with session reference
          process.argv = ['node', 'script.js', '--delete-session', ref];
          const deleteResult = await parseArguments({} as Settings);
          expect(deleteResult.deleteSession).toBe(ref);

          return true;
        }),
        { numRuns: 50 },
      );
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-006 --continue handles numeric indices
     *
     * Property-based test: For any positive integer index,
     * ['--continue', index.toString()] is accepted.
     */
    it('--continue handles numeric session indices', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 999 }),
          async (index: number) => {
            process.argv = [
              'node',
              'script.js',
              '--continue',
              index.toString(),
            ];
            const result = await parseArguments({} as Settings);
            expect(result.continue).toBe(index.toString());
            return true;
          },
        ),
        { numRuns: 30 },
      );
    });

    /**
     * @plan PLAN-20260214-SESSIONBROWSER.P28
     * @requirement REQ-RR-008 --delete-session handles numeric indices
     *
     * Property-based test: For any positive integer index,
     * ['--delete-session', index.toString()] is accepted.
     */
    it('--delete-session handles numeric session indices', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 999 }),
          async (index: number) => {
            process.argv = [
              'node',
              'script.js',
              '--delete-session',
              index.toString(),
            ];
            const result = await parseArguments({} as Settings);
            expect(result.deleteSession).toBe(index.toString());
            return true;
          },
        ),
        { numRuns: 30 },
      );
    });
  });
});
