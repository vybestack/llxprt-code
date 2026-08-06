/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { beforeEach, describe, expect, it, vi } from 'bun:test';

const ideClient = {
  addTrustChangeListener: vi.fn(),
  removeTrustChangeListener: vi.fn(),
};
const getIdeClient = vi.fn();
let trustChangeListener: ((trusted: boolean | undefined) => void) | undefined;
const mcpManager = {
  startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
  onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
  onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
  quarantineForTrustRevocation: vi.fn(),
  whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getMcpInstructions: vi.fn().mockReturnValue(''),
};

const actual = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
vi.mock('@vybestack/llxprt-code-ide-integration', () => {
  return {
    ...actual,
    IdeClient: { getInstance: getIdeClient },
  };
});

vi.mock('@vybestack/llxprt-code-mcp', () => ({
  McpClientManager: vi.fn(() => mcpManager),
}));

import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import { initializeTestConfig } from '../test-utils/config.js';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';

const baseParams: ConfigParameters = {
  sessionId: 'ide-trust-test',
  targetDir: '.',
  debugMode: false,
  model: 'test-model',
  cwd: '.',
};

describe('Config live IDE trust', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ideContext.clearIdeContext();
    trustChangeListener = undefined;
    ideClient.addTrustChangeListener.mockImplementation((listener) => {
      trustChangeListener = listener;
    });
    getIdeClient.mockResolvedValue(ideClient);
    mcpManager.startConfiguredMcpServers.mockResolvedValue(undefined);
    mcpManager.onFolderTrustGained.mockResolvedValue(undefined);
    mcpManager.onFolderTrustRevoked.mockResolvedValue(undefined);
    mcpManager.quarantineForTrustRevocation.mockReset();
    mcpManager.stop.mockResolvedValue(undefined);
  });

  it('reconciles a local trust change made while a listener-less IDE client is loading', async () => {
    let resolveIdeClient: ((client: object) => void) | undefined;
    getIdeClient.mockReturnValue(
      new Promise((resolve) => {
        resolveIdeClient = resolve;
      }),
    );
    const config = new Config({ ...baseParams, trustedFolder: true });

    const initialization = initializeTestConfig(config);
    await waitFor(() => expect(getIdeClient).toHaveBeenCalledOnce());
    await config.setTrustedFolderLive(false);
    resolveIdeClient?.({});
    await initialization;
    await config.whenTrustTransitionSettled();

    expect(config.isTrustedFolder()).toBe(false);
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('does not mark initialization complete when IDE listener registration throws', async () => {
    ideClient.addTrustChangeListener.mockImplementationOnce(() => {
      throw new Error('listener registration failed');
    });
    const config = new Config({ ...baseParams, trustedFolder: true });

    await expect(initializeTestConfig(config)).rejects.toThrow(
      'listener registration failed',
    );
    mcpManager.onFolderTrustRevoked.mockClear();

    await config.setTrustedFolderLive(false);

    expect(mcpManager.onFolderTrustRevoked).not.toHaveBeenCalled();
  });

  it('reconciles an IDE trust change that occurs while the client is loading', async () => {
    let resolveIdeClient: ((client: typeof ideClient) => void) | undefined;
    getIdeClient.mockReturnValue(
      new Promise((resolve) => {
        resolveIdeClient = resolve;
      }),
    );
    const config = new Config({ ...baseParams, trustedFolder: true });

    const initialization = initializeTestConfig(config);
    await waitFor(() => expect(getIdeClient).toHaveBeenCalledOnce());
    ideContext.setIdeContext({ workspaceState: { isTrusted: false } });
    resolveIdeClient?.(ideClient);
    await initialization;
    await config.whenTrustTransitionSettled();

    expect(config.isTrustedFolder()).toBe(false);
    expect(mcpManager.quarantineForTrustRevocation).toHaveBeenCalledOnce();
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('applies IDE trust changes live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    listener?.(false);
    await config.whenTrustTransitionSettled();

    expect(config.isTrustedFolder()).toBe(false);
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('surfaces synchronous quarantine failures through whenTrustTransitionSettled', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = trustChangeListener;
    const quarantineFailure = new Error('quarantine failed');
    mcpManager.quarantineForTrustRevocation.mockImplementationOnce(() => {
      throw quarantineFailure;
    });

    expect(() => listener?.(false)).not.toThrow();

    expect(config.isTrustedFolder()).toBe(false);
    await expect(config.whenTrustTransitionSettled()).rejects.toBe(
      quarantineFailure,
    );
  });

  it('deduplicates IDE notifications that do not change effective trust', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    listener?.(true);
    listener?.(true);
    await config.whenTrustTransitionSettled();

    expect(mcpManager.onFolderTrustGained).not.toHaveBeenCalled();
    expect(mcpManager.onFolderTrustRevoked).not.toHaveBeenCalled();
  });

  it.each([
    {
      localTrust: true,
      ideTrust: false,
      expectedTransition: 'onFolderTrustRevoked',
    },
    {
      localTrust: false,
      ideTrust: true,
      expectedTransition: 'onFolderTrustGained',
    },
  ] as const)(
    'compares cached trust when production mutates global IDE context before the first $ideTrust notification',
    async ({ localTrust, ideTrust, expectedTransition }) => {
      const config = new Config({ ...baseParams, trustedFolder: localTrust });
      await initializeTestConfig(config);
      const listener = trustChangeListener;
      expect(listener).toBeDefined();

      ideContext.setIdeContext({ workspaceState: { isTrusted: ideTrust } });
      listener?.(ideTrust);
      await config.whenTrustTransitionSettled();

      expect(config.isTrustedFolder()).toBe(ideTrust);
      expect(mcpManager[expectedTransition]).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    'keeps a local %s edit beneath the IDE override and restores it after disconnect',
    async (localTrust) => {
      ideContext.setIdeContext({ workspaceState: { isTrusted: !localTrust } });
      const config = new Config({ ...baseParams, trustedFolder: !localTrust });
      await initializeTestConfig(config);
      const listener = trustChangeListener;
      expect(listener).toBeDefined();

      await config.setTrustedFolderLive(localTrust);
      expect(config.isTrustedFolder()).toBe(!localTrust);

      ideContext.clearIdeContext();
      listener?.(undefined);
      await config.whenTrustTransitionSettled();

      expect(config.isTrustedFolder()).toBe(localTrust);
    },
  );

  it('removes the IDE listener during disposal', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    await config.dispose();

    expect(ideClient.removeTrustChangeListener).toHaveBeenCalledWith(listener);
    expect(mcpManager.stop).toHaveBeenCalledOnce();
  });
});
