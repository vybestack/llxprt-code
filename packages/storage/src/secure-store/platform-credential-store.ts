/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pre-flight check for whether an OS credential store can exist at all on this
 * machine, used to decide whether loading the native keyring is safe.
 *
 * macOS and Windows ship a credential store as part of the OS. Linux does not:
 * there the store is a D-Bus Secret Service provided by gnome-keyring, KWallet
 * or similar. On a headless server, a container, an ssh session or WSL there is
 * frequently no session bus at all, and therefore no credential store.
 *
 * Probing for that by calling the native module and catching the failure is not
 * safe. Under Bun on Linux the call can abort the process with a segmentation
 * fault inside libsecret rather than raising a catchable error, so there is
 * nothing left to catch and degrade from. Checking for the session bus first
 * keeps the process out of that code path entirely, and the caller falls back
 * to the encrypted file exactly as it would for any other unavailable keyring.
 */

import { join } from 'node:path';

/** Minimal `existsSync` shape, injected so the check is testable. */
export type FileExistsPredicate = (path: string) => boolean;

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Reports whether a D-Bus session bus — and therefore a possible Secret
 * Service — is reachable on Linux.
 */
function hasLinuxSessionBus(
  env: NodeJS.ProcessEnv,
  fileExists: FileExistsPredicate,
): boolean {
  if (hasText(env.DBUS_SESSION_BUS_ADDRESS)) {
    return true;
  }
  // Systemd user sessions expose the bus socket here even when the address
  // variable has not been exported into this process.
  const runtimeDir = env.XDG_RUNTIME_DIR;
  return hasText(runtimeDir) ? fileExists(join(runtimeDir, 'bus')) : false;
}

/**
 * Reports whether it is safe to load and call the native OS credential store.
 *
 * Returning `false` means "there is definitively no credential store here", not
 * "the credential store rejected us" — callers should degrade to their fallback
 * rather than surface an error.
 */
export function isPlatformCredentialStoreReachable(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  fileExists: FileExistsPredicate,
): boolean {
  if (platform !== 'linux') {
    return true;
  }
  return hasLinuxSessionBus(env, fileExists);
}
