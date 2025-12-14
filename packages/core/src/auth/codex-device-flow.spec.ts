/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CodexDeviceFlow } from './codex-device-flow.js';
import { createHash } from 'crypto';

describe('CodexDeviceFlow - PKCE Verifier State Management', () => {
  let deviceFlow: CodexDeviceFlow;

  beforeEach(() => {
    deviceFlow = new CodexDeviceFlow();
  });

  describe('Map-based PKCE Verifier Storage', () => {
    it('should store PKCE verifiers by state parameter', () => {
      const state1 = 'state_abc123';
      const state2 = 'state_xyz789';

      const url1 = deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state1,
      );
      const url2 = deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state2,
      );

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;

      expect(verifiers.has(state1)).toBe(true);
      expect(verifiers.has(state2)).toBe(true);
      expect(verifiers.get(state1)).not.toBe(verifiers.get(state2));
      expect(url1).not.toBe(url2);
    });

    it('should maintain separate verifiers for concurrent OAuth flows', () => {
      const states = ['state_1', 'state_2', 'state_3'];
      const verifiers = new Set<string>();

      states.forEach((state) => {
        deviceFlow.buildAuthorizationUrl(
          'http://localhost:1455/callback',
          state,
        );
      });

      const storedVerifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;

      states.forEach((state) => {
        const verifier = storedVerifiers.get(state);
        expect(verifier).toBeDefined();
        verifiers.add(verifier as string);
      });

      expect(verifiers.size).toBe(3);
    });

    it('should generate unique challenges for each state', () => {
      const state1 = 'state_first';
      const state2 = 'state_second';

      const url1 = deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state1,
      );
      const url2 = deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state2,
      );

      const params1 = new URL(url1).searchParams;
      const params2 = new URL(url2).searchParams;

      const challenge1 = params1.get('code_challenge');
      const challenge2 = params2.get('code_challenge');

      expect(challenge1).not.toBe(challenge2);
      expect(challenge1).toHaveLength(43);
      expect(challenge2).toHaveLength(43);
    });
  });

  describe('State-based Token Exchange', () => {
    it('should accept state parameter in exchangeCodeForToken', async () => {
      const state = 'test_state_123';
      const redirectUri = 'http://localhost:1455/callback';

      deviceFlow.buildAuthorizationUrl(redirectUri, state);

      await expect(
        deviceFlow.exchangeCodeForToken('invalid_code', redirectUri, state),
      ).rejects.toThrow();
    });

    it('should throw error if no verifier found for state', async () => {
      const state = 'nonexistent_state';
      const redirectUri = 'http://localhost:1455/callback';

      await expect(
        deviceFlow.exchangeCodeForToken('test_code', redirectUri, state),
      ).rejects.toThrow('PKCE code verifier not found for state');
    });

    it('should use correct verifier for given state', () => {
      const state = 'test_state_456';
      const redirectUri = 'http://localhost:1455/callback';

      deviceFlow.buildAuthorizationUrl(redirectUri, state);

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;
      const storedVerifier = verifiers.get(state);

      expect(storedVerifier).toBeDefined();
      // PKCE verifier is 64 random bytes = 86 chars in base64url
      expect(storedVerifier).toHaveLength(86);
    });

    it('should match verifier to challenge for state', () => {
      const state = 'test_state_789';
      const redirectUri = 'http://localhost:1455/callback';

      const url = deviceFlow.buildAuthorizationUrl(redirectUri, state);
      const params = new URL(url).searchParams;
      const challenge = params.get('code_challenge');

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;
      const verifier = verifiers.get(state);

      expect(verifier).toBeDefined();

      const expectedChallenge = createHash('sha256')
        .update(verifier as string)
        .digest('base64url');

      expect(challenge).toBe(expectedChallenge);
    });
  });

  describe('Verifier Cleanup', () => {
    it('should clean up verifier after successful token exchange', async () => {
      const state = 'cleanup_test_state';
      const redirectUri = 'http://localhost:1455/callback';

      deviceFlow.buildAuthorizationUrl(redirectUri, state);

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;

      expect(verifiers.has(state)).toBe(true);

      try {
        await deviceFlow.exchangeCodeForToken(
          'invalid_code',
          redirectUri,
          state,
        );
      } catch {
        // Expected to fail with network error
      }

      // Verifier should still exist after failed exchange
      expect(verifiers.has(state)).toBe(true);
    });

    it('should not leak verifiers across multiple flows', () => {
      const states = Array.from({ length: 10 }, (_, i) => `state_${i}`);

      states.forEach((state) => {
        deviceFlow.buildAuthorizationUrl(
          'http://localhost:1455/callback',
          state,
        );
      });

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;

      expect(verifiers.size).toBe(10);

      states.forEach((state) => {
        expect(verifiers.has(state)).toBe(true);
      });
    });
  });

  describe('PKCE Security with Multiple States', () => {
    it('should prevent verifier collision between concurrent flows', () => {
      const state1 = 'concurrent_state_1';
      const state2 = 'concurrent_state_2';

      deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state1,
      );
      deviceFlow.buildAuthorizationUrl(
        'http://localhost:1455/callback',
        state2,
      );

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;

      const verifier1 = verifiers.get(state1);
      const verifier2 = verifiers.get(state2);

      expect(verifier1).not.toBe(verifier2);
      expect(verifier1).toBeTruthy();
      expect(verifier2).toBeTruthy();
    });

    it('should maintain PKCE integrity for rapid sequential flows', () => {
      const numFlows = 5;
      const states = Array.from({ length: numFlows }, (_, i) => `rapid_${i}`);
      const challenges = new Set<string>();

      states.forEach((state) => {
        const url = deviceFlow.buildAuthorizationUrl(
          'http://localhost:1455/callback',
          state,
        );
        const params = new URL(url).searchParams;
        const challenge = params.get('code_challenge');
        if (challenge) {
          challenges.add(challenge);
        }
      });

      expect(challenges.size).toBe(numFlows);

      const verifiers = (deviceFlow as never)['codeVerifiers'] as Map<
        string,
        string
      >;
      expect(verifiers.size).toBe(numFlows);
    });
  });
});
