/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Credential-store outage policy for the token access paths (issue #2962).
 *
 * A store outage is not an absent credential. When the running runtime has been
 * unlinked from disk, macOS can no longer identify the process, so securityd
 * cannot evaluate any Keychain item's ACL and SecureStore fails every operation
 * with a terminal `RUNTIME_REPLACED` error. `keyring-token-store` deliberately
 * rethrows it rather than degrading.
 *
 * The token read paths, however, all catch broadly and return `null`/`undefined`
 * so that a routine read failure behaves as a cache miss. Left unguarded, that
 * turns "the credential store is broken" into "there is no token", and the
 * provider layer then tells the user to re-authenticate — a login that cannot
 * possibly succeed, because nothing can be read or written while the store is
 * unusable.
 */

import { isRuntimeReplacedError } from '@vybestack/llxprt-code-storage';

/**
 * Rethrows `error` when it is the terminal credential-store outage, so callers
 * can keep their ordinary "treat failures as a cache miss" behaviour for
 * everything else.
 *
 * Returns normally for any other error, leaving the caller's existing handling
 * untouched.
 */
export function rethrowIfStoreOutage(error: unknown): void {
  if (isRuntimeReplacedError(error)) {
    throw error;
  }
}
