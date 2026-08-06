/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Matchers Bun's `expect` implements at runtime but `bun-types` does not
 * declare. Verified against Bun 1.3.14 before being declared here; this file
 * adds no behaviour, it only describes what the runtime already provides.
 */
declare module 'bun:test' {
  interface Matchers<T = unknown> {
    toHaveBeenCalledOnce(): T;
  }
}

export {};
