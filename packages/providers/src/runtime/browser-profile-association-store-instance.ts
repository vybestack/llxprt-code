/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserProfileAssociationStore } from '../auth/browser-profile-association-store.js';

let storeInstance: BrowserProfileAssociationStore | undefined;

/**
 * Get the singleton BrowserProfileAssociationStore instance.
 * Lazily constructs the store on first call using the default Storage path.
 * Both the runtime accessor and the CLI command use the same file-backed
 * store on the default path, so they see the same data.
 */
export function getBrowserProfileAssociationStore(): BrowserProfileAssociationStore {
  storeInstance ??= new BrowserProfileAssociationStore();
  return storeInstance;
}
