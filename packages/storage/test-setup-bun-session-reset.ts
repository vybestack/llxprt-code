/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bun-only preload that resets process-wide secure-store module state between
 * tests.
 *
 * The OS keyring session latch (issue #2928) and the machine-secret cache are
 * process-wide. A test that exercises a DENIED/LOCKED path latches the keyring
 * for the rest of the Bun process, which would turn every later
 * healthy-keyring assertion red.
 *
 * This lives in its own file rather than in test-setup-storage-isolation.ts
 * because that file is loaded by BOTH bunfig.toml and vitest.config.ts, and
 * importing `bun:test` there breaks Vitest collection with
 * "Cannot find package 'bun:test'".
 *
 * @plan PLAN-20260805-ISSUE2928
 * @requirement R2
 */

import { beforeEach, afterEach } from 'bun:test';
import { resetOsKeyringSessionForTesting } from './src/secure-store/keyring-session-state.js';
import { resetMachineSecretCache } from './src/secure-store/machine-secret.js';

function resetSecureStoreProcessState(): void {
  resetOsKeyringSessionForTesting();
  resetMachineSecretCache();
}

beforeEach(resetSecureStoreProcessState);
afterEach(resetSecureStoreProcessState);
