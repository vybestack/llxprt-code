/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi as bunVi } from 'bun:test';

interface CliViCompatibility {
  advanceTimersByTimeAsync(milliseconds: number): Promise<void>;
  clearAllTimers(): void;
  hoisted<T>(factory: () => T): T;
  mock(
    id: string,
    factory?: (importOriginal: () => Promise<unknown>) => unknown,
  ): unknown;
  useFakeTimers(options?: { now?: number | Date }): unknown;
  useRealTimers(): unknown;
}

type CliBunVi = Omit<typeof bunVi, keyof CliViCompatibility> &
  CliViCompatibility;

// bunfig.toml installs these compatibility methods before CLI tests load.
export const vi = bunVi as CliBunVi;
