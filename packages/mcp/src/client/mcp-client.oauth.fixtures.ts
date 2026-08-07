/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fixture builders for the OAuth client suites.
 *
 * These construct plain doubles and touch no mocked module, so they are safe to
 * share across files. Wiring a double onto a mocked constructor has to stay in
 * the suite itself: Bun hoists `vi.mock` above the suite's own imports, so a
 * binding read anywhere else resolves to the real module.
 */

import { vi } from 'bun:test';
import type * as ClientLib from '@modelcontextprotocol/sdk/client/index.js';
import type { MCPOAuthProvider } from '../auth/oauth-provider.js';
import type { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';

/** A `Client` double whose every method records calls. */
export function createMockedClient(): ClientLib.Client {
  return {
    connect: vi.fn(),
    close: vi.fn(),
    registerCapabilities: vi.fn(),
    setRequestHandler: vi.fn(),
    onclose: vi.fn(),
    notification: vi.fn(),
  } as unknown as ClientLib.Client;
}

/** Token storage that always resolves a fixed client id. */
export function createMockTokenStorage(): MCPOAuthTokenStorage {
  return {
    getCredentials: vi.fn().mockResolvedValue({ clientId: 'test-client' }),
  } as unknown as MCPOAuthTokenStorage;
}

/** An auth provider that authenticates successfully and yields a fixed token. */
export function createMockAuthProvider(
  tokenStorage: MCPOAuthTokenStorage,
): MCPOAuthProvider {
  return {
    authenticate: vi.fn().mockResolvedValue(undefined),
    getValidToken: vi.fn().mockResolvedValue('test-access-token'),
    tokenStorage,
  } as unknown as MCPOAuthProvider;
}

/** Silences the console channels the connection flow writes to. */
export function silenceConsole(): void {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
}
