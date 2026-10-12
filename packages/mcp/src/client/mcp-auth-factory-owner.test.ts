/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { buildMcpAuthFactoryRegistry } from '../auth/mcp-auth-factory.js';
import { createTestOAuthBinding } from './test-support/oauth.js';
import { createTransport } from './mcp-transport.js';

const server = {
  url: 'http://127.0.0.1:1/mcp',
  authProviderType: 'Owner-Custom',
};

describe('MCP transport owner auth factory lookup', () => {
  it('uses distinct explicit factory owners for simultaneous same-label servers', async () => {
    const owners = ['first', 'second'].map((owner) =>
      buildMcpAuthFactoryRegistry([
        {
          authProviderType: 'owner-custom',
          createAuthProvider: (config) => {
            throw new Error(`${owner} credentials rejected for ${config.url}`);
          },
        },
      ]),
    );
    const binding = createTestOAuthBinding();
    const results = await Promise.allSettled(
      owners.map((owner) =>
        createTransport(
          binding.tokenStorage,
          'shared-server',
          server,
          false,
          undefined,
          (type) => owner.getAuthProviderFactory(type),
        ),
      ),
    );
    const errors = results.map((result) => {
      if (result.status !== 'rejected' || !(result.reason instanceof Error)) {
        throw new Error('Factory failure was not surfaced');
      }
      return result.reason.message;
    });
    expect(errors[0]).toContain('first credentials rejected');
    expect(errors[0]).not.toContain('second credentials');
    expect(errors[1]).toContain('second credentials rejected');
    expect(errors[1]).not.toContain('first credentials');
  });

  it('rejects a selected custom provider without an injected factory', async () => {
    const binding = createTestOAuthBinding();
    await expect(
      createTransport(binding.tokenStorage, 'missing-owner', server, false),
    ).rejects.toThrow(/no auth provider is registered/);
  });
});
