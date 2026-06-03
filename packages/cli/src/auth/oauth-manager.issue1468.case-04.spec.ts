/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { OAuthProvider } from './types.js';
import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core';
import {
  mockGetCurrentProfileName,
  createIssue1468Fixture,
  mockLoadProfile,
} from './oauth-manager.issue1468.test-helpers.js';

describe('Issue #1468 getProfileBuckets case 4', () => {
  it('does not fall back to foreground buckets when an explicit request profile cannot be loaded', async () => {
    const { tokenStore, manager } = createIssue1468Fixture();

    mockGetCurrentProfileName.mockReturnValue('foreground-profile');
    mockLoadProfile.mockImplementation(async (profileName: string) => {
      if (profileName === 'foreground-profile') {
        return {
          provider: 'anthropic',
          auth: {
            type: 'oauth',
            buckets: ['foreground-bucket'],
          },
        };
      }

      throw new Error(`Unexpected profile lookup: ${profileName}`);
    });

    const provider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn().mockResolvedValue({
        access_token: 'fresh-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      getToken: vi.fn().mockResolvedValue(null),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    manager.registerProvider(provider);
    await manager.toggleOAuthEnabled('anthropic');

    manager.setSessionBucket('anthropic', 'foreground-bucket');

    await tokenStore.saveToken(
      'anthropic',
      {
        access_token: 'foreground-token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
      'foreground-bucket',
    );

    const metadata: OAuthTokenRequestMetadata = {
      profileId: 'missing-profile',
      providerId: 'anthropic',
      runtimeMetadata: {
        source: 'SubagentOrchestrator',
        subagent: 'codeanalyzer',
      },
    };

    await expect(manager.getOAuthToken('anthropic', metadata)).rejects.toThrow(
      'Unexpected profile lookup: missing-profile',
    );
  });
});
