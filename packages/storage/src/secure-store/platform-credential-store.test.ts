/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isPlatformCredentialStoreReachable } from './platform-credential-store.js';

const NO_FILES = () => false;
const ALL_FILES = () => true;

describe('isPlatformCredentialStoreReachable', () => {
  describe('linux', () => {
    it('is reachable when a session bus address is exported', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' },
          NO_FILES,
        ),
      ).toBe(true);
    });

    it('is reachable when the runtime directory holds a session bus socket', () => {
      const seen: string[] = [];
      const reachable = isPlatformCredentialStoreReachable(
        'linux',
        { XDG_RUNTIME_DIR: '/run/user/1000' },
        (path) => {
          seen.push(path);
          return true;
        },
      );

      expect(reachable).toBe(true);
      expect(seen).toContain('/run/user/1000/bus');
    });

    it('is unreachable with no session bus address and no socket', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { XDG_RUNTIME_DIR: '/run/user/1000' },
          NO_FILES,
        ),
      ).toBe(false);
    });

    it('is unreachable when the environment carries neither variable', () => {
      expect(isPlatformCredentialStoreReachable('linux', {}, ALL_FILES)).toBe(
        false,
      );
    });

    it('treats a blank session bus address as absent', () => {
      expect(
        isPlatformCredentialStoreReachable(
          'linux',
          { DBUS_SESSION_BUS_ADDRESS: '   ' },
          NO_FILES,
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
