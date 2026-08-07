/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Replaces properties on `globalThis` for the duration of a test and puts the
 * originals back afterwards.
 *
 * Bun's test runner has no global-stubbing primitive, so tests that swap
 * `fetch` or `process` record the previous binding here and restore it in
 * their teardown hook. Mirrors the env helpers in `env-test-helpers.ts`.
 */

interface OriginalBinding {
  readonly existed: boolean;
  readonly value: unknown;
}

const originalBindings = new Map<string, OriginalBinding>();

export function setGlobal(key: string, value: unknown): void {
  if (!originalBindings.has(key)) {
    originalBindings.set(key, {
      existed: key in globalThis,
      value: (globalThis as Record<string, unknown>)[key],
    });
  }
  (globalThis as Record<string, unknown>)[key] = value;
}

export function restoreGlobals(): void {
  for (const [key, original] of originalBindings) {
    if (original.existed) {
      (globalThis as Record<string, unknown>)[key] = original.value;
    } else {
      delete (globalThis as Record<string, unknown>)[key];
    }
  }
  originalBindings.clear();
}
