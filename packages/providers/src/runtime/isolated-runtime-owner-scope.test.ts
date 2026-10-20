import { ProviderReadFixture } from '../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Config } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

import {
  captureAgentAdoption as fromConfig,
  fixtureAgentResources,
  AgentResourceCapture,
} from '../../../agents/src/api/__tests__/helpers/agent-resource-capture.js';
import type { Agent } from '../../../agents/src/api/agent.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  cleanupAfterFailure,
  runCleanupSteps,
} from '../../../agents/src/core/subagent-cleanup.js';
import {
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '../providerFilePolicy.js';

describe('isolated runtime owner activation', () => {
  const credentials = useOwnedCredentials();
  const retiring: Array<() => void | Promise<void>> = [];
  let firstConfig: Config;
  let secondConfig: Config;
  let firstSettings: SettingsService;
  let secondSettings: SettingsService;
  let firstOwner: SessionSettingsOwner;
  let secondOwner: SessionSettingsOwner;
  let first: Agent;
  let second: Agent;

  afterEach(async () => {
    await runCleanupSteps(retiring.splice(0).reverse());
  });

  async function openConfigs(): Promise<void> {
    const raw = await mkdtemp(join(tmpdir(), 'owner-activation-'));
    retiring.push(() => rm(raw, { recursive: true, force: true }));
    const directory = await realpath(raw);
    firstConfig = new Config({
      sessionId: 'shared-owner-label',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test-model',
    });
    const configA = firstConfig;
    retiring.push(() => configA.dispose());
    secondConfig = new Config({
      sessionId: 'shared-owner-label',
      targetDir: directory,
      cwd: directory,
      debugMode: false,
      model: 'test-model',
    });
    const configB = secondConfig;
    retiring.push(() => configB.dispose());
    firstSettings = new SettingsService();
    secondSettings = new SettingsService();
    firstOwner = new SessionSettingsOwner(firstSettings);
    const ownerA = firstOwner;
    retiring.push(() => ownerA.dispose());
    ownerA.bindTelemetry(configA);
    secondOwner = new SessionSettingsOwner(secondSettings);
    const ownerB = secondOwner;
    retiring.push(() => ownerB.dispose());
    ownerB.bindTelemetry(configB);
  }

  async function openFirst(runtimeId: string | undefined): Promise<void> {
    first = await fromConfig(
      firstConfig,
      firstSettings,
      { sessionId: runtimeId },
      firstOwner,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      credentials().authority,
    );
    const agent = first;
    retiring.push(() => agent.dispose());
  }
  async function openSecond(runtimeId: string | undefined): Promise<void> {
    second = await fromConfig(
      secondConfig,
      secondSettings,
      { sessionId: runtimeId },
      secondOwner,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      credentials().authority,
    );
    const agent = second;
    retiring.push(() => agent.dispose());
  }

  it('requires the explicit SDK owner even when an isolated owner is active', async () => {
    await openConfigs();
    await openFirst('sdk-owner');
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('providerManager' in firstConfig).toBe(false);
  });

  it('keeps two concurrent owners with the same label independent', async () => {
    await openConfigs();
    await Promise.all([openFirst('shared-label'), openSecond('shared-label')]);
    expect('providerManager' in firstConfig).toBe(false);
    expect(fixtureAgentResources(first).manager).not.toBe(
      fixtureAgentResources(second).manager,
    );
    await first.dispose();
    expect('providerManager' in secondConfig).toBe(false);
  });

  it('assigns independent UUID identities to equal-label Config owners without caller IDs', async () => {
    await openConfigs();
    await Promise.all([openFirst(undefined), openSecond(undefined)]);
    expect(firstConfig.getSessionId()).toBe(secondConfig.getSessionId());
    expect(first.getRuntimeId()).toMatch(
      /^agent-[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i,
    );
    expect(second.getRuntimeId()).not.toBe(first.getRuntimeId());
    expect('providerManager' in firstConfig).toBe(false);
    await first.dispose();
    expect('providerManager' in secondConfig).toBe(false);
  });

  it('an aborted same-label activation leaves the other owner usable', async () => {
    await openConfigs();
    await openFirst('same-label-abort');
    firstOwner.writeUserParameter('auth-key', 'sibling-credential');
    await expect(
      fromConfig(
        secondConfig,
        secondSettings,
        { sessionId: 'same-label-abort' },
        secondOwner,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        credentials().authority,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => {
          const error = new Error('activation aborted');
          error.name = 'AbortError';
          throw error;
        },
      ),
    ).rejects.toThrow('activation aborted');
    expect(firstOwner.readNamedParameter('auth-key')).toBe(
      'sibling-credential',
    );
    expect('providerManager' in firstConfig).toBe(false);
  });

  it('passes the exact owner Config and runtime ID to activation callbacks', async () => {
    await openConfigs();
    const observed: string[] = [];
    const files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    let admittedConfig: Config | undefined;
    const acquisition = new AgentResourceCapture();
    first = await fromConfig(
      firstConfig,
      firstSettings,
      { sessionId: 'callback-owner' },
      firstOwner,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      files,
      undefined,
      undefined,
      acquisition.factories(undefined),
      undefined,
      credentials().authority,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {
        const config = acquisition.config;
        expect(config).toBe(firstConfig);
        admittedConfig = config;
        observed.push('callback-owner');
      },
    );
    const agent = first;
    retiring.push(() => agent.dispose());
    const path = join(firstConfig.getTargetDir(), 'remote-owner-file');
    await writeFile(path, 'retained owner data');
    try {
      const retained = await first.retainProviderFile({
        cacheKey: 'callback-file',
        fileId: path,
        bytes: 19,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'caller',
        },
        policy: resolveProviderFilePolicy({
          configuredMode: 'session',
          configuredRetentionMs: 60000,
          configuredDeletion: 'delete',
          providerFileReferences: true,
          zeroDataRetention: 'incompatible-while-retained',
          zeroDataRetentionRequired: false,
        }),
        deleteRemote: async (file) => {
          await rm(file);
          expect(admittedConfig).toBe(firstConfig);
          observed.push(first.getRuntimeId());
        },
      });
      await retained.lease.release();
      await first.dispose();
    } catch (primary) {
      await cleanupAfterFailure(primary, () => first.dispose());
    }
    expect(observed).toStrictEqual(['callback-owner', 'callback-owner']);
  });
});
