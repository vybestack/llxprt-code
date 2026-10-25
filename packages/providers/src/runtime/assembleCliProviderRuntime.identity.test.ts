import { ProviderReadFixture } from '../../../agents/src/api/__tests__/helpers/provider-read-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, afterEach, describe, it, expect } from 'bun:test';
import {
  Config,
  WorkspaceTrustLifecycle,
  WorkspaceFilesystemOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  installBorrowedConfigSettings,
  installOwnedConfig,
} from '../__tests__/helpers/session-settings-owner-fixture.js';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAgentPreflight } from '../../../agents/src/api/profile-preflight.js';
import { createAgent } from '../../../agents/src/api/createAgent.js';
import { fromConfig } from '../../../agents/src/api/fromConfig.js';

import type { Agent } from '../../../agents/src/api/agent.js';

import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
const acquireSettings = installBorrowedConfigSettings();
const acquireConfig = installOwnedConfig();
function createConfig(sessionId: string): Config {
  return acquireConfig({
    targetDir: process.cwd(),
    cwd: process.cwd(),
    sessionId,
    debugMode: false,
    provider: 'openai',
    model: `${sessionId}-model`,
    mcpEnabled: false,
    telemetry: { enabled: false },
  });
}

describe('foreground explicit provider identity and preflight ownership', () => {
  const credentials = useOwnedCredentials();
  let config: Config;
  let settings: SettingsService;
  const agents: Agent[] = [];
  beforeEach(() => {
    config = createConfig('caller-config');
    settings = new SettingsService();
    settings.set('activeProvider', 'openai');
  });
  afterEach(async () => {
    const results = await Promise.allSettled(
      agents.splice(0).map((agent) => agent.dispose()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Agent cleanup failed');
  });
  async function adopt(): Promise<Agent> {
    const agent = await fromConfig(
      config,
      settings,
      {
        activation: {
          provider: 'openai',
          model: config.getModel(),
          authMode: 'none',
        },
      },
      credentials().authority,
    );
    agents.push(agent);
    return agent;
  }
  it('keeps the supplied Config with its caller on its actual Agent owner', async () => {
    const agent = await adopt();
    expect(agent.workspace.getWorkingDirectory()).toBe(config.getTargetDir());
    expect(config.getSessionId()).toBe('caller-config');
  });
  it('binds the exact bus, supplied provider manager, OAuth and file scope without Config service locators', async () => {
    const agent = await adopt();
    expect('providerManager' in config).toBe(false);
    expect(agent.listProviders().map((provider) => provider.name)).toContain(
      'openai',
    );
    expect(() => Reflect.construct(ProviderReadFixture, [])).toThrow(
      'Provider reads require an explicit session owner',
    );
    expect('providerManager' in config).toBe(false);
    const retained = await agent.retainProviderFile({
      cacheKey: 'caller-file',
      fileId: 'caller-file',
      bytes: 8,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'caller',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: async () => undefined,
    });
    await retained.lease.release();
    expect(agent.captureProviderFiles().retainedFiles).toBe(1);
  });
  it('keeps equal-label roots independent across interleaved activation and one cleanup', async () => {
    const first = await createAgent({
      sessionId: 'same-cli-label',
      provider: 'openai',
      model: 'foreground-a-model',
      credentialAuthority: credentials().authority,
      workingDir: process.cwd(),
    });
    const second = await createAgent({
      sessionId: 'same-cli-label',
      provider: 'kimi',
      model: 'foreground-b-model',
      credentialAuthority: credentials().authority,
      workingDir: process.cwd(),
    });
    agents.push(first, second);
    expect(first.session.getSessionId()).toBe('same-cli-label');
    expect(second.session.getSessionId()).toBe('same-cli-label');
    expect(first.getProvider()).toBe('openai');
    expect(second.getProvider()).toBe('kimi');
    const retained = await first.retainProviderFile({
      cacheKey: 'first',
      fileId: 'first',
      bytes: 1,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'first',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: async () => undefined,
    });
    await retained.lease.release();
    expect([
      first.captureProviderFiles().retainedFiles,
      second.captureProviderFiles().retainedFiles,
    ]).toStrictEqual([1, 0]);
    await first.dispose();
    expect(second.getProvider()).toBe('kimi');
    expect(second.getModel()).toBe('foreground-b-model');
  });
  it('rejects another Config from attaching to a previously prepared owner without replacing it', async () => {
    const operation = await prepareAgentPreflight(
      { runtimeId: 'one-owner' },
      credentials().authority,
      settings,
    );
    const owner = acquireSettings(config, settings);
    const sibling = createConfig('sibling');
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    try {
      await operation.preparePostConfiguration(
        config,
        filesystem,
        memory,
        trust,
        undefined,
        owner,
      );
      await expect(
        operation.preparePostConfiguration(
          sibling,
          filesystem,
          memory,
          trust,
          undefined,
          owner,
        ),
      ).rejects.toThrow('already prepared');
      expect(operation.captureInput().runtimeId).toBe('one-owner');
      expect('providerManager' in sibling).toBe(false);
    } finally {
      await operation.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
    }
  });
  it('closes failed Config attachment and accepts a new independent preflight without crossing file ownership', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'preflight-attachment-recovery-'),
    );
    const settings = new SettingsService();
    const early = await prepareAgentPreflight(
      { runtimeId: 'retry-label' },
      credentials().authority,
      settings,
    );
    const configSettings = settings;
    const config = createConfig('retry-config');
    const settingsOwner = acquireSettings(config, configSettings);
    const siblingStore = settings;
    const sibling = createConfig('retry-sibling');
    const siblingSettings = acquireSettings(sibling, siblingStore);
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const file = join(directory, 'retained-file');
    await writeFile(file, 'retained contents');
    const retained = await early.retainProviderFile({
      cacheKey: file,
      fileId: 'retained-file',
      bytes: 17,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'retained-key',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60_000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: () => rm(file),
    });
    await retained.lease.release();
    const prepare = (owner: typeof early, selectedConfig: typeof config) =>
      owner.preparePostConfiguration(
        selectedConfig,
        filesystem,
        memory,
        trust,
        undefined,
        settingsOwner,
      );
    settings.set('activeProvider', 'provider-does-not-exist');
    try {
      expect(early.captureProviderFiles()).toMatchObject({
        retainedFiles: 1,
        retainedBytes: 17,
        activeLeases: 0,
      });
      await expect(prepare(early, config)).rejects.toThrow(
        'provider-does-not-exist',
      );
      expect(() => early.captureInput()).toThrow('disposed');
      expect(() => early.readProviderDefaultModel('openai')).toThrow(
        'disposed',
      );
      expect('providerManager' in config).toBe(false);
      expect(early.captureProviderFiles()).toMatchObject({
        retainedFiles: 0,
        retainedBytes: 0,
        activeLeases: 0,
      });
      expect(await readdir(directory)).not.toContain('retained-file');
      await expect(prepare(early, sibling)).rejects.toThrow('disposed');
      expect('providerManager' in sibling).toBe(false);
      settings.set('activeProvider', 'openai');
      const recovered = await prepareAgentPreflight(
        { runtimeId: 'retry-label' },
        credentials().authority,
        settings,
      );
      const nextFilesystem = new WorkspaceFilesystemOwner({
        targetDir: directory,
        isTrusted: () => true,
      });
      const nextMemory = assembleWorkspaceMemory(config, nextFilesystem, trust);
      try {
        await recovered.preparePostConfiguration(
          config,
          nextFilesystem,
          nextMemory,
          trust,
          undefined,
          settingsOwner,
        );
        expect(recovered.captureInput().runtimeId).toBe('retry-label');
        expect('runtime' in recovered).toBe(false);
        expect(recovered.captureProviderFiles().retainedFiles).toBe(0);
        expect(
          (
            await recovered.preflight({
              provider: 'openai',
              authMode: 'none',
            })
          ).activeProvider,
        ).toBe('openai');
        expect(early.captureProviderFiles().retainedFiles).toBe(0);
        await expect(
          recovered.preparePostConfiguration(
            sibling,
            nextFilesystem,
            nextMemory,
            trust,
            undefined,
            settingsOwner,
          ),
        ).rejects.toThrow('already prepared');
      } finally {
        await recovered.dispose();
        await nextMemory.dispose();
        await nextFilesystem.dispose();
      }
    } finally {
      await early.dispose();
      await memory.dispose();
      await filesystem.dispose();
      await trust.dispose();
      await settingsOwner.dispose();
      await siblingSettings.dispose();
      await config.dispose();
      await sibling.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not replace an independent isolated Agent with the same label', async () => {
    const isolatedConfig = createConfig('shared-label');
    const isolatedSettings = new SettingsService();
    isolatedSettings.set('activeProvider', 'openai');
    const isolated = await fromConfig(
      isolatedConfig,
      isolatedSettings,
      {
        activation: {
          provider: 'openai',
          model: 'isolated-model',
          authMode: 'none',
        },
      },
      credentials().authority,
    );
    agents.push(isolated);
    const foreground = await adopt();
    expect('providerManager' in config).toBe(false);
    await foreground.dispose();
    expect('providerManager' in isolatedConfig).toBe(false);
    expect(isolated.getModel()).toBe('isolated-model');
    expect(isolated.getProvider()).toBe('openai');
  });
});
