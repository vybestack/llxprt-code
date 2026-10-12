/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { WorkspaceTrustLifecycle } from '../services/workspace-trust-lifecycle.js';
import { PolicyDecision } from '../policy/types.js';
const fixtureTrust: WorkspaceTrustLifecycle[] = [];

import { HookSystem } from '../hooks/hookSystem.js';
import { createOwnedHookRoot } from '../hooks/__tests__/hook-runtime-fixture.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { PolicyEngine } from '@vybestack/llxprt-code-policy';
import {
  RuntimePolicyOwner,
  WorkspacePolicyOwner,
} from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import {
  advanceTimersByTimeAsync,
  waitFor,
} from '@vybestack/llxprt-code-test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';

import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { assembleAgentActivationBootstrap } from '@vybestack/llxprt-code-agents';

function createFailingSession(config: Config, failure: Error) {
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries(config.getInitialSettings()))
    settingsService.set(key, value);
  const manager = new ProviderManager({
    config,
    settingsService,
  });
  const operation = assembleAgentActivationBootstrap(
    config,
    settingsService,
    manager,
    null,
    () => undefined,
  );
  vi.spyOn(
    operation.sessionClient.getAgentClient(),
    'dispose',
  ).mockImplementation(async () => {
    throw failure;
  });
  return {
    disposeSession: () =>
      Promise.resolve(operation.dispose()).then(
        () => {
          throw new Error('Expected session cleanup failure');
        },
        (error: unknown) => {
          if (!(error instanceof AggregateError)) throw error;
          const cause: unknown = error.errors[0];
          if (!(cause instanceof AggregateError)) throw cause;
          if (error.errors.length !== 1) throw error;
          return cause.errors;
        },
      ),
    operation,
    cleanup: () => manager.dispose(),
  };
}

interface InstanceMock {
  onFolderTrustGained: ReturnType<typeof vi.fn>;
  onFolderTrustRevoked: ReturnType<typeof vi.fn>;
  quarantineForTrustRevocation: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const instances: InstanceMock[] = [];
const hookInitializers: Array<ReturnType<typeof vi.fn>> = [];

function createInstanceMock(): InstanceMock {
  return {
    onFolderTrustGained: vi.fn().mockResolvedValue(undefined),
    onFolderTrustRevoked: vi.fn().mockResolvedValue(undefined),
    quarantineForTrustRevocation: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

import type { ConfigParameters } from './config.js';
import { ApprovalMode, Config } from './config.js';
import { initializeTestMcpRuntime as initializeMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';

async function initializeTestConfig(
  config: Config,
  trust: WorkspaceTrustLifecycle,
): Promise<void> {
  await initializeMcpRuntime(
    config,
    McpClientManager,
    undefined,
    undefined,
    new RuntimePolicyOwner(config, trust),
  );
}

async function initializeTestMcpRuntime(
  config: Config,
  trust: WorkspaceTrustLifecycle,
  ...args: Parameters<typeof initializeMcpRuntime> extends [
    unknown,
    ...infer Rest,
  ]
    ? Rest
    : never
) {
  return initializeMcpRuntime(
    config,
    args[0] ?? McpClientManager,
    args[1],
    args[2],
    args[3] ?? new RuntimePolicyOwner(config, trust),
  );
}

const hookRoots: HookSystem[] = [];
const hookSettingsOwners: SessionSettingsOwner[] = [];
function createHookRoot(
  config: Config,
  trust: WorkspaceTrustLifecycle,
): HookSystem {
  const { root, settingsOwner } = createOwnedHookRoot(config, trust);
  hookSettingsOwners.push(settingsOwner);
  hookRoots.push(root);
  hookInitializers.push(vi.spyOn(root.getRegistry(), 'initialize'));
  return root;
}

const FAILED_TRANSITION_COUNT = 101;

const baseParams: ConfigParameters = {
  sessionId: 'test',
  targetDir: '.',
  debugMode: false,
  model: 'test-model',
  cwd: '.',
};

function asAggregateError(error: unknown): AggregateError {
  if (!(error instanceof AggregateError)) {
    throw new Error(`Expected AggregateError, got ${typeof error}`);
  }
  return error;
}

describe('Config MCP wiring on folder trust change', () => {
  beforeEach(() => {
    instances.length = 0;
    hookInitializers.length = 0;
    vi.spyOn(
      McpClientManager.prototype,
      'startConfiguredMcpServers',
    ).mockImplementation(async function (this: McpClientManager) {
      const mock = createInstanceMock();
      instances.push(mock);
      vi.spyOn(this, 'onFolderTrustGained').mockImplementation(
        mock.onFolderTrustGained,
      );
      vi.spyOn(this, 'onFolderTrustRevoked').mockImplementation(
        mock.onFolderTrustRevoked,
      );
      vi.spyOn(this, 'quarantineForTrustRevocation').mockImplementation(
        mock.quarantineForTrustRevocation,
      );
      vi.spyOn(this, 'stop').mockImplementation(mock.stop);
    });
  });

  afterEach(async () => {
    await Promise.allSettled(hookRoots.splice(0).map((root) => root.dispose()));
    for (const owner of hookSettingsOwners.splice(0)) await owner.dispose();
    vi.restoreAllMocks();
  });

  it('calls onFolderTrustGained on MCP when trust is gained live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: false });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    await initializeTestConfig(config, configTrust);

    void configTrust.setTrustedFolderLive(true);
    await configTrust.whenSettled();

    expect(instances[0].onFolderTrustGained).toHaveBeenCalledTimes(1);
  });

  it('calls onFolderTrustRevoked on MCP when trust is revoked live', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    await initializeTestConfig(config, configTrust);

    void configTrust.setTrustedFolderLive(false);
    await configTrust.whenSettled();

    expect(instances[0].onFolderTrustRevoked).toHaveBeenCalledTimes(1);
  });

  it('contains synchronous revocation failures while completing fail-safe steps', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    const engine = new PolicyEngine(config.getPolicyEngineConfig());
    const workspace = new WorkspacePolicyOwner(config, configTrust, engine);
    const configPolicy = new RuntimePolicyOwner(config, configTrust, workspace);
    const runtime = await initializeTestMcpRuntime(
      config,
      configTrust,
      undefined,
      undefined,
      undefined,
      configPolicy,
    );
    config.setApprovalMode(ApprovalMode.YOLO);
    const policyFailure = new Error('policy cleanup failed');
    vi.spyOn(engine, 'removeRulesBySource').mockImplementationOnce(() => {
      throw policyFailure;
    });

    // Use `void` to discard the returned promise so Bun's .not.toThrow()
    // checks only the synchronous call, not the async resolution.
    expect(() => {
      void configTrust.setTrustedFolderLive(false);
    }).not.toThrow();

    expect(
      runtime.policyOwner.session.decisions.evaluate('write_file', {}),
    ).toBe(PolicyDecision.ASK_USER);
    expect(instances[0].quarantineForTrustRevocation).toHaveBeenCalledOnce();
    const settlement = configTrust.whenSettled();
    settlement.catch(() => {});
    await expect(settlement).rejects.toBe(policyFailure);
    await runtime.dispose();
    workspace.dispose();
  });

  it('captures quarantine failures without crashing the trust-change source', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    await initializeTestConfig(config, configTrust);
    const quarantineFailure = new Error('quarantine failed');
    instances[0].quarantineForTrustRevocation.mockImplementationOnce(() => {
      throw quarantineFailure;
    });

    // Use `void` to discard the returned promise so Bun's .not.toThrow()
    // checks only the synchronous call, not the async resolution.
    expect(() => {
      void configTrust.setTrustedFolderLive(false);
    }).not.toThrow();

    const settlement2 = configTrust.whenSettled();
    settlement2.catch(() => {});
    await expect(settlement2).rejects.toBe(quarantineFailure);
  });

  it('does not call MCP methods on a no-op transition', async () => {
    const config = new Config({ ...baseParams, trustedFolder: true });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    await initializeTestConfig(config, configTrust);

    void configTrust.setTrustedFolderLive(true);
    await configTrust.whenSettled();

    expect(instances[0].onFolderTrustGained).not.toHaveBeenCalled();
    expect(instances[0].onFolderTrustRevoked).not.toHaveBeenCalled();
  });

  it('re-initializes the hook system when trust is gained live', async () => {
    const config = new Config({
      ...baseParams,
      trustedFolder: false,
      enableHooks: true,
    });
    const configTrust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    fixtureTrust.push(configTrust);
    await initializeTestConfig(config, configTrust);
    createHookRoot(config, configTrust);

    void configTrust.setTrustedFolderLive(true);
    await configTrust.whenSettled();

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
      const configATrust = new WorkspaceTrustLifecycle({
        localTrust: configA.initialWorkspaceTrust,
      });
      fixtureTrust.push(configATrust);
      await initializeTestConfig(configA, configATrust);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: true,
      });
      const configBTrust = new WorkspaceTrustLifecycle({
        localTrust: configB.initialWorkspaceTrust,
      });
      fixtureTrust.push(configBTrust);
      await initializeTestConfig(configB, configBTrust);

      const mockA = instances[0];
      const mockB = instances[1];

      void configATrust.setTrustedFolderLive(false);
      await configATrust.whenSettled();
      await configBTrust.whenSettled();

      expect(mockA.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
      expect(mockB.onFolderTrustRevoked).not.toHaveBeenCalled();
    });

    it('gaining trust on config A does not call onFolderTrustGained on config B', async () => {
      const configA = new Config({
        ...baseParams,
        sessionId: 'a',
        trustedFolder: false,
      });
      const configATrust = new WorkspaceTrustLifecycle({
        localTrust: configA.initialWorkspaceTrust,
      });
      fixtureTrust.push(configATrust);
      await initializeTestConfig(configA, configATrust);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: false,
      });
      const configBTrust = new WorkspaceTrustLifecycle({
        localTrust: configB.initialWorkspaceTrust,
      });
      fixtureTrust.push(configBTrust);
      await initializeTestConfig(configB, configBTrust);

      const mockA = instances[0];
      const mockB = instances[1];

      void configATrust.setTrustedFolderLive(true);
      await configATrust.whenSettled();
      await configBTrust.whenSettled();

      expect(mockA.onFolderTrustGained).toHaveBeenCalledTimes(1);
      expect(mockB.onFolderTrustGained).not.toHaveBeenCalled();
    });

    it('two configs transitioning independently do not interfere', async () => {
      const configA = new Config({
        ...baseParams,
        sessionId: 'a',
        trustedFolder: false,
      });
      const configATrust = new WorkspaceTrustLifecycle({
        localTrust: configA.initialWorkspaceTrust,
      });
      fixtureTrust.push(configATrust);
      await initializeTestConfig(configA, configATrust);

      const configB = new Config({
        ...baseParams,
        sessionId: 'b',
        trustedFolder: true,
      });
      const configBTrust = new WorkspaceTrustLifecycle({
        localTrust: configB.initialWorkspaceTrust,
      });
      fixtureTrust.push(configBTrust);
      await initializeTestConfig(configB, configBTrust);

      const mockA = instances[0];
      const mockB = instances[1];

      void configATrust.setTrustedFolderLive(true);
      void configBTrust.setTrustedFolderLive(false);
      await configATrust.whenSettled();
      await configBTrust.whenSettled();

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
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      void configTrust.setTrustedFolderLive(false);
      void configTrust.setTrustedFolderLive(true);
      await configTrust.whenSettled();

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
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      void configTrust.setTrustedFolderLive(false);
      void configTrust.setTrustedFolderLive(false);
      await configTrust.whenSettled();

      expect(mock.onFolderTrustRevoked).toHaveBeenCalledTimes(1);
    });

    it('exposes MCP failures without breaking the serialization chain', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
      });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);

      const mock = instances[0];
      mock.onFolderTrustRevoked.mockRejectedValueOnce(
        new Error('disconnect failed'),
      );

      void configTrust.setTrustedFolderLive(false);
      const rejectSettlement = configTrust.whenSettled();
      rejectSettlement.catch(() => {});
      await expect(rejectSettlement).rejects.toThrow('disconnect failed');

      void configTrust.setTrustedFolderLive(true);
      const resolveSettlement = configTrust.whenSettled();
      await expect(resolveSettlement).resolves.toBeUndefined();

      expect(mock.onFolderTrustGained).toHaveBeenCalledTimes(1);

      // Drain any remaining internal transition promises to prevent
      // unhandled rejections between tests under Bun.
      configTrust.whenSettled().catch(() => {});
    });

    it('reports the same transition failure to concurrent settlement observers', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: true,
      });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);
      const failure = new Error('disconnect failed');
      instances[0].onFolderTrustRevoked.mockRejectedValueOnce(failure);

      void configTrust.setTrustedFolderLive(false);
      const firstObserver = configTrust.whenSettled();
      const secondObserver = configTrust.whenSettled();
      // Prevent unhandled rejection: attach catch handlers immediately
      firstObserver.catch(() => {});
      secondObserver.catch(() => {});

      await expect(firstObserver).rejects.toBe(failure);
      await expect(secondObserver).rejects.toBe(failure);
    });

    it('exposes hook re-initialization failures', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: false,
        enableHooks: true,
      });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);
      createHookRoot(config, configTrust);
      hookInitializers[0].mockRejectedValueOnce(new Error('hooks failed'));

      void configTrust.setTrustedFolderLive(true);

      const hooksSettlement = configTrust.whenSettled();
      hooksSettlement.catch(() => {});
      await expect(hooksSettlement).rejects.toThrow('hooks failed');
    });

    it('bounds hook initialization during a trust transition', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: false,
        enableHooks: true,
      });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);
      createHookRoot(config, configTrust);
      hookInitializers[0].mockReturnValue(new Promise<void>(() => {}));
      vi.useFakeTimers();

      try {
        void configTrust.setTrustedFolderLive(true);
        const outcome = configTrust.whenSettled().then(
          () => 'resolved',
          (error: unknown) => error,
        );
        outcome.catch(() => {});

        await advanceTimersByTimeAsync(0);
        const initializationSignal = hookInitializers[0].mock.calls[0][0];

        await advanceTimersByTimeAsync(29_999);
        expect(initializationSignal).toBeInstanceOf(AbortSignal);
        expect(initializationSignal.aborted).toBe(false);

        await advanceTimersByTimeAsync(1);
        const result = await outcome;
        expect(result).toBeInstanceOf(Error);
        expect(result).toMatchObject({
          message: expect.stringContaining('timed out'),
        });
        expect(initializationSignal.aborted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels pending hook initialization when disposal begins', async () => {
      const config = new Config({
        ...baseParams,
        trustedFolder: false,
        enableHooks: true,
      });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);
      const hookRoot = createHookRoot(config, configTrust);
      hookInitializers[0].mockReturnValue(new Promise<void>(() => {}));

      void configTrust.setTrustedFolderLive(true);
      await waitFor(() => expect(hookInitializers[0]).toHaveBeenCalledOnce());
      const initializationSignal = hookInitializers[0].mock.calls[0][0];

      const disposed = Promise.all([hookRoot.dispose(), config.dispose()]).then(
        () => 'disposed',
      );
      const deadline = new Promise<string>((resolve) => {
        setTimeout(() => resolve('deadline'), 50);
      });

      await expect(Promise.race([disposed, deadline])).resolves.toBe(
        'disposed',
      );
      expect(initializationSignal).toBeInstanceOf(AbortSignal);
      expect(initializationSignal.aborted).toBe(true);
    });

    describe('dispose cleanup', () => {
      it('cancels MCP work before awaiting an in-flight trust transition', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const mock = instances[0];
        let releaseTransition: (() => void) | undefined;
        mock.onFolderTrustRevoked.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              releaseTransition = resolve;
            }),
        );

        const failures: unknown[] = [];
        const transition = Promise.allSettled([
          configTrust.setTrustedFolderLive(false),
        ]);
        try {
          await waitFor(() =>
            expect(mock.onFolderTrustRevoked).toHaveBeenCalledOnce(),
          );
          const retirement = Promise.allSettled([
            owner.dispose(),
            config.dispose(),
          ]);
          await waitFor(() => expect(mock.stop).toHaveBeenCalledOnce());
          releaseTransition?.();
          failures.push(
            ...(await retirement).flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            ),
          );
        } catch (error) {
          failures.push(error);
        } finally {
          releaseTransition?.();
          const retired = await Promise.allSettled([
            owner.dispose(),
            config.dispose(),
          ]);
          const completed = await transition;
          failures.push(
            ...[...retired, ...completed].flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            ),
          );
        }
        if (failures.length > 0)
          throw new AggregateError(failures, 'Trust fixture retirement failed');
      });

      it('does not initialize hooks after disposal begins during an in-flight transition', async () => {
        const config = new Config({
          ...baseParams,
          trustedFolder: true,
          enableHooks: true,
        });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const mock = instances[0];
        let releaseTransition: (() => void) | undefined;
        mock.onFolderTrustRevoked.mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              releaseTransition = resolve;
            }),
        );

        const hookRoot = createHookRoot(config, configTrust);
        const reload = hookInitializers[0];
        const failures: unknown[] = [];
        const transition = Promise.allSettled([
          configTrust.setTrustedFolderLive(false),
        ]);
        try {
          await waitFor(() => {
            expect(mock.onFolderTrustRevoked).toHaveBeenCalledOnce();
            expect(reload).toHaveBeenCalledOnce();
          });
          const retirement = Promise.allSettled([
            owner.dispose(),
            config.dispose(),
          ]);
          await hookRoot.dispose();
          releaseTransition?.();
          failures.push(
            ...(await retirement).flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            ),
          );

          expect(reload).toHaveBeenCalledOnce();
          await expect(hookRoot.initialize()).rejects.toThrow('disposed');
        } catch (error) {
          failures.push(error);
        } finally {
          releaseTransition?.();
          const retired = await Promise.allSettled([
            hookRoot.dispose(),
            owner.dispose(),
            config.dispose(),
          ]);
          const completed = await transition;
          failures.push(
            ...[...retired, ...completed].flatMap((result) =>
              result.status === 'rejected' ? [result.reason] : [],
            ),
          );
        }
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'Hook trust fixture retirement failed',
          );
      });

      it('does not enqueue transitions after disposal begins', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        await owner.dispose();
        await config.dispose();
        await configTrust.dispose();

        await expect(configTrust.setTrustedFolderLive(false)).rejects.toThrow(
          'disposed',
        );
        await configTrust.whenSettled();

        expect(instances[0].onFolderTrustRevoked).not.toHaveBeenCalled();
      });

      it('continues hook and MCP cleanup when agent disposal fails', async () => {
        const config = new Config({
          ...baseParams,
          trustedFolder: true,
          enableHooks: true,
        });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const manager = instances[0];
        const hookSystem = createHookRoot(config, configTrust);
        await hookSystem.initialize();
        const disposeHooks = vi.spyOn(hookSystem, 'dispose');
        const agentFailure = new Error('agent dispose failed');
        const session = createFailingSession(config, agentFailure);

        await owner.dispose();
        await expect(session.disposeSession()).resolves.toStrictEqual([
          agentFailure,
        ]);
        await hookSystem.dispose();
        await expect(config.dispose()).resolves.toBeUndefined();
        await expect(session.disposeSession()).resolves.toStrictEqual([
          agentFailure,
        ]);
        session.cleanup();

        expect(disposeHooks).toHaveBeenCalledOnce();
        await expect(hookSystem.initialize()).rejects.toThrow('disposed');
        expect(manager.stop).toHaveBeenCalledOnce();
      });

      it('aggregates agent, hook, and MCP cleanup failures', async () => {
        const config = new Config({
          ...baseParams,
          trustedFolder: true,
          enableHooks: true,
        });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const agentFailure = new Error('agent dispose failed');
        const hookFailure = new Error('hook dispose failed');
        const stopFailure = new Error('stop failed');
        const session = createFailingSession(config, agentFailure);
        const hookSystem = createHookRoot(config, configTrust);
        const failedRetirement = vi
          .spyOn(hookSystem, 'dispose')
          .mockRejectedValueOnce(hookFailure);
        instances[0].stop.mockRejectedValue(stopFailure);

        await expect(owner.dispose()).rejects.toMatchObject({
          message: 'Workspace runtime cleanup failed',
          errors: [stopFailure],
        });
        await expect(session.disposeSession()).resolves.toStrictEqual([
          agentFailure,
        ]);
        await expect(hookSystem.dispose()).rejects.toBe(hookFailure);
        failedRetirement.mockRestore();
        await expect(config.dispose()).resolves.toBeUndefined();
        await expect(session.disposeSession()).resolves.toStrictEqual([
          agentFailure,
        ]);
        session.cleanup();
      });

      it('reports both transition and manager stop failures', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const transitionError = new Error('transition failed');
        const stopError = new Error('stop failed');
        instances[0].onFolderTrustRevoked.mockRejectedValue(transitionError);
        instances[0].stop.mockRejectedValue(stopError);

        void configTrust.setTrustedFolderLive(false);
        await waitFor(() =>
          expect(instances[0].onFolderTrustRevoked).toHaveBeenCalledOnce(),
        );

        await expect(owner.dispose()).rejects.toMatchObject({
          message: 'Workspace runtime cleanup failed',
          errors: [stopError],
        });
        await expect(configTrust.dispose()).rejects.toBe(transitionError);
      });

      it('retains an undefined transition rejection alongside a stop failure', async () => {
        const config = new Config({ ...baseParams, trustedFolder: true });
        const configTrust = new WorkspaceTrustLifecycle({
          localTrust: config.initialWorkspaceTrust,
        });
        fixtureTrust.push(configTrust);
        const owner = await initializeTestMcpRuntime(config, configTrust);
        const stopError = new Error('stop failed');
        instances[0].onFolderTrustRevoked.mockRejectedValue(undefined);
        instances[0].stop.mockRejectedValue(stopError);

        void configTrust.setTrustedFolderLive(false);
        await waitFor(() =>
          expect(instances[0].onFolderTrustRevoked).toHaveBeenCalledOnce(),
        );

        await expect(owner.dispose()).rejects.toMatchObject({
          message: 'Workspace runtime cleanup failed',
          errors: [stopError],
        });
        await expect(configTrust.dispose()).rejects.toBeUndefined();
      });
    });

    it('retains every transition failure when callers do not drain them', async () => {
      const config = new Config({ ...baseParams, trustedFolder: true });
      const configTrust = new WorkspaceTrustLifecycle({
        localTrust: config.initialWorkspaceTrust,
      });
      fixtureTrust.push(configTrust);
      await initializeTestConfig(config, configTrust);
      const mock = instances[0];
      mock.onFolderTrustGained.mockRejectedValue(new Error('gain failed'));
      mock.onFolderTrustRevoked.mockRejectedValue(new Error('revoke failed'));

      for (let index = 0; index < FAILED_TRANSITION_COUNT; index++) {
        void configTrust.setTrustedFolderLive(index % 2 !== 0);
      }

      let failure: unknown;
      try {
        await configTrust.whenSettled();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AggregateError);
      expect(asAggregateError(failure).errors).toHaveLength(
        FAILED_TRANSITION_COUNT,
      );
    });
  });
});
