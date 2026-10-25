/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach } from 'bun:test';

export function useCliGenerationEnvironment(): void {
  let navigator: PropertyDescriptor | undefined;
  beforeEach(() => {
    navigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Reflect.deleteProperty(globalThis, 'navigator');
  });
  afterEach(() => {
    if (navigator !== undefined)
      Object.defineProperty(globalThis, 'navigator', navigator);
  });
}
