/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  oauthRuntimeBridge,
  type OAuthRuntimeAccessors,
} from './runtime-accessor-bridge.js';

describe('oauthRuntimeBridge', () => {
  afterEach(() => {
    // Always clean up so tests don't leak accessor state.
    oauthRuntimeBridge.setAccessors(undefined);
  });

  describe('when no accessors are registered', () => {
    beforeEach(() => {
      oauthRuntimeBridge.setAccessors(undefined);
    });

    // These reads previously routed through the CLI's
    // getCliRuntimeServices()/getCliRuntimeContext(), which THREW when no
    // runtime was active. Every consumer wraps the call in its own try/catch
    // and falls back to a default, so the bridge must throw to preserve the
    // original control flow (notably the eager-auth best-effort path).
    it('getEphemeralSetting throws', () => {
      expect(() =>
        oauthRuntimeBridge.getEphemeralSetting('auth.noBrowser'),
      ).toThrow(/not registered/);
    });

    it('getProviderManager throws', () => {
      expect(() => oauthRuntimeBridge.getProviderManager()).toThrow(
        /not registered/,
      );
    });

    it('getRuntimeContext throws', () => {
      expect(() => oauthRuntimeBridge.getRuntimeContext()).toThrow(
        /not registered/,
      );
    });

    it('getCurrentProfileName throws', () => {
      expect(() => oauthRuntimeBridge.getCurrentProfileName()).toThrow(
        /not registered/,
      );
    });
  });

  describe('delegation when accessors are registered', () => {
    it('getEphemeralSetting delegates to the registered accessor', () => {
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: (key: string) =>
          key === 'auth.noBrowser' ? true : undefined,
        getProviderManager: () => undefined,
        getRuntimeContext: () => undefined,
        getCurrentProfileName: () => null,
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(oauthRuntimeBridge.getEphemeralSetting('auth.noBrowser')).toBe(
        true,
      );
      expect(oauthRuntimeBridge.getEphemeralSetting('other.key')).toBe(
        undefined,
      );
    });

    it('getProviderManager delegates to the registered accessor', () => {
      const manager = {
        getProviderByName: (name: string) => ({ name }),
      };
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => undefined,
        getProviderManager: () => manager,
        getRuntimeContext: () => undefined,
        getCurrentProfileName: () => null,
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(oauthRuntimeBridge.getProviderManager()).toBe(manager);
      expect(
        oauthRuntimeBridge.getProviderManager()?.getProviderByName('gemini'),
      ).toStrictEqual({ name: 'gemini' });
    });

    it('getRuntimeContext delegates to the registered accessor', () => {
      const ctx = { runtimeId: 'rt-123' };
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => undefined,
        getProviderManager: () => undefined,
        getRuntimeContext: () => ctx,
        getCurrentProfileName: () => null,
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(oauthRuntimeBridge.getRuntimeContext()).toBe(ctx);
      expect(oauthRuntimeBridge.getRuntimeContext()?.runtimeId).toBe('rt-123');
    });

    it('getCurrentProfileName delegates to the registered accessor', () => {
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => undefined,
        getProviderManager: () => undefined,
        getRuntimeContext: () => undefined,
        getCurrentProfileName: () => 'my-profile',
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(oauthRuntimeBridge.getCurrentProfileName()).toBe('my-profile');
    });
  });

  describe('clearing accessors', () => {
    it('setAccessors(undefined) reverts to defaults', () => {
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => true,
        getProviderManager: () => ({ getProviderByName: () => null }),
        getRuntimeContext: () => ({ runtimeId: 'x' }),
        getCurrentProfileName: () => 'p',
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(oauthRuntimeBridge.getEphemeralSetting('k')).toBe(true);
      expect(oauthRuntimeBridge.getProviderManager()).toBeDefined();
      expect(oauthRuntimeBridge.getRuntimeContext()).toBeDefined();
      expect(oauthRuntimeBridge.getCurrentProfileName()).toBe('p');

      oauthRuntimeBridge.setAccessors(undefined);

      expect(() => oauthRuntimeBridge.getEphemeralSetting('k')).toThrow(
        /not registered/,
      );
      expect(() => oauthRuntimeBridge.getProviderManager()).toThrow(
        /not registered/,
      );
      expect(() => oauthRuntimeBridge.getRuntimeContext()).toThrow(
        /not registered/,
      );
      expect(() => oauthRuntimeBridge.getCurrentProfileName()).toThrow(
        /not registered/,
      );
    });
  });

  describe('getRuntimeContext error propagation', () => {
    it('propagates errors from the accessor so callers can catch them', () => {
      const error = new Error('runtime not initialized');
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => undefined,
        getProviderManager: () => undefined,
        getRuntimeContext: () => {
          throw error;
        },
        getCurrentProfileName: () => null,
      };
      oauthRuntimeBridge.setAccessors(accessors);

      expect(() => oauthRuntimeBridge.getRuntimeContext()).toThrow(
        'runtime not initialized',
      );
    });

    it('delegates getEphemeralSetting to the accessor without bridge-level error handling', () => {
      // The bridge does NOT add its own try/catch around getEphemeralSetting,
      // getProviderManager, or getCurrentProfileName. The old dynamic-import
      // try/catch only guarded the import, not the accessor call itself, so the
      // call was always outside the import guard for these three. This test
      // documents that the bridge delegates faithfully: when the accessor
      // returns normally, so does the bridge (callers handle their own errors).
      const accessors: OAuthRuntimeAccessors = {
        getEphemeralSetting: () => 'value',
        getProviderManager: () => undefined,
        getRuntimeContext: () => undefined,
        getCurrentProfileName: () => null,
      };
      oauthRuntimeBridge.setAccessors(accessors);

      // When the accessor returns normally, so does the bridge
      expect(oauthRuntimeBridge.getEphemeralSetting('k')).toBe('value');
    });
  });
});
