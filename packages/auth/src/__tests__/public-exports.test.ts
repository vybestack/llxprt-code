/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P10
 * @requirement REQ-AUTH-001.2, REQ-AUTH-001.3, REQ-API-001.4
 *
 * Compile/public import tests for auth package main entry.
 * Verifies that key public exports are available from the auth package
 * using canonical import/re-export patterns.
 *
 * Core factory exports (createKeyringTokenStore, createAuthPrecedenceResolver)
 * stay in @vybestack/llxprt-code-core and must not be exported from auth.
 */

import { describe, it, expect } from 'vitest';

// Import from auth package main entry using canonical specifier
import {
  AuthPrecedenceResolver,
  flushRuntimeAuthScope,
  KeyringTokenStore,
  CodexDeviceFlow,
  QwenDeviceFlow,
  AnthropicDeviceFlow,
  OAuthError,
  OAuthErrorFactory,
  OAuthErrorType,
  OAuthErrorCategory,
  mergeRefreshedToken,
  sanitizeTokenForProxy,
  ProxyTokenStore,
  ProxyProviderKeyStorage,
  ProxySocketClient,
  encodeFrame,
  FrameDecoder,
  resolveProfileId,
  buildCacheKey,
  ensureRuntimeState,
  runtimeScopedStates,
} from '../index.js';

import type {
  ISecureStore,
  ISettingsService,
  IDebugLogger,
  IProviderKeyStorage,
  IProviderRuntimeContext,
  GetActiveRuntimeContext,
  OAuthToken,
  AuthPrecedenceConfig,
  OAuthManager,
} from '../index.js';

describe('Auth package public export tests', () => {
  describe('AuthPrecedenceResolver export', () => {
    it('AuthPrecedenceResolver is exported from main entry', () => {
      expect(AuthPrecedenceResolver).toBeDefined();
      expect(typeof AuthPrecedenceResolver).toBe('function');
    });

    it('AuthPrecedenceResolver is constructable', () => {
      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test' },
        {
          settingsService: {
            get: () => undefined,
            getProviderSettings: () => ({}),
            on: () => {},
            off: () => {},
          },
        },
      );
      expect(resolver).toBeInstanceOf(AuthPrecedenceResolver);
    });

    it('AuthPrecedenceResolver has resolveAuthentication method', () => {
      const resolver = new AuthPrecedenceResolver(
        { providerId: 'test' },
        {
          settingsService: {
            get: () => undefined,
            getProviderSettings: () => ({}),
            on: () => {},
            off: () => {},
          },
        },
      );
      expect(typeof resolver.resolveAuthentication).toBe('function');
      expect(typeof resolver.hasNonOAuthAuthentication).toBe('function');
      expect(typeof resolver.isOAuthOnlyAvailable).toBe('function');
      expect(typeof resolver.getAuthMethodName).toBe('function');
      expect(typeof resolver.invalidateCache).toBe('function');
      expect(typeof resolver.invalidateProviderCache).toBe('function');
    });
  });

  describe('flushRuntimeAuthScope export', () => {
    it('flushRuntimeAuthScope is exported from main entry', () => {
      expect(flushRuntimeAuthScope).toBeDefined();
      expect(typeof flushRuntimeAuthScope).toBe('function');
    });

    it('flushRuntimeAuthScope returns flush result for unknown runtime', () => {
      const result = flushRuntimeAuthScope('nonexistent-runtime-id');
      expect(result).toStrictEqual({
        runtimeId: 'nonexistent-runtime-id',
        revokedTokens: [],
      });
    });
  });

  describe('KeyringTokenStore export', () => {
    it('KeyringTokenStore is exported from main entry', () => {
      expect(KeyringTokenStore).toBeDefined();
      expect(typeof KeyringTokenStore).toBe('function');
    });
  });

  describe('Device flow exports', () => {
    it('CodexDeviceFlow is exported from main entry', () => {
      expect(CodexDeviceFlow).toBeDefined();
      expect(typeof CodexDeviceFlow).toBe('function');
    });

    it('QwenDeviceFlow is exported from main entry', () => {
      expect(QwenDeviceFlow).toBeDefined();
      expect(typeof QwenDeviceFlow).toBe('function');
    });

    it('AnthropicDeviceFlow is exported from main entry', () => {
      expect(AnthropicDeviceFlow).toBeDefined();
      expect(typeof AnthropicDeviceFlow).toBe('function');
    });
  });

  describe('OAuth error exports', () => {
    it('OAuthError and related exports are available', () => {
      expect(OAuthError).toBeDefined();
      expect(OAuthErrorFactory).toBeDefined();
      expect(OAuthErrorType).toBeDefined();
      expect(OAuthErrorCategory).toBeDefined();
    });
  });

  describe('Token utility exports', () => {
    it('mergeRefreshedToken is exported', () => {
      expect(mergeRefreshedToken).toBeDefined();
      expect(typeof mergeRefreshedToken).toBe('function');
    });

    it('sanitizeTokenForProxy is exported', () => {
      expect(sanitizeTokenForProxy).toBeDefined();
      expect(typeof sanitizeTokenForProxy).toBe('function');
    });
  });

  describe('Proxy infrastructure exports', () => {
    it('ProxyTokenStore is exported', () => {
      expect(ProxyTokenStore).toBeDefined();
    });

    it('ProxyProviderKeyStorage is exported', () => {
      expect(ProxyProviderKeyStorage).toBeDefined();
    });

    it('ProxySocketClient is exported', () => {
      expect(ProxySocketClient).toBeDefined();
    });

    it('encodeFrame and FrameDecoder are exported', () => {
      expect(encodeFrame).toBeDefined();
      expect(FrameDecoder).toBeDefined();
    });
  });

  describe('Precedence utility exports', () => {
    it('resolveProfileId is exported', () => {
      expect(resolveProfileId).toBeDefined();
      expect(typeof resolveProfileId).toBe('function');
    });

    it('buildCacheKey is exported', () => {
      expect(buildCacheKey).toBeDefined();
      expect(typeof buildCacheKey).toBe('function');
    });

    it('ensureRuntimeState is exported', () => {
      expect(ensureRuntimeState).toBeDefined();
      expect(typeof ensureRuntimeState).toBe('function');
    });

    it('runtimeScopedStates is exported', () => {
      expect(runtimeScopedStates).toBeDefined();
      expect(runtimeScopedStates).toBeInstanceOf(Map);
    });
  });

  describe('DI interface type exports', () => {
    it('ISecureStore type is available', () => {
      // Type-level test: if this compiles, the type export works
      const _secureStore: ISecureStore = {
        get: async () => null,
        set: async () => {},
        delete: async () => false,
        list: async () => [],
        has: async () => false,
      };
      expect(_secureStore).toBeDefined();
    });

    it('ISettingsService type is available', () => {
      const _settings: ISettingsService = {
        get: () => undefined,
        getProviderSettings: () => ({}),
        on: () => {},
        off: () => {},
      };
      expect(_settings).toBeDefined();
    });

    it('IDebugLogger type is available', () => {
      const _logger: IDebugLogger = {
        debug: () => {},
        error: () => {},
        warn: () => {},
        log: () => {},
      };
      expect(_logger).toBeDefined();
    });

    it('IProviderKeyStorage type is available', () => {
      const _storage: IProviderKeyStorage = {
        getKey: async () => null,
        listKeys: async () => [],
        hasKey: async () => false,
      };
      expect(_storage).toBeDefined();
    });

    it('IProviderRuntimeContext type is available', () => {
      const _ctx: IProviderRuntimeContext = {
        settingsService: {
          get: () => undefined,
          getProviderSettings: () => ({}),
          on: () => {},
          off: () => {},
        },
        runtimeId: 'test',
        metadata: {},
      };
      expect(_ctx).toBeDefined();
    });

    it('GetActiveRuntimeContext type is available', () => {
      const _fn: GetActiveRuntimeContext = () => ({
        settingsService: {
          get: () => undefined,
          getProviderSettings: () => ({}),
          on: () => {},
          off: () => {},
        },
        runtimeId: 'test',
      });
      expect(_fn).toBeDefined();
    });

    it('OAuthToken type is available', () => {
      const _token: OAuthToken = {
        access_token: 'test',
        expiry: 0,
        token_type: 'Bearer',
      };
      expect(_token).toBeDefined();
    });

    it('AuthPrecedenceConfig type is available', () => {
      const _config: AuthPrecedenceConfig = {
        providerId: 'test',
        apiKey: 'test',
      };
      expect(_config).toBeDefined();
    });

    it('OAuthManager type is available', () => {
      const _manager: OAuthManager = {
        getToken: async () => null,
        isAuthenticated: async () => false,
      };
      expect(_manager).toBeDefined();
    });
  });

  describe('factory export boundaries', () => {
    it('createKeyringTokenStore is NOT exported from auth', async () => {
      const mod = await import('../index.js');
      expect(Object.keys(mod)).not.toContain('createKeyringTokenStore');
    });

    it('createAuthPrecedenceResolver is NOT exported from auth', async () => {
      const mod = await import('../index.js');
      expect(Object.keys(mod)).not.toContain('createAuthPrecedenceResolver');
    });
  });
});
