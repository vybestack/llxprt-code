import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

import { describe, it, expect, vi } from 'bun:test';
import * as fc from 'fast-check';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createRuntimeActivationBindings,
  type RuntimeActivationBindings,
} from '@vybestack/llxprt-code-providers/runtime/runtimeActivationBindings.js';
import {
  buildAgent,
  internalConfig,
  ASYNC_PROPERTY_TIMEOUT_MS,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';

const failingActivation = {
  provider: 'definitely-not-a-registered-provider',
  providerSwitchPolicy: 'strict',
} satisfies NonNullable<Parameters<typeof buildAgent>[1]>['activation'];

function captureOwners(): {
  bindings: RuntimeActivationBindings;
  activated: Config[];
  released: Config[];
  oauth: Array<
    Parameters<
      NonNullable<RuntimeActivationBindings['registerInfrastructure']>
    >[1]
  >;
} {
  const real = createRuntimeActivationBindings();
  const activated: Config[] = [];
  const released: Config[] = [];
  const oauth: Array<
    Parameters<
      NonNullable<RuntimeActivationBindings['registerInfrastructure']>
    >[1]
  > = [];
  return {
    activated,
    released,
    oauth,
    bindings: {
      ...real,
      registerInfrastructure: async (manager, oauthManager, options) => {
        await real.registerInfrastructure(manager, oauthManager, options);
        oauth.push(oauthManager);
        if (!options.config) throw new Error('Expected explicit owner');
        activated.push(options.config);
      },
      disposeRuntime: async (runtimeId, config) => {
        if (!config) throw new Error('Expected cleanup owner');
        await real.disposeRuntime?.(runtimeId, config);
        released.push(config);
      },
    },
  };
}

describe('createAgent self-contained assembly', () => {
  it('registers the shipped task tool without importing CLI composition', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl');
    try {
      expect(agent.tools.list().map((tool) => tool.name)).toContain('task');
      expect(agent.tools.get('task')).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it(
    'enables the shipped task tool for arbitrary session labels',
    async () => {
      await fc.assert(
        fc.asyncProperty(nonBlankStringArbitrary, async (sessionId) => {
          const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
            sessionId,
          });
          try {
            const task = agent.tools
              .list()
              .find((tool) => tool.name === 'task');
            expect(task).toBeDefined();
            expect(task?.enabled).toBe(true);
          } finally {
            await cleanup();
          }
        }),
        { numRuns: 3 },
      );
    },
    ASYNC_PROPERTY_TIMEOUT_MS,
  );

  it('releases the failed explicit owner while a same-label sibling remains usable', async () => {
    const sessionId = 'issue3222-failure-same-label';
    const siblingOwners = captureOwners();
    const sibling = await buildAgent('plain-text.jsonl', {
      sessionId,
      runtimeActivationBindings: siblingOwners.bindings,
    });
    const siblingConfig = internalConfig(sibling.agent);
    const owners = captureOwners();
    try {
      expect(siblingOwners.oauth).toHaveLength(1);
      expect(siblingOwners.oauth[0]).not.toBeNull();
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId,
          activation: failingActivation,
          runtimeActivationBindings: owners.bindings,
        }),
      ).rejects.toThrow('createAgent activation failed');
      expect(owners.activated).toHaveLength(1);
      expect(owners.released).toStrictEqual(owners.activated);
      const [failed] = owners.activated;
      expect(failed).not.toBe(siblingConfig);
      expect(owners.oauth[0]).not.toBe(siblingOwners.oauth[0]);
      expect(
        await siblingOwners.oauth[0].getTokenStore().listProviders(),
      ).toStrictEqual([]);
      expect(await sibling.agent.generate('Respond locally')).toBe(
        'a plain text reply',
      );
    } finally {
      await sibling.cleanup();
    }
  });

  it('preserves activation and disposal errors while still shutting down the owned LSP client', async () => {
    const injected = new Error('issue3222 Config.dispose cleanup failure');
    const realDispose = Config.prototype.dispose;
    const owners = captureOwners();
    const disposer = vi
      .spyOn(Config.prototype, 'dispose')
      .mockImplementationOnce(async function (this: Config): Promise<void> {
        await realDispose.call(this);
        throw injected;
      });
    const lspRoot = new WorkspaceLspOwner(
      { servers: [] },
      process.cwd(),
      () => true,
    );
    try {
      let rejection: unknown;
      try {
        await buildAgent('plain-text.jsonl', {
          sessionId: 'issue3222-cleanup-errors',
          activation: failingActivation,
          runtimeActivationBindings: owners.bindings,
          lsp: true,
          lspOwner: lspRoot,
          lspOwnership: 'agent',
        });
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError))
        throw new Error('Expected aggregate');
      expect(rejection.message).toBe('createAgent bootstrap cleanup failed');
      expect(rejection.errors).toHaveLength(2);
      expect(rejection.errors).toContain(injected);
      expect(
        rejection.errors.some(
          (error: unknown) =>
            error instanceof Error &&
            error.message.includes('createAgent activation failed') &&
            error.message.includes(failingActivation.provider),
        ),
      ).toBe(true);
      expect(owners.released).toStrictEqual(owners.activated);
      await expect(lspRoot.inspection.read()).rejects.toThrow('stopped');
    } finally {
      disposer.mockRestore();
    }
  });

  it('disposes the failed Config exactly once without disposing a successful Config during construction', async () => {
    const owners = captureOwners();
    const disposed: Config[] = [];
    const realDispose = Config.prototype.dispose;
    const disposer = vi
      .spyOn(Config.prototype, 'dispose')
      .mockImplementation(async function (this: Config): Promise<void> {
        await realDispose.call(this);
        disposed.push(this);
      });
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: 'issue3222-disposed-owner',
          activation: failingActivation,
          runtimeActivationBindings: owners.bindings,
        }),
      ).rejects.toThrow(failingActivation.provider);
      expect(disposed).toStrictEqual(owners.activated);
      expect(disposed).toHaveLength(1);
      const control = await buildAgent('plain-text.jsonl');
      const controlConfig = internalConfig(control.agent);
      try {
        expect(disposed).not.toContain(controlConfig);
        expect(disposed).toHaveLength(1);
        expect(await control.agent.generate('Retain control owner')).toBe(
          'a plain text reply',
        );
      } finally {
        await control.cleanup();
      }
      expect(disposed).toStrictEqual([...owners.activated, controlConfig]);
    } finally {
      disposer.mockRestore();
    }
  });

  it('clears the initialized LSP client before rejecting a failed activation', async () => {
    const owners = captureOwners();
    const lspRoot = new WorkspaceLspOwner(
      { servers: [] },
      process.cwd(),
      () => true,
    );
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          sessionId: 'issue3222-lsp-owner',
          activation: failingActivation,
          runtimeActivationBindings: owners.bindings,
          lsp: true,
          lspOwner: lspRoot,
          lspOwnership: 'agent',
        }),
      ).rejects.toThrow('createAgent activation failed');
      await expect(lspRoot.inspection.read()).rejects.toThrow('stopped');
    } finally {
      await lspRoot.dispose();
    }
  });
});

describe('created policy failure lifetime', () => {
  it('closes the exact decision bus when runtime activation fails before MCP assembly', async () => {
    let bus: MessageBus | undefined;
    const real = createRuntimeActivationBindings();
    await expect(
      buildAgent('plain-text.jsonl', {
        runtimeActivationBindings: {
          ...real,
          registerInfrastructure: (_manager, _oauth, options) => {
            bus = options.messageBus;
            throw new Error('infrastructure activation rejected');
          },
        },
      }),
    ).rejects.toThrow('infrastructure activation rejected');
    if (!bus) throw new Error('Missing activation decision bus');
    const captured = bus;
    expect(() => captured.evaluate('write_file', {})).toThrow(/disposed/);
    const control = await buildAgent('plain-text.jsonl');
    try {
      expect(
        control.agent.getMessageBus().evaluate('read_file', {}),
      ).toBeDefined();
    } finally {
      await control.cleanup();
    }
  });
});
