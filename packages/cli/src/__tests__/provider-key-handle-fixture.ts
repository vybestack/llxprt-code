/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';

/**
 * In-memory stand-in for the key handle a credential authority creates for one
 * interactive UI root. `closeCount` lets a test observe how many times the
 * owner released it; `closeError` makes the release fail the way a broken
 * credential transport does.
 */
export class InMemoryProviderKeyHandle implements ProviderKeyStorageLike {
  readonly #keys = new Map<string, string>();
  closeCount = 0;

  constructor(private readonly closeError?: Error) {}

  saveKey(name: string, apiKey: string): Promise<void> {
    this.#keys.set(name, apiKey);
    return Promise.resolve();
  }

  getKey(name: string): Promise<string | null> {
    return Promise.resolve(this.#keys.get(name) ?? null);
  }

  deleteKey(name: string): Promise<boolean> {
    return Promise.resolve(this.#keys.delete(name));
  }

  listKeys(): Promise<string[]> {
    return Promise.resolve([...this.#keys.keys()]);
  }

  hasKey(name: string): Promise<boolean> {
    return Promise.resolve(this.#keys.has(name));
  }

  close(): void {
    this.closeCount += 1;
    if (this.closeError !== undefined) throw this.closeError;
  }
}
