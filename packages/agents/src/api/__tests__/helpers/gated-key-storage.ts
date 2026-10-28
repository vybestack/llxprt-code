/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { InMemoryProviderKeyStorage } from './owned-credential-fixture.js';

export interface GatedKeyStorage {
  readonly storage: InMemoryProviderKeyStorage;
  /** Resolves when the named key is first read. */
  readonly entered: Promise<void>;
  /** Lets the held read, and every later one, answer. */
  readonly release: () => void;
}

class NamedKeyGate extends InMemoryProviderKeyStorage {
  constructor(
    private readonly gatedName: string,
    private readonly enter: () => void,
    private readonly open: Promise<void>,
  ) {
    super();
  }

  override async getKey(name: string): Promise<string | null> {
    if (name === this.gatedName) {
      this.enter();
      await this.open;
    }
    return super.getKey(name);
  }
}

/**
 * Provider key storage for `OwnedCredentialFixture.create` whose read of one
 * named key waits for `release`. A provider whose credentials resolve through
 * `auth-key-name` then holds its credential check until the test releases it.
 */
export async function createGatedKeyStorage(
  name: string,
  value: string,
): Promise<GatedKeyStorage> {
  let release!: () => void;
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const storage = new NamedKeyGate(name, enter, open);
  await storage.saveKey(name, value);
  return { storage, entered, release };
}
