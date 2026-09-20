/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:ISSUE-3222
 * @requirement:REQ-3222-AC1
 *
 * Behavioral suite for issue #3222: createAgent must be the self-contained,
 * agent-owned runtime assembly path. This test process never imports any CLI
 * module and never registers anything globally, so every shipped-tool and
 * cleanup behavior asserted here must be provided by createAgent itself.
 *
 * RED basis (main @ 5bedbd238): createAgent supplies agentClientFactory and
 * toolSchedulerFactory itself but NOT taskToolRegistration — TaskTool
 * availability silently depends on the CLI having registered factories into
 * the providers package-global seam first. In this process that seam is empty,
 * so the shipped task tool is absent from the agent's tool surface and a
 * failed activation leaks the isolated runtime handle.
 */

import { describe, it, expect, vi } from 'bun:test';
import * as fc from 'fast-check';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  disposeCliRuntime,
  getCliRuntimeServices,
  runWithRuntimeScope,
} from '@vybestack/llxprt-code-providers/runtime.js';
import {
  buildAgent,
  ASYNC_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

/** Forces a deterministic fatal activation failure AFTER the isolated runtime exists. */
const failingActivation = {
  provider: 'definitely-not-a-registered-provider',
  providerSwitchPolicy: 'strict',
} as const;

describe('createAgent self-contained assembly @plan:ISSUE-3222 @requirement:REQ-3222-AC1', () => {
  it('T1 registers the shipped task tool observable through the public tool surface without any CLI composition root @requirement:REQ-3222-AC1 @scenario:no-cli-import @given:createAgent driven in a process that never imported a CLI module or registered factories globally @when:the agent is constructed @then:agent.tools.list() contains an entry named "task" whose handle resolves through agent.tools.get("task")', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      const names = agent.tools.list().map((tool) => tool.name);
      expect(names).toContain('task');
      expect(agent.tools.get('task')).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it(
    'T1-PROP for any sessionId the shipped task tool is present and enabled @requirement:REQ-3222-AC1 @scenario:no-cli-import @given:an arbitrary non-blank sessionId @when:createAgent runs @then:the tool surface lists "task" as enabled',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            sessionId,
          });
          try {
            const taskEntry = agent.tools
              .list()
              .find((tool) => tool.name === 'task');
            expect(taskEntry).toBeDefined();
            expect(taskEntry?.enabled).toBe(true);
          } finally {
            await cleanup();
          }
        }),
        { numRuns: 3 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it('T5 a post-assembly activation failure cleans up the isolated runtime handle and surfaces the original error @requirement:REQ-3222-AC5 @scenario:activation-failure @given:createAgent with a strict activation intent naming a provider that is not registered (fails AFTER the isolated runtime exists) @when:createAgent rejects @then:the error names the activation failure and the runtime registry no longer resolves services for that runtimeId', async () => {
    const runtimeId = 'issue3222-createagent-failure-cleanup';
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        }),
      ).rejects.toThrow(/createAgent activation failed/);

      // The registry refuses the torn-down runtimeId: getCliRuntimeServices()
      // resolves identity first and resolveActiveRuntimeIdentity() throws the
      // deterministic stale-scope message for it (plain substring, no regex).
      let registryError: unknown;
      try {
        runWithRuntimeScope({ runtimeId, metadata: {} }, () =>
          getCliRuntimeServices(),
        );
      } catch (error) {
        registryError = error;
      }
      expect(registryError).toBeInstanceOf(Error);
      if (!(registryError instanceof Error)) {
        throw new Error(`expected Error, got: ${String(registryError)}`);
      }
      expect(registryError.message).toContain(
        `Active runtime scope '${runtimeId}' is not registered`,
      );
    } finally {
      await disposeCliRuntime(runtimeId);
    }
  });

  // The cleanupFailedRuntimeBootstrap contract: when a cleanup step ALSO
  // fails, the rejection is an AggregateError of [primaryError,
  // ...cleanupErrors] — neither the activation error nor the cleanup error
  // is swallowed — and the remaining cleanup steps still run (they are
  // siblings, not a short-circuited chain). Fault injection uses the same
  // Config.prototype seam as the LSP test below: the FIRST dispose call
  // (the failure-path teardown of the agent-owned Config) rejects once.
  it('T5-surface a failing cleanup step surfaces an AggregateError preserving both errors while later cleanup steps still run @requirement:REQ-3222-AC5 @scenario:cleanup-also-fails @given:a createAgent activation failure whose agent-owned Config.dispose is fault-injected to reject once @when:createAgent rejects @then:the rejection is an AggregateError with the source message whose errors carry the original activation error and the injected cleanup error by identity, and the LSP shutdown cleanup step STILL ran after the dispose failure', async () => {
    const runtimeId = 'issue3222-createagent-failure-surface';
    const injectedCleanupError = new Error(
      'issue3222 injected Config.dispose cleanup failure',
    );
    const disposeSpy = vi
      .spyOn(Config.prototype, 'dispose')
      .mockRejectedValueOnce(injectedCleanupError);
    const lspShutdownSpy = vi.spyOn(Config.prototype, 'shutdownLspService');
    try {
      let rejection: unknown;
      try {
        await buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        });
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError)) {
        throw new Error(`expected AggregateError, got: ${String(rejection)}`);
      }
      expect(rejection.errors).toHaveLength(2);
      expect(rejection.message).toBe(
        'createAgent bootstrap failed and isolated runtime cleanup also failed',
      );
      // The ORIGINAL activation error is preserved, not substituted by the
      // cleanup error. It is constructed inside createAgent (not by this
      // test), so membership is proven by plain substring presence; together
      // with the identity-pinned injectedCleanupError and the length-2 shape
      // this still pins the exact two-error membership.
      expect(
        rejection.errors.some(
          (error: unknown): error is Error =>
            error instanceof Error &&
            error.message.includes('createAgent activation failed') &&
            error.message.includes('definitely-not-a-registered-provider'),
        ),
      ).toBe(true);
      // The injected cleanup error is preserved BY IDENTITY.
      expect(rejection.errors).toContain(injectedCleanupError);
      // The cleanup step AFTER the injected failure still ran.
      expect(lspShutdownSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
      lspShutdownSpy.mockRestore();
      await disposeCliRuntime(runtimeId);
    }
  });

  // The agent-owned Config disposal that this scenario exercises is asserted
  // in core's in-package suite (runtime/__tests__/AgentRuntimeState.configDispose.test.ts):
  // Config.dispose() releases the runtime-state subscription held by the
  // constructed AgentClient. Observable here through the public surface: the
  // original bootstrap error still surfaces after config.initialize() ran
  // (the client, MCP discovery and extensions were started and had to be
  // torn down before the rejection propagated), and the agent-owned Config
  // is disposed EXACTLY once by the failure cleanup (the isolated handle's
  // own cleanup does not dispose the Config, so a count of 1 pins
  // cleanupFailedRuntimeBootstrap as the disposer).
  it('T6 a post-initialize activation failure disposes the agent-owned Config exactly once and still surfaces the original error @requirement:REQ-3222-AC5 @scenario:activation-failure-post-initialize @given:createAgent with a strict activation intent that fails AFTER config.initialize() ran, observed through a call-through dispose spy on Config @when:createAgent rejects @then:the rejection names the activation failure and its underlying provider-not-found cause, the agent-owned Config was disposed exactly once, and a successful control build disposes nothing during construction', async () => {
    const runtimeId = 'issue3222-createagent-failure-config-dispose';
    const disposeSpy = vi.spyOn(Config.prototype, 'dispose');
    try {
      let rejection: unknown;
      try {
        await buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
        });
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeInstanceOf(Error);
      if (!(rejection instanceof Error)) {
        throw new Error(`expected Error, got: ${String(rejection)}`);
      }
      // The original activation error surfaces directly (not wrapped or
      // substituted): the createAgent prefix and the underlying
      // provider-not-found name are both in the SAME message (plain
      // substring checks, no regex).
      expect(rejection.message).toContain('createAgent activation failed');
      expect(rejection.message).toContain(
        'definitely-not-a-registered-provider',
      );

      expect(disposeSpy).toHaveBeenCalledTimes(1);

      // Success-path control: a build that SUCCEEDS must not dispose its
      // Config during construction (disposal belongs to the caller's
      // agent.dispose()), so the count stays at the single failure-path
      // call — dispose-on-build is failure-cleanup behavior, not a
      // construction artifact.
      const control = await buildAgent('plain-text.jsonl', {
        sessionId: 'issue3222-createagent-success-control',
      });
      try {
        expect(disposeSpy).toHaveBeenCalledTimes(1);
      } finally {
        await control.cleanup();
      }
    } finally {
      disposeSpy.mockRestore();
      await disposeCliRuntime(runtimeId);
    }
  });

  // Review finding on #3222: Config.dispose() does NOT shut down the LSP
  // service (agentImpl.dispose wires that separately for agent-owned Configs),
  // so a bootstrap that failed AFTER config.initialize() started LSP but
  // BEFORE the facade exists had no owner left to release it — the caller
  // gets a rejection with no Agent to dispose and the LSP service leaks.
  it('T7 a post-initialize activation failure releases the LSP service the agent-owned Config started: the shutdown ran and the service client is gone @requirement:REQ-3222-AC5 @scenario:activation-failure-lsp-leak @given:createAgent with LSP enabled and a strict activation intent that fails AFTER config.initialize() started LSP @when:createAgent rejects @then:shutdownLspService ran exactly once on the owned Config before the rejection resolves (no facade exists to do it), the service client initialize() constructed was DEFINED before that shutdown, and the owned Config public LSP state shows the client actually cleared afterwards', async () => {
    const runtimeId = 'issue3222-createagent-failure-lsp-shutdown';
    // The Config is constructed inside createAgent, so its state is observed
    // at the prototype seam (the same seam subagent-test-helpers uses to
    // spy on Config behavior). The spy CALLS THROUGH so the real shutdown
    // still releases the started service; recording the public
    // getLspServiceClient() state on the receiver around that call makes the
    // teardown independently observable, beyond the method call count.
    let clientBeforeShutdown: ReturnType<Config['getLspServiceClient']>;
    let clientAfterShutdown: ReturnType<Config['getLspServiceClient']>;
    const realShutdownLspService = Config.prototype.shutdownLspService;
    const lspShutdownSpy = vi
      .spyOn(Config.prototype, 'shutdownLspService')
      .mockImplementation(async function (this: Config) {
        clientBeforeShutdown = this.getLspServiceClient();
        await realShutdownLspService.call(this);
        clientAfterShutdown = this.getLspServiceClient();
      });
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: runtimeId,
          activation: failingActivation,
          lsp: true,
        }),
      ).rejects.toThrow(/createAgent activation failed/);

      expect(lspShutdownSpy).toHaveBeenCalledTimes(1);
      // Non-vacuous state change: initialize() CONSTRUCTED a service client
      // (LspServiceClient.start() reports failure through disable() rather
      // than throwing, so under lsp:true the client is always set before
      // the shutdown runs).
      expect(clientBeforeShutdown).toBeDefined();
      // shutdownLsp is the only path that clears _lspState.lspServiceClient
      // (Config.dispose() does not touch LSP state), so an undefined client
      // here proves the service was actually released by the call-through
      // shutdown — not merely that the method was invoked.
      expect(clientAfterShutdown).toBeUndefined();
    } finally {
      lspShutdownSpy.mockRestore();
      await disposeCliRuntime(runtimeId);
    }
  });
});
