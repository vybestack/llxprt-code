/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isPlatformCredentialStoreReachable } from './platform-credential-store.js';

const SYSTEM_SECRETS_SERVICE =
  '/usr/share/dbus-1/services/org.freedesktop.secrets.service';

const NO_FILES = () => false;

/** Builds a file predicate that reports only the listed paths as present. */
function filesPresent(...paths: readonly string[]): (path: string) => boolean {
  const present = new Set(paths);
  return (path) => present.has(path);
}

const BUS_ENV = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' };

describe('isPlatformCredentialStoreReachable', () => {
  describe('linux', () => {
    it('is reachable with both a session bus and an installed provider', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          BUS_ENV,
          filesPresent(SYSTEM_SECRETS_SERVICE),
        ),
      ).toBe(true);
    });

    it('accepts a session bus socket in the runtime directory', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { XDG_RUNTIME_DIR: '/run/user/1000' },
          filesPresent('/run/user/1000/bus', SYSTEM_SECRETS_SERVICE),
        ),
      ).toBe(true);
    });

    it('accepts a provider installed under the user data home', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { ...BUS_ENV, HOME: '/home/dev' },
          filesPresent(
            '/home/dev/.local/share/dbus-1/services/org.freedesktop.secrets.service',
          ),
        ),
      ).toBe(true);
    });

    it('honours XDG_DATA_DIRS when searching for a provider', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { ...BUS_ENV, XDG_DATA_DIRS: '/opt/kde/share:/usr/share' },
          filesPresent(
            '/opt/kde/share/dbus-1/services/org.freedesktop.secrets.service',
          ),
        ),
      ).toBe(true);
    });

    it('is unreachable when a session bus exists but no provider is installed', () => {
      // The shape of a CI runner or a systemd user session on a headless box:
      // there is a bus, but nothing answers org.freedesktop.secrets.
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { ...BUS_ENV, XDG_RUNTIME_DIR: '/run/user/1001' },
          filesPresent('/run/user/1001/bus'),
        ),
      ).toBe(false);
    });

    it('is unreachable when a provider is installed but no session bus exists', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          {},
          filesPresent(SYSTEM_SECRETS_SERVICE),
        ),
      ).toBe(false);
    });

    it('is unreachable with neither a bus nor a provider', () => {
      expect(isPlatformCredentialStoreReachable('linux', {}, NO_FILES)).toBe(
        false,
      );
    });

    it('treats a blank session bus address as absent', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { DBUS_SESSION_BUS_ADDRESS: '   ' },
          filesPresent(SYSTEM_SECRETS_SERVICE),
        ),
      ).toBe(false);
    });
  });

  describe('platforms with a built-in credential store', () => {
    it('is reachable on macOS regardless of D-Bus', () => {
      expect(isPlatformCredentialStoreReachable('darwin', {}, NO_FILES)).toBe(
        true,
      );
    });

    it('is reachable on Windows regardless of D-Bus', () => {
      expect(isPlatformCredentialStoreReachable('win32', {}, NO_FILES)).toBe(
        true,
      );
    });
  });
});
