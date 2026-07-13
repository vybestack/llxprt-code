/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ideClient = vi.hoisted(() => ({
  addTrustChangeListener: vi.fn(),
  removeTrustChangeListener: vi.fn(),
  getConnectionStatus: vi.fn(),
  initialize: vi.fn(),
  shutdown: vi.fn(),
}));
const getIdeClient = vi.hoisted(() => vi.fn());
const mcpManager = vi.hoisted(() => ({
  startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
  onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
  onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
  quarantineForTrustRevocation: vi.fn(),
  whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getMcpInstructions: vi.fn().mockReturnValue(''),
}));

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >();
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
    getIdeClient.mockResolvedValue(ideClient);
    mcpManager.startConfiguredMcpServers.mockResolvedValue(undefined);
    mcpManager.onFolderTrustGained.mockResolvedValue(undefined);
    mcpManager.onFolderTrustRevoked.mockResolvedValue(undefined);
    mcpManager.stop.mockResolvedValue(undefined);
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
    await vi.waitFor(() => expect(getIdeClient).toHaveBeenCalledOnce());
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
    const listener = ideClient.addTrustChangeListener.mock.lastCall?.[0] as (
      trusted: boolean | undefined,
    ) => void;

    listener(false);
    await config.whenTrustTransitionSettled();

    expect(config.isTrustedFolder()).toBe(false);
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('deduplicates IDE notifications that do not change effective trust', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = ideClient.addTrustChangeListener.mock.lastCall?.[0] as (
      trusted: boolean | undefined,
    ) => void;

    listener(true);
    listener(true);
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
      const listener = ideClient.addTrustChangeListener.mock.lastCall?.[0] as (
        trusted: boolean | undefined,
      ) => void;

      ideContext.setIdeContext({ workspaceState: { isTrusted: ideTrust } });
      listener(ideTrust);
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
      const listener = ideClient.addTrustChangeListener.mock.lastCall?.[0] as (
        trusted: boolean | undefined,
      ) => void;

      config.setTrustedFolderLive(localTrust);
      expect(config.isTrustedFolder()).toBe(!localTrust);

      ideContext.clearIdeContext();
      listener(undefined);
      await config.whenTrustTransitionSettled();

      expect(config.isTrustedFolder()).toBe(localTrust);
    },
  );

  it('removes the IDE listener during disposal', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);
    const listener = ideClient.addTrustChangeListener.mock.lastCall?.[0];

    await config.dispose();

    expect(ideClient.removeTrustChangeListener).toHaveBeenCalledWith(listener);
    expect(mcpManager.stop).toHaveBeenCalledOnce();
  });
});
