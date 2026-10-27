/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  WorkspaceFilesystemOwner,
  WorkspaceTrustLifecycle,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  prepareAgentPreflight,
  type AgentProfilePreflight,
} from '../profile-preflight.js';
import type { Agent } from '../agent.js';
import { createAgent } from '../createAgent.js';
import { fromConfig } from '../fromConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('explicit provider and preflight lifecycle owners', () => {
  const credentials = useOwnedCredentials();
  let directory: string;
  let config: Config;
  let settings: SettingsService;
  let files: ProviderFileLifecycle;
  const cleanup: Array<() => void | Promise<void>> = [];
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'provider-lifecycle-'));
    config = new Config({
      cwd: directory,
      targetDir: directory,
      sessionId: 'supplied-config',
      provider: 'openai',
      model: 'owner-model',
      debugMode: false,
      mcpEnabled: false,
      telemetry: { enabled: false },
    });
    settings = new SettingsService();
    files = new ProviderFileLifecycle({
      maxFiles: 100,
      maxBytes: 512 * 1024 * 1024,
    });
    cleanup.push(
      () => rm(directory, { recursive: true, force: true }),
      () => config.dispose(),
    );
    settings.set('activeProvider', 'openai');
  });
  afterEach(async () => {
    const failures: unknown[] = [];
    for (const close of cleanup.splice(0).reverse()) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Lifecycle fixture cleanup failed');
  });
  async function prepare(
    operation: AgentProfilePreflight,
    selected: Config,
  ): Promise<void> {
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    const memory = assembleWorkspaceMemory(selected, filesystem, trust);
    cleanup.push(
      () => trust.dispose(),
      () => filesystem.dispose(),
      () => memory.dispose(),
    );
    await operation.preparePostConfiguration(
      selected,
      filesystem,
      memory,
      trust,
      undefined,
    );
  }
  async function retained(
    operation: AgentProfilePreflight,
    name: string,
  ): Promise<void> {
    const file = join(directory, name);
    await writeFile(file, 'retained');
    const reference = await operation.retainProviderFile({
      cacheKey: file,
      fileId: name,
      bytes: 8,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'owner',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
      deleteRemote: () => rm(file),
    });
    await reference.lease.release();
  }

  async function openSameLabelRoot(): Promise<{
    agent: Agent;
    rootConfig: Config;
  }> {
    const rootConfig = new Config({
      cwd: directory,
      targetDir: directory,
      sessionId: 'same-label',
      provider: 'openai',
      model: 'owner-model',
      debugMode: false,
      mcpEnabled: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => rootConfig.dispose());
    const rootSettings = new SettingsService();
    for (const [key, value] of Object.entries(rootConfig.getInitialSettings()))
      rootSettings.set(key, value);
    const agent = await fromConfig(
      rootConfig,
      rootSettings,
      { activation: { provider: 'openai', model: 'owner-model' } },
      credentials().authority,
    );
    cleanup.push(() => agent.dispose());
    return { agent, rootConfig };
  }

  it('keeps same-label acquired roots and their file ownership separate without Config service locators', async () => {
    const { agent: first, rootConfig: firstConfig } = await openSameLabelRoot();
    const { agent: second, rootConfig: secondConfig } =
      await openSameLabelRoot();
    expect('providerManager' in firstConfig).toBe(false);
    expect('providerManager' in secondConfig).toBe(false);
    const firstFile = join(directory, 'first-retained');
    const secondFile = join(directory, 'second-retained');
    await writeFile(firstFile, 'first remote bytes');
    await writeFile(secondFile, 'second remote bytes');
    const retainedInput = {
      cacheKey: 'same-file',
      fileId: 'same-file',
      bytes: 19,
      identity: {
        provider: 'openai',
        baseURL: 'http://127.0.0.1',
        credentialHash: 'same-owner-label',
      },
      policy: {
        mode: 'enabled',
        scope: 'session',
        retentionMs: 60000,
        deletion: 'delete',
        zeroDataRetention: 'incompatible-while-retained',
      },
    } satisfies Omit<
      Parameters<typeof first.retainProviderFile>[0],
      'deleteRemote'
    >;
    const firstReference = await first.retainProviderFile({
      ...retainedInput,
      deleteRemote: () => rm(firstFile),
    });
    await firstReference.lease.release();
    expect(second.captureProviderFiles().retainedFiles).toBe(0);
    const secondReference = await second.retainProviderFile({
      ...retainedInput,
      deleteRemote: () => rm(secondFile),
    });
    await secondReference.lease.release();
    expect([
      first.captureProviderFiles().retainedFiles,
      second.captureProviderFiles().retainedFiles,
    ]).toStrictEqual([1, 1]);
    await first.dispose();
    await expect(readFile(firstFile, 'utf8')).rejects.toThrow('ENOENT');
    expect(await readFile(secondFile, 'utf8')).toBe('second remote bytes');
    expect(second.captureProviderFiles().retainedFiles).toBe(1);
    expect(first.captureProviderFiles().retainedFiles).toBe(0);
    await second.dispose();
    await expect(readFile(secondFile, 'utf8')).rejects.toThrow('ENOENT');
  });
  it('releasing a preflight removes its authority and rejects subsequent attachment while joining repeated close', async () => {
    const operation = await prepareAgentPreflight(
      { runtimeId: 'released-owner' },
      credentials().authority,
      settings,
    );
    await operation.dispose();
    expect(() => operation.captureInput()).toThrow('disposed');
    expect(() => operation.readProviderDefaultModel('openai')).toThrow(
      'disposed',
    );
    await expect(prepare(operation, config)).rejects.toThrow('disposed');
    expect(() =>
      operation.preflight({ provider: 'openai', authMode: 'none' }),
    ).toThrow('disposed');
    await expect(operation.dispose()).resolves.toBeUndefined();
  });
  it('refuses a different Config without overwriting its original attached owner', async () => {
    const operation = await prepareAgentPreflight(
      { runtimeId: 'attached-owner' },
      credentials().authority,
      settings,
    );
    cleanup.push(() => operation.dispose());
    await prepare(operation, config);
    const other = new Config({
      cwd: directory,
      targetDir: directory,
      sessionId: 'other',
      model: 'other-model',
      debugMode: false,
    });
    cleanup.push(() => other.dispose());
    await expect(prepare(operation, other)).rejects.toThrow('already prepared');
    expect(operation.captureInput().runtimeId).toBe('attached-owner');
    expect('providerFileLifecycle' in other).toBe(false);
  });
  it('failed attachment rolls back exactly its own physical files and leaves Config declarative', async () => {
    const operation = await prepareAgentPreflight(
      { runtimeId: 'rollback' },
      credentials().authority,
      settings,
    );
    cleanup.push(() => operation.dispose());
    await retained(operation, 'rollback-file');
    settings.set('activeProvider', 'does-not-exist');
    await expect(prepare(operation, config)).rejects.toThrow('does-not-exist');
    expect('providerFileLifecycle' in config).toBe(false);
    expect(await readdir(directory)).not.toContain('rollback-file');
    expect(() => operation.captureInput()).toThrow('disposed');
  });
  it('rejects invalid creation labels before acquiring credentials or attaching owner infrastructure', async () => {
    for (const runtimeId of ['', '  ']) {
      await expect(
        prepareAgentPreflight({ runtimeId }, credentials().authority, settings),
      ).rejects.toThrow('runtimeId');
      await expect(
        createAgent({
          provider: 'openai',
          model: 'owner-model',
          sessionId: runtimeId,
          workingDir: directory,
          credentialAuthority: credentials().authority,
        }),
      ).rejects.toThrow('Invalid runtimeId');
    }
    expect('providerFileLifecycle' in config).toBe(false);
    expect(credentials().snapshot()).toStrictEqual([]);
    expect('providerManager' in config).toBe(false);
    expect(files.retainsScope('session', 'rollback')).toBe(false);
  });
});
