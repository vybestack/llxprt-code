/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BunTestWorkspaceEntry } from './bun-test-manifest.ts';

export const STORAGE_MANIFEST_ENTRY: BunTestWorkspaceEntry = {
  workspace: 'storage',
  // Both preloads must be listed here: run_bun_tests.ts passes these as
  // explicit --preload args and does NOT read packages/storage/bunfig.toml, so
  // a preload declared only there would be silently dropped in manifest-driven
  // runs (which is what `npm test` uses) and the process-wide keyring latch
  // would leak between test files.
  preload: [
    'test-setup-storage-isolation.ts',
    'test-setup-bun-session-reset.ts',
  ],
  files: [
    'test-bun/credential-write-lock.bun.ts',
    'test-bun/keyring-delete-verification.bun.ts',
    'test-bun/keychain-grant-persistence.bun.ts',
    'test-bun/keyring-opt-out.bun.ts',
    'test-bun/keyring-write-verification.bun.ts',
    'test-bun/machine-secret.bun.ts',
    'test-bun/machine-secret.concurrent-write.bun.ts',
    'test-bun/secure-store.bun.ts',
    'test-bun/secure-store.fallback-hardening.bun.ts',
    'test-bun/secure-store.concurrent-write.bun.ts',
    'test-bun/secure-store.runtime-replaced.bun.ts',
    'test-bun/secure-store.keyring-session.bun.ts',
    'test-bun/storage.bun.ts',
    'src/secure-store/provider-key-storage.test.ts',
    'src/secure-store/secure-store-integration.test.ts',
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
    'src/secure-store/envelope.test.ts',
    'src/secure-store/runtime-identity.test.ts',
    'src/secure-store/secure-store.migration.test.ts',
    'src/config/path-resolver.test.ts',
    'src/config/storage.agentsSecurity.test.ts',
    'src/utils/gitIgnoreParser.test.ts',
    'src/testing/isolateStorageRoots.test.ts',
    'src/services/fileDiscoveryService.test.ts',
    'src/services/fileSystemService.test.ts',
    'src/conversation/ConversationFileWriter.test.ts',
    'src/session/sessionTypes.test.ts',
  ],
};
