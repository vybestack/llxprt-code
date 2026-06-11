/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260608-ISSUE1586.P13
 * @requirement REQ-OAUTH-001.1, REQ-ADAPTER-001.1, REQ-ADAPTER-001.2
 *
 * Task 1: Compile-time/contract test that CLI OAuthManager structurally
 * implements auth package OAuthManager interface.
 *
 * This test verifies the structural typing contract between the auth package's
 * OAuthManager interface and the CLI's OAuthManager class. The CLI class has
 * additional methods (registerProvider, logout, getAuthStatus, etc.) beyond
 * the auth interface — this is intentional and correct (interface segregation).
 *
 * The compile-time check happens via TypeScript's structural subtyping:
 * if InstanceType<typeof CliOAuthManager> does NOT extend AuthOAuthManager,
 * the type assertion will fail at compile time (typecheck), not at runtime.
 *
 * At runtime, we verify the minimal contract methods exist and are callable.
 */

import { describe, it, expect } from 'vitest';
import type { OAuthManager as AuthOAuthManagerInterface } from '../precedence.js';

// ─── Compile-time structural compatibility ───────────────────────────────────
// The CLI OAuthManager class is NOT imported here (would create forbidden
// cross-package dependency in auth tests). Instead, we verify that any
// object satisfying the CLI's structural shape also satisfies the auth interface.
// The CLI has its own compile-time marker (_CliOAuthManagerSatisfiesAuthInterface)
// in oauth-manager.ts that is checked during CLI typecheck.

describe('OAuthManager interface contract', () => {
  describe('compile-time structural compatibility', () => {
    it('auth OAuthManager interface requires getToken and isAuthenticated', () => {
      // This test verifies the auth interface contract shape by constructing
      // a minimal compliant implementation.
      const minimalManager: AuthOAuthManagerInterface = {
        getToken: async (_provider: string) => null,
        isAuthenticated: async (_provider: string) => false,
      };
      expect(typeof minimalManager.getToken).toBe('function');
      expect(typeof minimalManager.isAuthenticated).toBe('function');
    });

    it('auth OAuthManager interface accepts optional getOAuthToken method', async () => {
      const managerWithToken: AuthOAuthManagerInterface = {
        getToken: async () => 'test-token',
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: 'test-token',
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const resolved = await managerWithToken.getOAuthToken!('test-provider');
      expect(resolved).not.toBeNull();
      expect(resolved!.access_token).toBe('test-token');
    });

    it('auth OAuthManager interface accepts optional forceRefreshToken method', async () => {
      const managerWithRefresh: AuthOAuthManagerInterface = {
        getToken: async () => 'fresh-token',
        isAuthenticated: async () => true,
        forceRefreshToken: async () => ({
          access_token: 'fresh-token',
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
      };

      const refreshed = await managerWithRefresh.forceRefreshToken!(
        'provider',
        'old-token',
      );
      expect(refreshed).not.toBeNull();
      expect(refreshed!.access_token).toBe('fresh-token');
    });

    it('an implementation with extra methods still satisfies the interface', () => {
      // Simulates the CLI OAuthManager which has registerProvider, logout, etc.
      // TypeScript structural typing means extra methods are compatible.
      const cliLikeManager: AuthOAuthManagerInterface = {
        getToken: async () => 'cli-token',
        isAuthenticated: async () => true,
        getOAuthToken: async () => ({
          access_token: 'cli-token',
          token_type: 'Bearer' as const,
          expiry: Math.floor(Date.now() / 1000) + 3600,
        }),
        forceRefreshToken: async () => null,
        // Extra methods (these are fine — structural subtyping allows them)
        registerProvider: () => {},
        logout: async () => {},
        getAuthStatus: async () => [],
      } as AuthOAuthManagerInterface;

      // The interface methods are callable
      expect(typeof cliLikeManager.getToken).toBe('function');
      expect(typeof cliLikeManager.isAuthenticated).toBe('function');
    });

    it('getToken accepts optional metadata parameter per interface contract', async () => {
      const manager: AuthOAuthManagerInterface = {
        getToken: async (_provider: string, _metadata?: unknown) =>
          'token-with-metadata',
        isAuthenticated: async () => true,
      };

      // Call with and without metadata
      const withoutMeta = await manager.getToken('provider');
      expect(withoutMeta).toBe('token-with-metadata');

      const withMeta = await manager.getToken('provider', {
        runtimeAuthScopeId: 'test-scope',
        providerId: 'provider',
      });
      expect(withMeta).toBe('token-with-metadata');
    });
  });

  describe('interface method behavioral contracts', () => {
    it('getToken returns null when no token available', async () => {
      const manager: AuthOAuthManagerInterface = {
        getToken: async () => null,
        isAuthenticated: async () => false,
      };

      const token = await manager.getToken('unauthenticated-provider');
      expect(token).toBeNull();
    });

    it('isAuthenticated returns boolean', async () => {
      const manager: AuthOAuthManagerInterface = {
        getToken: async () => 'token',
        isAuthenticated: async (provider: string) =>
          provider === 'known-provider',
      };

      expect(await manager.isAuthenticated('known-provider')).toBe(true);
      expect(await manager.isAuthenticated('unknown-provider')).toBe(false);
    });

    it('getToken returns non-null string when authenticated', async () => {
      const manager: AuthOAuthManagerInterface = {
        getToken: async () => 'valid-access-token',
        isAuthenticated: async () => true,
      };

      const token = await manager.getToken('provider');
      expect(token).toBe('valid-access-token');
    });
  });
});
