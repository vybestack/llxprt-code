/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestRig } from './test-helper.js';

describe('stdin context', () => {
  let rig: TestRig;

  beforeEach(() => {
    rig = new TestRig();
  });

  afterEach(async () => await rig.cleanup());

  it.skipIf(process.platform === 'win32')(
    'should exit quickly if stdin stream does not end',
    async () => {
      /*
      This simulates scenario where gemini gets stuck waiting for stdin.
      This happens in situations where process.stdin.isTTY is false
      even though gemini is intended to run interactively.
      
      Note: This test is skipped on Windows due to differences in process
      termination behavior and stderr output when stdin doesn't end.
    */

      await rig.setup('should exit quickly if stdin stream does not end');

      try {
        await rig.run({ stdinDoesNotEnd: true });
        throw new Error('Expected rig.run to throw an error');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        const err = error as Error;

        expect(err.message).toContain('Process exited with code 1');
        expect(err.message).toContain('No input provided via stdin.');
        console.log('Error message:', err.message);
      }
      const lastRequest = rig.readLastApiRequest();
      expect(lastRequest).toBeNull();

      // If this test times out, runs indefinitely, it's a regression.
    },
    5000,
  );
});
