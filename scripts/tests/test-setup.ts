/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Setup shared by every script-harness test file, loaded as a Bun `--preload`.
 *
 * This file previously mocked `fs.appendFileSync` globally. No test asserted
 * on that mock, and under Bun a `vi.mock('fs')` registration also intercepts
 * `node:fs`, which broke script tests that legitimately append to a temporary
 * `GITHUB_OUTPUT` / `GITHUB_STEP_SUMMARY` file and then read it back. Those
 * scripts already write only when the corresponding environment variable is
 * set, and the tests point it at a temp file, so real I/O is correct here.
 */

import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import { beforeEach } from 'bun:test';

beforeEach(async () => {
  await yieldToEventLoop();
});

/**
 * Vitest intercepts `process.exit()` and turns it into a thrown error so tests
 * can assert on exit behaviour. Bun does not: calling it terminates the test
 * runner mid-file. This installs an equivalent interception. The message is
 * this harness's own and is asserted verbatim by ci-quota-check.test.ts, so it
 * must not be reworded without updating those assertions.
 */
function interceptedExit(code?: number): never {
  // The value is interpolated raw, so a no-argument process.exit() produces
  // "undefined" in the message, which is what the assertions expect.
  throw new Error(`process.exit unexpectedly called with "${code}"`);
}

if (typeof Bun !== 'undefined') {
  Object.defineProperty(process, 'exit', {
    value: interceptedExit,
    writable: true,
    configurable: true,
  });
}
