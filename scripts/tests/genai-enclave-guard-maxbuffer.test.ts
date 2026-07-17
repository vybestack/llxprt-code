/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  bunAvailable,
  GEMINI_IMPORT,
  runScriptWithMaxBuffer,
  withFixture,
} from './genai-enclave-guard-helpers.ts';

describe.skipIf(process.env.CI !== 'true' && !bunAvailable())(
  'check-genai-enclave (maxBuffer overflow)',
  () => {
    beforeAll(() => {
      if (process.env.CI === 'true' && !bunAvailable()) {
        throw new Error(
          '[genai-enclave] Bun runtime not found — install Bun or set BUN_EXECUTABLE.',
        );
      }
    });

    it.each([256, 128])(
      'rejects on maxBuffer overflow at %i bytes rather than satisfying expectedCode 1',
      async (tinyMaxBuffer) => {
        await expect(
          withFixture(({ root, write }) => {
            for (let i = 0; i < 12; i++) {
              write(`packages/cli/src/violation${i}.ts`, GEMINI_IMPORT);
            }
            return runScriptWithMaxBuffer(root, tinyMaxBuffer, 1);
          }),
        ).rejects.toThrow(
          `Guard script exceeded maxBuffer (${tinyMaxBuffer} bytes) and was killed (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)`,
        );
      },
      60_000,
    );
  },
);
