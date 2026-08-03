/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BunTestWorkspaceEntry } from './bun-test-manifest.ts';

export const STORAGE_MANIFEST_ENTRY: BunTestWorkspaceEntry = {
  workspace: 'storage',
  preload: 'test-setup-storage-isolation.ts',
  files: [
    'src/secure-store/provider-key-storage.test.ts',
    'src/secure-store/secure-store-integration.test.ts',
    'src/secure-store/secure-store.spec.ts',
    'src/secure-store/secure-store.fallback-v2.test.ts',
    'src/secure-store/secure-store.fallback2.test.ts',
    'src/secure-store/secure-store-errors.test.ts',
    'src/secure-store/secure-store.basic.test.ts',
    'src/secure-store/secure-store.fallback.test.ts',
    'src/secure-store/secure-store.fallback.xdg-paths.test.ts',
    'src/secure-store/secure-store.dual-mode.test.ts',
    'src/secure-store/secure-store.native-keyring.test.ts',
    'src/secure-store/envelope-codec.test.ts',
    'src/secure-store/secure-store.fallback-behavior.test.ts',
    'src/secure-store/provider-key-storage.fallback.test.ts',
    'src/secure-store/secure-store.runtime-replaced.test.ts',
    'src/secure-store/envelope.test.ts',
    'src/secure-store/runtime-identity.test.ts',
    'src/secure-store/secure-store.migration.test.ts',
    'src/secure-store/machine-secret.test.ts',
    'src/config/path-resolver.test.ts',
    'src/config/storage.agentsSecurity.test.ts',
    'src/config/storage.test.ts',
    'src/utils/gitIgnoreParser.test.ts',
    'src/testing/isolateStorageRoots.test.ts',
    'src/services/fileDiscoveryService.test.ts',
    'src/services/fileSystemService.test.ts',
    'src/conversation/ConversationFileWriter.test.ts',
    'src/session/sessionTypes.test.ts',
  ],
};
