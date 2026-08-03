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
 * or similar. On a headless server, a container, an ssh session, WSL or a CI
 * runner there is frequently no such provider installed.
 *
 * Probing for that by calling the native module and catching the failure is not
 * safe. Under Bun on Linux the call can abort the process with a segmentation
 * fault inside libsecret rather than raising a catchable error, so there is
 * nothing left to catch and degrade from. Checking first keeps the process out
 * of that code path entirely, and the caller falls back to the encrypted file
 * exactly as it would for any other unavailable keyring.
 *
 * Two conditions must both hold on Linux:
 *
 * 1. A D-Bus session bus, since the Secret Service is reached over it.
 * 2. An installed Secret Service provider. A session bus on its own is not
 *    enough — a systemd user session provides one on machines that have no
 *    credential store whatsoever. Providers advertise themselves with a D-Bus
 *    activation file named `org.freedesktop.secrets.service`, so its presence
 *    is what distinguishes "a keyring is installed" from "there is merely a
 *    bus".
 */

import { join } from 'node:path';

/** Minimal `existsSync` shape, injected so the check is testable. */
export type FileExistsPredicate = (path: string) => boolean;

/** D-Bus activation file every Secret Service provider installs. */
const SECRETS_SERVICE_FILE = 'org.freedesktop.secrets.service';

/** Locations searched when `XDG_DATA_DIRS` is unset, per the XDG spec. */
const DEFAULT_XDG_DATA_DIRS = ['/usr/local/share', '/usr/share'];

function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * Reports whether a D-Bus session bus is reachable.
 */
function hasSessionBus(
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
 * Collects the directories that may hold D-Bus service activation files, in
 * XDG precedence order: the user's data home first, then the system data dirs.
 */
function dbusServiceDirectories(env: NodeJS.ProcessEnv): string[] {
  const directories: string[] = [];

  const dataHome = env.XDG_DATA_HOME;
  if (hasText(dataHome)) {
    directories.push(dataHome);
  } else if (hasText(env.HOME)) {
    directories.push(join(env.HOME, '.local', 'share'));
  }

  const dataDirs = env.XDG_DATA_DIRS;
  const systemDirs = hasText(dataDirs)
    ? dataDirs.split(':').filter((entry) => entry.trim() !== '')
    : DEFAULT_XDG_DATA_DIRS;
  directories.push(...systemDirs);

  return directories;
}

/**
 * Reports whether a Secret Service provider is installed, by looking for the
 * D-Bus activation file that gnome-keyring, KWallet and friends register.
 */
function hasSecretServiceProvider(
  env: NodeJS.ProcessEnv,
  fileExists: FileExistsPredicate,
): boolean {
  return dbusServiceDirectories(env).some((directory) =>
    fileExists(join(directory, 'dbus-1', 'services', SECRETS_SERVICE_FILE)),
  );
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
  return (
    hasSessionBus(env, fileExists) && hasSecretServiceProvider(env, fileExists)
  );
}
