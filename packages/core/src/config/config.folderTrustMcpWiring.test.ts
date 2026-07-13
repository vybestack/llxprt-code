/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface InstanceMock {
  startConfiguredMcpServers: ReturnType<typeof vi.fn>;
  onFolderTrustGained: ReturnType<typeof vi.fn>;
  onFolderTrustRevoked: ReturnType<typeof vi.fn>;
  quarantineForTrustRevocation: ReturnType<typeof vi.fn>;
  whenDiscoverySettled: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  getMcpInstructions: ReturnType<typeof vi.fn>;
}

const instances: InstanceMock[] = [];
const hookInitializers: Array<ReturnType<typeof vi.fn>> = [];

function createInstanceMock(): InstanceMock {
  return {
    startConfiguredMcpServers: vi.fn().mockResolvedValue(undefined),
    onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
    onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
    quarantineForTrustRevocation: vi.fn(),
    whenDiscoverySettled: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getMcpInstructions: vi.fn().mockReturnValue(''),
  };
}

vi.mock('@vybestack/llxprt-code-mcp', () => ({
  McpClientManager: vi.fn().mockImplementation(() => {
    const mock = createInstanceMock();
    instances.push(mock);
    return mock;
  }),
}));

vi.mock('../hooks/hookSystem.js', () => ({
  HookSystem: vi.fn().mockImplementation(() => {
    const initialize = vi.fn().mockResolvedValue(undefined);
    hookInitializers.push(initialize);
    return {
      initialize,
      dispose: vi.fn(),
      isInitialized: () => true,
      getRegistry: () => ({ getAllHooks: () => [] }),
      getEventHandler: () => ({}),
    };
  }),
}));

import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import { initializeTestConfig } from '../test-utils/config.js';

const baseParams: ConfigParameters = {
  sessionId: 'test',
  targetDir: '.',
  debugMode: false,
  model: 'test-model',
  cwd: '.',
};

describe('Config MCP wiring on folder trust change', () => {
  beforeEach(() => {
    instances.length = 0;
    hookInitializers.length = 0;
  });

  it('calls onFolderTrustGained on MCP when trust is gained live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: false });
    await initializeTestConfig(config);

    config.setTrustedFolderLive(true);
    await config.whenTrustTransitionSettled();

    expect(instances[0].onFolderTrustGained).toHaveBeenCalledTimes(1);
  });

  it('calls onFolderTrustRevoked on MCP when trust is revoked live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);

    config.setTrustedFolderLive(false);
    await config.whenTrustTransitionSettled();

    expect(instances[0].onFolderTrustRevoked).toHaveBeenCalledTimes(1);
  });

  it('does not call MCP methods on a no-op transition', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    await initializeTestConfig(config);

    config.setTrustedFolderLive(true);
    await config.whenTrustTransitionSettled();

    expect(instances[0].onFolderTrustGained).not.toHaveBeenCalled();
    expect(instances[0].onFolderTrustRevoked).not.toHaveBeenCalled();
  });

  it('re-initializes the hook system when trust is gained live', async () => {
    const config = new Config({
      ...baseParams,
      trustedFolder: false,
      enableHooks: true,
    });
    await initializeTestConfig(config);

    config.setTrustedFolderLive(true);
    await config.whenTrustTransitionSettled();

    expect(instances[0].onFolderTrustGained).toHaveBeenCalledTimes(1);
    expect(hookInitializers[0]).toHaveBeenCalledTimes(1);
  });

  describe('multi-Config isolation (no global event cross-talk)', () => {
    it('revoking trust on config A does not call onFolderTrustRevoked on config B', async () => {
      const configA = new Config({
        ...baseParams,
        sessionId: 'a',
        trustedFolder: true,
      });
      await initializeTestConfig(configA);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: true,
      });
      await initializeTestConfig(configB);

      const mockA = instances[0];
      const mockB = instances[1];

      configA.setTrustedFolderLive(false);
      await configA.whenTrustTransitionSettled();
      await configB.whenTrustTransitionSettled();

      expect(mockA.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
      expect(mockB.onFolderTrustRevoked).not.toHaveBeenCalled();
    });

    it('gaining trust on config A does not call onFolderTrustGained on config B', async () => {
      const configA = new Config({
        ...baseParams,
        sessionId: 'a',
        trustedFolder: false,
      });
      await initializeTestConfig(configA);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: false,
      });
      await initializeTestConfig(configB);

      const mockA = instances[0];
      const mockB = instances[1];

      configA.setTrustedFolderLive(true);
      await configA.whenTrustTransitionSettled();
      await configB.whenTrustTransitionSettled();

      expect(mockA.onFolderTrustGained).toHaveBeenCalledTimes(1);
      expect(mockB.onFolderTrustGained).not.toHaveBeenCalled();
    });

    it('two configs transitioning independently do not interfere', async () => {
      const configA = new Config({
        ...baseParams,
        sessionId: 'a',
        trustedFolder: false,
      });
      await initializeTestConfig(configA);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: true,
      });
      await initializeTestConfig(configB);

      const mockA = instances[0];
      const mockB = instances[1];

      configA.setTrustedFolderLive(true);
      configB.setTrustedFolderLive(false);
      await configA.whenTrustTransitionSettled();
      await configB.whenTrustTransitionSettled();

      expect(mockA.onFolderTrustGained).toHaveBeenCalledTimes(1);
      expect(mockA.onFolderTrustRevoked).not.toHaveBeenCalled();
      expect(mockB.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
      expect(mockB.onFolderTrustGained).not.toHaveBeenCalled();
    });
  });

  describe('serialized trust transitions (no fire-and-forget races)', () => {
    it('serializes rapid revoke→gain so gain cannot overtake revoke', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
      });
      await initializeTestConfig(config);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      config.setTrustedFolderLive(false);
      config.setTrustedFolderLive(true);
      await config.whenTrustTransitionSettled();

      expect(mock.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
      expect(mock.onFolderTrustGained).toHaveBeenCalledTimes(1);
      expect(
        mock.onFolderTrustRevoked.mock.invocationCallOrder[0],
      ).toBeLessThan(mock.onFolderTrustGained.mock.invocationCallOrder[0]);
    });

    it('coalesces rapid duplicate revoke calls to a single invocation', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
      });
      await initializeTestConfig(config);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      config.setTrustedFolderLive(false);
      config.setTrustedFolderLive(false);
      await config.whenTrustTransitionSettled();

      expect(mock.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
    });

    it('exposes MCP failures without breaking the serialization chain', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
      });
      await initializeTestConfig(config);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockRejectedValueOnce(
        new Error('disconnect failed'),
      );

      config.setTrustedFolderLive(false);
      await expect(config.whenTrustTransitionSettled()).rejects.toThrow(
        'disconnect failed',
      );

      config.setTrustedFolderLive(true);
      await expect(
        config.whenTrustTransitionSettled(),
      ).resolves.toBeUndefined();

      expect(mock.onFolderTrustGained).toHaveBeenCalledTimes(1);
    });

    it('exposes hook re-initialization failures', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: false,
        enableHooks: true,
      });
      await initializeTestConfig(config);
      config.getHookSystem();
      hookInitializers[0].mockRejectedValueOnce(new Error('hooks failed'));

      config.setTrustedFolderLive(true);

      await expect(config.whenTrustTransitionSettled()).rejects.toThrow(
        'hooks failed',
      );
    });

    describe('dispose cleanup', () => {
      it('cancels MCP work before awaiting an in-flight trust transition', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        await initializeTestConfig(config);
        const mock = instances[0];
        let releaseTransition: (() => void) | undefined;
        mock.onFolderTrustRevoked.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              releaseTransition = resolve;
            }),
        );

        config.setTrustedFolderLive(false);
        await vi.waitFor(() =>
          expect(mock.onFolderTrustRevoked).toHaveBeenCalledOnce(),
        );
        const disposePromise = config.dispose();
        expect(mock.stop).toHaveBeenCalledOnce();
        releaseTransition?.();
        await disposePromise;
      });

      it('does not initialize hooks after disposal begins during an in-flight transition', async () => {
        const config = new Config({
          ...baseParams,
          trustedFolder: true,
          enableHooks: true,
        });
        await initializeTestConfig(config);
        const mock = instances[0];
        let releaseTransition: (() => void) | undefined;
        mock.onFolderTrustRevoked.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              releaseTransition = resolve;
            }),
        );

        const getHookSystemSpy = vi.spyOn(config, 'getHookSystem');
        config.setTrustedFolderLive(false);
        await vi.waitFor(() =>
          expect(mock.onFolderTrustRevoked).toHaveBeenCalledOnce(),
        );
        const disposePromise = config.dispose();
        releaseTransition?.();
        await disposePromise;

        expect(getHookSystemSpy).not.toHaveBeenCalled();
      });

      it('does not enqueue transitions after disposal begins', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        await initializeTestConfig(config);
        await config.dispose();

        config.setTrustedFolderLive(false);
        await config.whenTrustTransitionSettled();

        expect(instances[0].onFolderTrustRevoked).not.toHaveBeenCalled();
      });
    });
  });
});
