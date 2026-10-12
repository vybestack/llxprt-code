/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ProviderKeyStorageLike } from '@vybestack/llxprt-code-storage';

export class KeyCompletionOwner {
  private names: readonly string[] | undefined;
  private expiresAt = 0;
  private generation = 0;
  private pending: Promise<readonly string[]> | undefined;

  constructor(private readonly readStorage: () => ProviderKeyStorageLike) {}

  invalidate(): void {
    this.generation += 1;
    this.names = undefined;
    this.pending = undefined;
  }

  async list(): Promise<readonly string[]> {
    if (this.names && this.expiresAt > Date.now()) return this.names;
    if (this.pending) return this.pending;
    const generation = this.generation;
    const pending = this.readStorage().listKeys();
    this.pending = pending;
    try {
      const names = await pending;
      if (this.generation === generation) {
        this.names = names;
        this.expiresAt = Date.now() + 5000;
      }
      return names;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }
}

export function createKeyCommandReads(
  readStorage: (() => ProviderKeyStorageLike) | undefined,
): {
  getProviderKeys(): ProviderKeyStorageLike;
  listKeyCompletionNames(): Promise<readonly string[]>;
  invalidateKeyCompletion(): void;
} {
  const requiredStorage = (): ProviderKeyStorageLike => {
    if (!readStorage)
      throw new Error('Key commands require an explicit credential owner');
    return readStorage();
  };
  const owner = new KeyCompletionOwner(requiredStorage);
  return {
    getProviderKeys: requiredStorage,
    listKeyCompletionNames: () => owner.list(),
    invalidateKeyCompletion: () => owner.invalidate(),
  };
}
