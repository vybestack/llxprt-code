/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  bunAvailable,
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

    it('rejects on maxBuffer overflow rather than satisfying expectedCode 1 (ERR_CHILD_PROCESS_STDIO_MAXBUFFER at 256 bytes)', async () => {
      const tinyMaxBuffer = 256;
      await expect(
        withFixture(({ root, write }) => {
          for (let i = 0; i < 12; i++) {
            write(
              `packages/cli/src/violation${i}.ts`,
              "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
            );
          }
          return runScriptWithMaxBuffer(root, tinyMaxBuffer, 1);
        }),
      ).rejects.toThrow(
        'Guard script exceeded maxBuffer (256 bytes) and was killed (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)',
      );
    }, 60_000);

    it('diagnostic for 128-byte maxBuffer names both the buffer value and ERR_CHILD_PROCESS_STDIO_MAXBUFFER', async () => {
      const tinyMaxBuffer = 128;
      await expect(
        withFixture(({ root, write }) => {
          for (let i = 0; i < 12; i++) {
            write(
              `packages/cli/src/violation${i}.ts`,
              "import { GoogleGenAI } from '@google/genai';\nexport const x = 1;\n",
            );
          }
          return runScriptWithMaxBuffer(root, tinyMaxBuffer, 1);
        }),
      ).rejects.toThrow(
        'Guard script exceeded maxBuffer (128 bytes) and was killed (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)',
      );
    }, 60_000);
  },
);
