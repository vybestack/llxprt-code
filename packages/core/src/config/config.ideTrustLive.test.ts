/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IdeClient } from '@vybestack/llxprt-code-ide-integration';

import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
import { WorkspaceIdeOwner } from '../services/workspace-ide-owner.js';
import { RuntimePolicyOwner } from '../policy/policy-owner.js';
const ideOwners: WorkspaceIdeOwner[] = [];
async function initializeWorkspace(
  config: Config,
  trust: WorkspaceTrustLifecycle,
) {
  const owner = new WorkspaceIdeOwner(config, trust, trust);
  ideOwners.push(owner);
  const runtime = await initializeTestMcpRuntime(
    config,
    McpClientManager,
    undefined,
    undefined,
    new RuntimePolicyOwner(config, trust),
  );
  try {
    await owner.initialize();
    return runtime;
  } catch (error) {
    ideOwners.splice(ideOwners.indexOf(owner), 1);
    const results = await Promise.allSettled([
      runtime.dispose(),
      owner.dispose(),
    ]);
    throw new AggregateError(
      [
        error,
        ...results.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        ),
      ],
      `Workspace initialization failed: ${String(error)}`,
    );
  }
}

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { resolve } from 'node:path';

let ideClient: IdeClient;
const getIdeClient = vi.fn();
let trustChangeListener: ((trusted: boolean | undefined) => void) | undefined;
const mcpManager = {
  startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
  onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
  onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
  quarantineForTrustRevocation: vi.fn(),
  whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  readInstructions: vi.fn().mockReturnValue(''),
};

const actual = { ...(await import('@vybestack/llxprt-code-ide-integration')) };
void vi.mock('@vybestack/llxprt-code-ide-integration', () => ({
  ...actual,
  IdeClient: { create: getIdeClient },
}));

void vi.mock('@vybestack/llxprt-code-mcp', () => ({
  McpClientManager: vi.fn(() => mcpManager),
}));

import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';

const testRoot = resolve(import.meta.dir, '../..');

const baseParams: ConfigParameters = {
  sessionId: 'ide-trust-test',
  targetDir: testRoot,
  debugMode: false,
  model: 'test-model',
  cwd: testRoot,
};

describe('Config live IDE trust', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    ideClient = await actual.IdeClient.create();
    vi.spyOn(ideClient, 'addTrustChangeListener');
    vi.spyOn(ideClient, 'removeTrustChangeListener');
    vi.spyOn(ideClient, 'getWorkspaceTrust').mockImplementation(
      () => ideContext.getIdeContext()?.workspaceState?.isTrusted,
    );
    ideContext.clearIdeContext();
    trustChangeListener = undefined;
    vi.spyOn(ideClient, 'addTrustChangeListener').mockImplementation(
      (listener) => {
        trustChangeListener = listener;
      },
    );
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
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });

    const initialization = initializeWorkspace(config, trust);
    await waitFor(() => expect(getIdeClient).toHaveBeenCalledOnce());
    await trust.setTrustedFolderLive(false);
    resolveIdeClient?.(ideClient);
    await initialization;
    await trust.whenSettled();

    expect(trust.isTrustedFolder()).toBe(false);
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('does not mark initialization complete when IDE listener registration throws', async () => {
    vi.spyOn(ideClient, 'addTrustChangeListener').mockImplementationOnce(() => {
      throw new Error('listener registration failed');
    });
    const config = new Config({ ...baseParams, trustedFolder: true });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });

    await expect(initializeWorkspace(config, trust)).rejects.toThrow(
      'listener registration failed',
    );
    mcpManager.onFolderTrustRevoked.mockClear();

    await trust.setTrustedFolderLive(false);

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
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });

    const initialization = initializeWorkspace(config, trust);
    await waitFor(() => expect(getIdeClient).toHaveBeenCalledOnce());
    ideContext.setIdeContext({ workspaceState: { isTrusted: false } });
    resolveIdeClient?.(ideClient);
    await initialization;
    await trust.whenSettled();

    expect(trust.isTrustedFolder()).toBe(false);
    expect(mcpManager.quarantineForTrustRevocation).toHaveBeenCalledOnce();
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('applies IDE trust changes live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    await initializeWorkspace(config, trust);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    listener?.(false);
    expect(mcpManager.quarantineForTrustRevocation).toHaveBeenCalledOnce();
    await trust.whenSettled();

    expect(trust.isTrustedFolder()).toBe(false);
    expect(mcpManager.onFolderTrustRevoked).toHaveBeenCalledOnce();
  });

  it('surfaces synchronous quarantine failures through whenTrustTransitionSettled', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    await initializeWorkspace(config, trust);
    const listener = trustChangeListener;
    const quarantineFailure = new Error('quarantine failed');
    mcpManager.quarantineForTrustRevocation.mockImplementationOnce(() => {
      throw quarantineFailure;
    });

    expect(() => listener?.(false)).not.toThrow();

    expect(trust.isTrustedFolder()).toBe(false);
    await expect(trust.whenSettled()).rejects.toBe(quarantineFailure);
    const owner = ideOwners.pop();
    expect(owner).toBeDefined();
    await expect(owner?.dispose()).rejects.toMatchObject({
      errors: [quarantineFailure],
    });
  });

  it('deduplicates IDE notifications that do not change effective trust', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    await initializeWorkspace(config, trust);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    listener?.(true);
    listener?.(true);
    await trust.whenSettled();

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
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      await initializeWorkspace(config, trust);
      const listener = trustChangeListener;
      expect(listener).toBeDefined();

      ideContext.setIdeContext({ workspaceState: { isTrusted: ideTrust } });
      listener?.(ideTrust);
      await trust.whenSettled();

      expect(trust.isTrustedFolder()).toBe(ideTrust);
      expect(mcpManager[expectedTransition]).toHaveBeenCalledOnce();
    },
  );

  it.each([true, false])(
    'keeps a local %s edit beneath the IDE override and restores it after disconnect',
    async (localTrust) => {
      ideContext.setIdeContext({ workspaceState: { isTrusted: !localTrust } });
      const config = new Config({ ...baseParams, trustedFolder: !localTrust });
      const trust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      await initializeWorkspace(config, trust);
      const listener = trustChangeListener;
      expect(listener).toBeDefined();

      await trust.setTrustedFolderLive(localTrust);
      expect(trust.isTrustedFolder()).toBe(!localTrust);

      ideContext.clearIdeContext();
      listener?.(undefined);
      await trust.whenSettled();

      expect(trust.isTrustedFolder()).toBe(localTrust);
    },
  );

  it('removes the IDE listener during disposal', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const owner = await initializeWorkspace(config, trust);
    const listener = trustChangeListener;
    expect(listener).toBeDefined();

    await owner.dispose();
    await config.dispose();
    await ideOwners.splice(0).reduce(async (prior, owner) => {
      await prior;
      await owner.dispose();
    }, Promise.resolve());

    expect(ideClient.removeTrustChangeListener).toHaveBeenCalledWith(listener);
    expect(mcpManager.stop).toHaveBeenCalledOnce();
  });
});
