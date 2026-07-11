/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const originalValues = new Map<string, string | undefined>();

export function setEnv(key: string, value: string): void {
  if (!originalValues.has(key)) {
    originalValues.set(key, process.env[key]);
  }
  process.env[key] = value;
}

export function restoreEnv(): void {
  for (const [key, value] of originalValues) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  originalValues.clear();
}
