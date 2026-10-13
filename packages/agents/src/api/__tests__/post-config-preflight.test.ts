/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  SessionSettingsOwner,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';
import { prepareAgentPreflight } from '../profile-preflight.js';
import type { AgentProfilePreflight } from '../profile-preflight.js';
import type { AgentActivationOperation } from '../activationPreflightState.js';

function transfer(operation: AgentProfilePreflight): AgentActivationOperation {
  let activation: AgentActivationOperation | undefined;
  operation.transferActivation((selected) => {
    activation = selected;
  });
  if (activation === undefined)
    throw new Error('Missing transferred activation');
  return activation;
}

describe('post-config preflight ownership', () => {
  const credentials = useOwnedCredentials();
  async function withPreflight(
    borrowed: boolean,
    run: (
      operation: AgentProfilePreflight,
      prepare: (onManagerReady?: () => void) => Promise<void>,
      supplied: SessionSettingsOwner | undefined,
      stages: readonly string[],
    ) => Promise<void>,
  ): Promise<void> {
    const root = await mkdtemp(join(tmpdir(), 'post-config-preflight-'));
    const settings = new SettingsService();
    const supplied = borrowed ? new SessionSettingsOwner(settings) : undefined;
    const operation = await prepareAgentPreflight(
      { runtimeId: 'post-config-preflight' },
      credentials().authority,
      settings,
    );
    const config = new Config({
      debugMode: false,
      sessionId: 'post-config',
      cwd: root,
      targetDir: root,
      model: 'test-model',
      provider: 'openai',
      mcpEnabled: false,
      skillsSupport: false,
    });
    const trust = new WorkspaceTrustLifecycle({
      localTrust: config.initialWorkspaceTrust,
    });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: root,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const stages: string[] = [];
    const prepare = (onManagerReady?: () => void): Promise<void> =>
      operation.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        () => trust.dispose(),
        supplied,
        () => stages.push('policy'),
        () => {
          stages.push('manager');
          onManagerReady?.();
        },
        () => stages.push('oauth'),
        () => stages.push('files'),
      );
    try {
      await run(operation, prepare, supplied, stages);
    } finally {
      await operation.dispose();
      await supplied?.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await config.dispose();
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const borrowed of [false, true]) {
    it(`preserves transferred activation and settings disposition (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        operation.writeUserParameter('stream-idle-timeout-ms', 1234);
        expect(operation.readNamedParameter('stream-idle-timeout-ms')).toBe(
          1234,
        );
        const result = await operation.preflight({
          provider: 'openai',
          authMode: 'none',
        });
        expect(result.switchError).toBeUndefined();
        const activation = transfer(operation);
        try {
          expect(activation.settingsOwnerOwnership).toBe(
            borrowed ? 'borrowed' : 'transferred',
          );
          expect(activation.messageBus).toBe(
            activation.oauthManager?.runtimeMessageBus,
          );
          await operation.finishPostConfiguration();
          await operation.dispose();
          const continued = await activation.preflight({
            provider: 'openai',
            authMode: 'none',
          });
          expect(continued.authFailed).toBe(false);
        } finally {
          await activation.dispose();
        }
        supplied?.writeUserParameter('context-limit', 8192);
        expect(supplied?.readNamedParameter('context-limit')).toBe(
          borrowed ? 8192 : undefined,
        );
        expect(() => operation.captureSettings()).toThrow('disposed');
      });
    });

    it(`closes untransferred activation without closing borrowed settings (borrowed ${borrowed})`, async () => {
      await withPreflight(borrowed, async (operation, prepare, supplied) => {
        await prepare();
        await operation.finishPostConfiguration();
        const result = await operation.preflight({ authMode: 'none' });
        expect(result.authFailed).toBe(true);
        expect(result.authError).toMatchObject({
          message: 'Activation bootstrap is disposed',
        });
        supplied?.writeUserParameter('context-limit', 4096);
        expect(supplied?.readNamedParameter('context-limit')).toBe(
          borrowed ? 4096 : undefined,
        );
      });
    });
  }

  it('publishes infrastructure in startup order and rejects duplicate preparation', async () => {
    await withPreflight(
      false,
      async (operation, prepare, _supplied, stages) => {
        expect(() => operation.captureSwitchOperation()).toThrow(
          'not prepared',
        );
        await prepare();
        expect(stages).toStrictEqual(['policy', 'manager', 'oauth', 'files']);
        expect(typeof operation.captureSwitchOperation()).toBe('function');
        expect(operation.captureProfileOperation()).toBeDefined();
        await expect(prepare()).rejects.toThrow('already prepared');
        const result = await operation.preflight({ authMode: 'none' });
        expect(result.authFailed).toBe(false);
      },
    );
  });

  it('returns activation failure and retains cleanup ownership', async () => {
    await withPreflight(true, async (operation, prepare, supplied) => {
      await prepare();
      const result = await operation.preflight({
        provider: 'missing-post-config-provider',
        authMode: 'auto',
        providerSwitchPolicy: 'strict',
      });
      expect(result.authFailed).toBe(true);
      await operation.finishPostConfiguration();
      supplied?.writeUserParameter('context-limit', 2048);
      expect(supplied?.readNamedParameter('context-limit')).toBe(2048);
    });
  });

  it('closes failed preparation while preserving borrowed settings', async () => {
    await withPreflight(true, async (operation, prepare, supplied, stages) => {
      const failure = new Error('Host manager publication failed');
      await expect(
        prepare(() => {
          throw failure;
        }),
      ).rejects.toThrow(failure);
      expect(stages).toStrictEqual(['policy', 'manager']);
      expect(() => operation.captureSettings()).toThrow('disposed');
      supplied?.writeUserParameter('context-limit', 1024);
      expect(supplied?.readNamedParameter('context-limit')).toBe(1024);
    });
  });
});
