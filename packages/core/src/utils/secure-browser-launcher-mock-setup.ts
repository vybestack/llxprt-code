/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-compatible mock setup for secure-browser-launcher tests.
 *
 * Bun's mock.module does not apply mocks to source module imports when the
 * value is captured at module scope (e.g. `const x = promisify(execFile)`).
 * Bun registers a mock.module at the moment the call runs, so this module is
 * imported
 * FIRST in the test file, before the source module. This ensures the mock is
 * registered during the import phase, before the source module loads.
 *
 * The mock functions are exported as a mutable holder so the test file can
 * configure them (mockResolvedValue, etc.) and assert on them.
 */

import { vi } from 'bun:test';
import { createRequire } from 'node:module';
import type * as ChildProcessModule from 'node:child_process';
import type { ExecFileOptions } from 'node:child_process';
import type * as FsPromisesModule from 'node:fs/promises';
import type * as OsModule from 'node:os';

const localRequire = createRequire(import.meta.url);
const { mock } = localRequire('bun:test') as {
  mock: {
    module: (specifier: string, factory: () => Record<string, unknown>) => void;
  };
};

type ExecFilePromise = (
  command: string,
  args: string[],
  options: ExecFileOptions,
) => Promise<{ stdout: string; stderr: string }>;

export interface SecureBrowserMockHolder {
  execFile: ReturnType<typeof vi.fn<ExecFilePromise>>;
  stat: ReturnType<typeof vi.fn>;
  platform: ReturnType<typeof vi.fn>;
}

// Create mock functions eagerly (this module runs before the source module)
const execFileMockFn = vi.fn<ExecFilePromise>();
const statMockFn = vi.fn();
// Bun's os.platform() caches the value and does NOT reflect changes to
// process.platform (unlike Node). Mock node:os so the source module reads
// the controllable platform value at runtime.
const platformMockFn = vi.fn(() => process.platform);

export const secureBrowserMocks: SecureBrowserMockHolder = {
  execFile: execFileMockFn,
  stat: statMockFn,
  platform: platformMockFn,
};

// Register mocks using Bun's native mock.module BEFORE any source imports.
// This runs during the import phase, before the source module is loaded.
void mock.module('node:child_process', () => {
  const actual = localRequire(
    'node:child_process',
  ) as typeof ChildProcessModule;
  // Source: const execFileAsync = promisify(execFile)
  // promisify wraps execFile with callback semantics.
  const callbackWrapper = (
    command: string,
    args: string[],
    options: unknown,
    callback: (
      err: Error | null,
      result?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    execFileMockFn(command, args, options as ExecFileOptions)
      .then((result) => callback(null, result))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error))),
      );
  };
  return {
    ...actual,
    execFile: callbackWrapper,
  };
});

void mock.module('node:fs/promises', () => {
  const actual = localRequire('node:fs/promises') as typeof FsPromisesModule;
  return {
    ...actual,
    stat: statMockFn,
  };
});

void mock.module('node:os', () => {
  const actual = localRequire('node:os') as typeof OsModule;
  return {
    ...actual,
    platform: platformMockFn,
  };
});
