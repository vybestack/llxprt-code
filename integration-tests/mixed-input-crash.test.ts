/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { TestRig } from './test-helper.js';

describe('mixed input crash prevention', () => {
  it('should not crash when using mixed prompt inputs', async () => {
    const rig = new TestRig();
    rig.setup('should not crash when using mixed prompt inputs');

    // Test: echo "say '1'." | gemini --prompt-interactive="say '2'." say '3'.
    const stdinContent = "say '1'.";

    try {
      // This test validates CLI error handling, not LLM functionality.
      // Use runCommand to bypass profile loading and test the raw CLI behavior.
      await rig.runCommand(['--prompt-interactive', "say '2'.", "say '3'."], {
        stdin: stdinContent,
      });
      throw new Error('Expected the command to fail, but it succeeded');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      const err = error as Error;

      // Windows may exit with 3221226505 (0xC0000409 STATUS_STACK_BUFFER_OVERRUN)
      // due to libuv async.c assertion failure when process exits
      expect(
        err.message.includes('Process exited with code 1') ||
          err.message.includes('Process exited with code 3221226505'),
      ).toBe(true);
      expect(err.message).toContain(
        '--prompt-interactive flag cannot be used when input is piped',
      );
      expect(err.message).not.toContain('setRawMode is not a function');
      expect(err.message).not.toContain('unexpected critical error');
    }

    const lastRequest = rig.readLastApiRequest();
    expect(lastRequest).toBeNull();
  });

  it('should provide clear error message for mixed input', async () => {
    const rig = new TestRig();
    rig.setup('should provide clear error message for mixed input');

    try {
      // This test validates CLI error handling, not LLM functionality.
      // Use runCommand to bypass profile loading and test the raw CLI behavior.
      await rig.runCommand(['--prompt-interactive', 'test prompt'], {
        stdin: 'test input',
      });
      throw new Error('Expected the command to fail, but it succeeded');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      const err = error as Error;

      expect(err.message).toContain(
        '--prompt-interactive flag cannot be used when input is piped',
      );
    }
  });
});
