/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export class EphemeralDefaultOwnership {
  private providerDefaultEntries: ReadonlyMap<string, unknown> = new Map();
  private modelDefaultKeys: ReadonlySet<string> = new Set();
  private userEphemeralKeys: ReadonlySet<string> = new Set();

  checkpoint(): () => void {
    const providerEntries = structuredClone(this.providerDefaultEntries);
    const modelKeys = new Set(this.modelDefaultKeys);
    const userKeys = new Set(this.userEphemeralKeys);
    return () => {
      this.providerDefaultEntries = providerEntries;
      this.modelDefaultKeys = modelKeys;
      this.userEphemeralKeys = userKeys;
    };
  }

  recordProviderDefaultOwnedEntries(
    entries: Iterable<readonly [string, unknown]>,
  ): void {
    this.providerDefaultEntries = new Map(entries);
    this.modelDefaultKeys = new Set();
  }

  recordModelDefaultOwnedKeys(keys: Iterable<string>): void {
    this.modelDefaultKeys = new Set(keys);
  }

  getProviderDefaultOwnedEntries(): ReadonlyMap<string, unknown> {
    return this.providerDefaultEntries;
  }

  getModelDefaultOwnedKeys(): ReadonlySet<string> {
    return this.modelDefaultKeys;
  }

  isEphemeralUserOwned(key: string): boolean {
    return this.userEphemeralKeys.has(key);
  }

  markEphemeralUserOwned(key: string): void {
    this.releaseDefaultOwnership(key);
    if (!this.userEphemeralKeys.has(key))
      this.userEphemeralKeys = new Set([...this.userEphemeralKeys, key]);
  }

  private releaseDefaultOwnership(key: string): void {
    if (this.modelDefaultKeys.has(key))
      this.modelDefaultKeys = new Set(
        [...this.modelDefaultKeys].filter((entry) => entry !== key),
      );
    if (this.providerDefaultEntries.has(key))
      this.providerDefaultEntries = new Map(
        [...this.providerDefaultEntries].filter(([entry]) => entry !== key),
      );
  }

  releaseEphemeralOwnership(key: string): void {
    this.releaseDefaultOwnership(key);
    if (this.userEphemeralKeys.has(key))
      this.userEphemeralKeys = new Set(
        [...this.userEphemeralKeys].filter((entry) => entry !== key),
      );
  }
}
