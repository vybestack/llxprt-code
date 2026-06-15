/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P13
 * @requirement REQ-OAUTH-001.1
 *
 * Task 4: CLI-side contract test verifying that the CLI OAuthManager class
 * structurally implements the auth package's OAuthManager interface.
 *
 * This is both a compile-time check (if the types don't align, this file
 * won't pass typecheck) and a runtime behavioral check (verifying the
 * interface methods are present and callable).
 *
 * No consumer migration (P15-P17) is performed here. This test only verifies
 * the existing structural compatibility established in P12.
 */

import { describe, it, expect } from 'vitest';
import { OAuthManager } from '../oauth-manager.js';
import type {
  OAuthManager as AuthOAuthManagerInterface,
  OAuthTokenRequestMetadata as AuthOAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-auth';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';

/**
 * Compile-time structural compatibility check: if CLI's OAuthManager no longer
 * satisfies the auth package's OAuthManager interface, the assignment below
 * will fail at compile time. The unused variable is intentional — it exists
 * solely to enforce the type constraint.
 */
// This variable enforces compile-time structural compatibility.
// If CLI's OAuthManager no longer satisfies the auth interface, typecheck fails.
const cliOAuthManagerSatisfiesAuthInterface: InstanceType<
  typeof OAuthManager
> extends AuthOAuthManagerInterface
  ? true
  : never = true;

describe('CLI OAuthManager structural compatibility with auth interface', () => {
  describe('compile-time interface satisfaction', () => {
    it('CLI OAuthManager structurally satisfies auth OAuthManager interface', () => {
      // The compile-time constant is evidence that the structural check passes.
      // If types diverge, this file won't compile.
      expect(cliOAuthManagerSatisfiesAuthInterface).toBe(true);
    });

    it('CLI OAuthManager has getToken method matching auth interface signature', () => {
      // This is a runtime proxy for the compile-time check.
      // The actual compile-time check is the function above + the imports.
      const proto = OAuthManager.prototype;
      expect(typeof proto.getToken).toBe('function');
    });

    it('CLI OAuthManager has isAuthenticated method matching auth interface', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.isAuthenticated).toBe('function');
    });

    it('CLI OAuthManager has getOAuthToken optional method', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.getOAuthToken).toBe('function');
    });

    it('CLI OAuthManager has forceRefreshToken optional method', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.forceRefreshToken).toBe('function');
    });
  });

  describe('OAuthTokenRequestMetadata compatibility', () => {
    it('CLI OAuthTokenRequestMetadata is compatible with auth package type', () => {
      // Construct a metadata object using the CLI type and verify it satisfies
      // the auth interface type. If types diverge, this won't compile.
      const cliMeta: OAuthTokenRequestMetadata = {
        runtimeAuthScopeId: 'test-scope',
        providerId: 'test-provider',
        profileId: 'test-profile',
        cliScope: {},
        runtimeMetadata: {},
      };

      // Assign to auth-typed variable — compile-time structural check
      const authMeta: AuthOAuthTokenRequestMetadata = cliMeta;

      // Runtime verification that shape is preserved
      expect(authMeta.runtimeAuthScopeId).toBe('test-scope');
      expect(authMeta.providerId).toBe('test-provider');
      expect(authMeta.profileId).toBe('test-profile');
    });

    it('auth package metadata is compatible with CLI type', () => {
      // Bidirectional check — auth metadata also satisfies CLI type
      const authMeta: AuthOAuthTokenRequestMetadata = {
        runtimeAuthScopeId: 'auth-scope',
        providerId: 'auth-provider',
      };

      const cliMeta: OAuthTokenRequestMetadata = authMeta;
      expect(cliMeta.runtimeAuthScopeId).toBe('auth-scope');
    });
  });

  describe('CLI OAuthManager extra methods do not break interface', () => {
    it('CLI OAuthManager has registerProvider beyond interface requirements', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.registerProvider).toBe('function');
      // This is an extra method — not required by auth interface, but allowed
      // by structural typing (TypeScript allows superset of interface methods)
    });

    it('CLI OAuthManager has logout beyond interface requirements', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.logout).toBe('function');
    });

    it('CLI OAuthManager has getAuthStatus beyond interface requirements', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.getAuthStatus).toBe('function');
    });

    it('CLI OAuthManager has getSupportedProviders beyond interface requirements', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.getSupportedProviders).toBe('function');
    });

    it('CLI OAuthManager has isOAuthEnabled beyond interface requirements', () => {
      const proto = OAuthManager.prototype;
      expect(typeof proto.isOAuthEnabled).toBe('function');
    });
  });
});
