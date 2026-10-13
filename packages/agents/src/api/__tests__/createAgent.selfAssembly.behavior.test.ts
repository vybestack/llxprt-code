import { WorkspaceLspOwner } from '@vybestack/llxprt-code-core/lsp/workspace-lsp-owner.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

import { describe, it, expect, vi } from 'bun:test';
import * as fc from 'fast-check';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { join } from 'node:path';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import * as fs from 'node:fs/promises';
import {
  buildAgent,
  createAgent,
  internalConfig,
  ASYNC_PROPERTY_TIMEOUT_MS,
  tempRoot,
} from './helpers/agentHarness.js';
import { nonBlankStringArbitrary } from './helpers/fastCheckArbitraries.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const failingActivation = {
  provider: 'definitely-not-a-registered-provider',
  providerSwitchPolicy: 'strict',
} satisfies NonNullable<Parameters<typeof buildAgent>[1]>['activation'];

describe('createAgent self-contained assembly', () => {
  const credentials = useOwnedCredentials();

  it('registers the shipped task tool without importing CLI composition', async () => {
    const { agent, cleanup } = await buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
    });
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
            credentialAuthority: credentials().authority,
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
    const sibling = await buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
      sessionId,
    });
    const siblingConfig = internalConfig(sibling.agent);
    sibling.agent.setModelParam('temperature', 0.37);
    const disposed: Config[] = [];
    const realDispose = Config.prototype.dispose;
    const observation = vi
      .spyOn(Config.prototype, 'dispose')
      .mockImplementation(async function (this: Config): Promise<void> {
        await realDispose.call(this);
        disposed.push(this);
      });
    try {
      expect(credentials().snapshot()).toStrictEqual([0]);
      expect(await credentials().listProviders(0)).toStrictEqual([]);
      await expect(
        buildAgent('plain-text.jsonl', {
          credentialAuthority: credentials().authority,
          sessionId,
          activation: failingActivation,
        }),
      ).rejects.toThrow('createAgent activation failed');
      expect(disposed).toHaveLength(1);
      expect(disposed[0].getSessionId()).toBe(sessionId);
      expect(disposed[0]).not.toBe(siblingConfig);
      expect(credentials().snapshot()).toStrictEqual([0, 1]);
      expect(await credentials().listProviders(0)).toStrictEqual([]);
      await credentials().saveToken(0, 'codex', {
        access_token: 'surviving-owner-access',
        refresh_token: 'surviving-owner-refresh',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      });
      const auth = await sibling.agent.auth.detailedStatus('codex');
      expect(auth.authenticated).toBe(true);
      expect(auth.expiry).toBeGreaterThan(Date.now() / 1000);
      expect(sibling.agent.getProvider()).toBe('fake');
      expect(sibling.agent.getModel()).toBe('fake-model');
      expect(sibling.agent.captureProfile().modelParams).toMatchObject({
        temperature: 0.37,
      });
      expect(await sibling.agent.generate('Respond locally')).toBe(
        'a plain text reply',
      );
    } finally {
      await sibling.cleanup();
      observation.mockRestore();
    }
    expect(credentials().snapshot()).toStrictEqual([1, 1]);
  });

  it('preserves activation and disposal errors while still shutting down the owned LSP client', async () => {
    const injected = new Error('issue3222 media directory cleanup failure');
    const media = new SessionMediaOwner(tempRoot, 1024 * 1024);
    const realRm = fs.rm;
    const removal = vi
      .spyOn(fs, 'rm')
      .mockImplementation(async (path, options) => {
        if (path === media.store.rootDirectory) throw injected;
        await realRm(path, options);
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
          credentialAuthority: credentials().authority,
          sessionId: 'issue3222-cleanup-errors',
          activation: failingActivation,
          mediaOwner: media,
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
      expect(credentials().snapshot()).toStrictEqual([1]);
      await expect(media.store.getStoredByteLength()).rejects.toThrow(
        /closed/i,
      );
      await expect(lspRoot.inspection.read()).rejects.toThrow('stopped');
    } finally {
      removal.mockRestore();
      await realRm(media.store.rootDirectory, { recursive: true, force: true });
      await lspRoot.dispose();
    }
  });

  it('disposes the failed Config exactly once without disposing a successful Config during construction', async () => {
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
          credentialAuthority: credentials().authority,
          sessionId: 'issue3222-disposed-owner',
          activation: failingActivation,
        }),
      ).rejects.toThrow(failingActivation.provider);
      expect(disposed.map((config) => config.getSessionId())).toStrictEqual([
        'issue3222-disposed-owner',
      ]);
      expect(disposed).toHaveLength(1);
      const failedConfig = disposed[0];
      const control = await buildAgent('plain-text.jsonl', {
        credentialAuthority: credentials().authority,
      });
      const controlConfig = internalConfig(control.agent);
      try {
        expect(disposed).not.toContain(controlConfig);
        expect(disposed).toHaveLength(1);
        expect(credentials().snapshot()).toStrictEqual([1, 0]);
        expect(await control.agent.generate('Retain control owner')).toBe(
          'a plain text reply',
        );
      } finally {
        await control.cleanup();
      }
      expect(disposed).toStrictEqual([failedConfig, controlConfig]);
      expect(credentials().snapshot()).toStrictEqual([1, 1]);
    } finally {
      disposer.mockRestore();
    }
  });

  it('clears the initialized LSP client before rejecting a failed activation', async () => {
    const lspRoot = new WorkspaceLspOwner(
      { servers: [] },
      process.cwd(),
      () => true,
    );
    try {
      await expect(
        buildAgent('plain-text.jsonl', {
          credentialAuthority: credentials().authority,
          sessionId: 'issue3222-lsp-owner',
          activation: failingActivation,
          lsp: true,
          lspOwner: lspRoot,
          lspOwnership: 'agent',
        }),
      ).rejects.toThrow('createAgent activation failed');
      expect(credentials().snapshot()).toStrictEqual([1]);
      await expect(lspRoot.inspection.read()).rejects.toThrow('stopped');
    } finally {
      await lspRoot.dispose();
    }
  });
});

describe('created policy failure lifetime', () => {
  const credentials = useOwnedCredentials();

  it('closes the exact decision bus when runtime activation fails before MCP assembly', async () => {
    const closedBuses: MessageBus[] = [];
    const cancel = MessageBus.prototype.cancelPendingConfirmations;
    const observation = vi
      .spyOn(MessageBus.prototype, 'cancelPendingConfirmations')
      .mockImplementation(function (this: MessageBus): void {
        cancel.call(this);
        closedBuses.push(this);
      });
    const previous = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_FAKE_RESPONSES = join(
      tempRoot,
      'missing-provider-responses.jsonl',
    );
    try {
      await expect(
        createAgent({
          credentialAuthority: credentials().authority,
          provider: 'fake',
          model: 'fake-model',
          workingDir: tempRoot,
        }),
      ).rejects.toThrow('ENOENT');
      expect(closedBuses).toHaveLength(1);
      expect(credentials().snapshot()).toStrictEqual([1]);
      expect(() => closedBuses[0].evaluate('write_file', {})).toThrow(
        /disposed/,
      );
    } finally {
      observation.mockRestore();
      if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = previous;
    }
    const control = await buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
    });
    try {
      expect(control.agent.getMessageBus()).not.toBe(closedBuses[0]);
      expect(
        control.agent.getMessageBus().evaluate('read_file', {}),
      ).toBeDefined();
    } finally {
      await control.cleanup();
    }
    expect(credentials().snapshot()).toStrictEqual([1, 1]);
  });
});
