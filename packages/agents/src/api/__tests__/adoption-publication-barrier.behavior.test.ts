import { adoptFixture as fromConfig } from './helpers/adoption-fixture.js';
import { prepareActivationFixture } from './helpers/activation-acquisition-capture.js';
import { createCapturedSessionOwner } from './helpers/session-client-capture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config,
  WorkspaceDefinitionOwner,
  assembleWorkspaceMemory,
} from '@vybestack/llxprt-code-core';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import { WorkspaceTrustLifecycle } from '@vybestack/llxprt-code-core/services/workspace-trust-lifecycle.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toConfigParameters } from '../agentConfig.adapter.js';

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { gate } from './helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('adoption publication barrier', () => {
  const credentials = useOwnedCredentials();
  const cleanups: Array<() => Promise<unknown> | void> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  async function acquireBarrier(succeed: boolean) {
    const directory = await mkdtemp(join(tmpdir(), 'adoption-publication-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const config = new Config(
      toConfigParameters({
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        folderTrust: true,
        mcpEnabled: false,
        skillsSupport: false,
        telemetry: { enabled: false },
        recording: { enabled: false },
      }),
    );
    cleanups.push(() => config.dispose());
    const settings = new SettingsService();
    const selected = new SessionSettingsOwner(settings);
    selected.bindTelemetry(config);
    cleanups.push(() => selected.dispose());
    const manager = new ProviderManager(
      undefined,
      undefined,
      undefined,
      undefined,
      settings,
      config,
    );
    cleanups.push(() => manager.dispose());
    const keys = credentials().authority.createProviderKeyStorage();
    cleanups.push(() => keys.close());
    manager.bindProviderKeyStorage(keys);
    const trust = new WorkspaceTrustLifecycle({ localTrust: true });
    cleanups.push(() => trust.dispose());
    const filesystem = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => trust.isTrustedFolder(),
    });
    const memory = assembleWorkspaceMemory(config, filesystem, trust);
    const definitions = new WorkspaceDefinitionOwner(
      join(directory, 'profiles'),
      join(directory, 'subagents'),
    );
    const media = new SessionMediaOwner(config.projectTempDir, 1024);
    const client = await createCapturedSessionOwner(
      config,
      assembleTaskSchemaPolicy(settings),
      manager,
      createAgentRuntimeFactoryBindings().agentClientFactory,
      media.store,
      () => undefined,
      filesystem.paths,
      selected,
      createRuntimeContentGeneratorFactory(),
      configureProviderTokenizer(manager),
    );
    const entered = gate();
    const release = gate();
    cleanups.push(() => release.release());
    client.bindImageOperation(async (input) => {
      entered.release();
      await release.promise;
      if (!succeed) throw new Error('accepted image transport failed');
      return {
        operation: 'generate',
        absoluteOutputPath: join(directory, input.outputPath),
        relativeOutputPath: input.outputPath,
        mimeType: 'image/png',
        backend: 'owned-test-transport',
        provider: 'test',
        model: 'test',
        inputPaths: [],
      };
    });
    const operation = prepareActivationFixture(
      config,
      manager,
      async () => ({ authFailed: false, infoMessages: [] }),
      undefined,
      media,
      client,
      filesystem,
      memory,
      true,
      selected,
      'borrowed',
      definitions,
      true,
      trust,
    );
    cleanups.push(() => operation.dispose().catch(() => undefined));
    const intent = { model: 'unconfigured' };
    const result = await operation.preflight(intent);
    if (result.token === undefined)
      throw new Error('Missing preflight receipt');
    const token = result.token;
    const image = operation.sessionClient
      .runImageOperation({
        prompt: 'accepted before adoption',
        outputPath: 'accepted.png',
      })
      .catch((error: unknown) => error);
    await entered.promise;
    const adopt = (replacementFilesystem?: WorkspaceFilesystemOwner) =>
      fromConfig(
        config,
        settings,
        { activation: intent },
        selected,
        manager,
        undefined,
        undefined,
        undefined,
        { operation, token },
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
        replacementFilesystem,
      );
    return { operation, selected, media, filesystem, image, release, adopt };
  }
  it('closes preflight admission before construction and joins accepted images before publishing', async () => {
    const { operation, selected, media, filesystem, image, release, adopt } =
      await acquireBarrier(false);
    let settled = false;
    const adopting = adopt();
    const outcome = adopting.then(
      async (agent) => {
        settled = true;
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      await expect(operation.sessionClient.refreshAuth()).rejects.toThrow(
        /disposed/,
      );
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(await media.store.getStoredByteLength()).toBe(0);
      release.release();
      expect(await image).toBeInstanceOf(Error);
      expect(await outcome).toBeInstanceOf(AggregateError);
      await expect(media.store.getStoredByteLength()).rejects.toThrow(/closed/);
      expect(() => filesystem.paths.directories()).toThrow(/disposed/);
      selected.writeUserParameter('survived-adoption', true);
      expect(selected.readNamedParameter('survived-adoption')).toBe(true);
    } finally {
      release.release();
      await image;
      await outcome;
    }
  });
  it('publishes a ready agent only after accepted image work has settled', async () => {
    const built = await acquireBarrier(true);
    let published = false;
    const adopting = built.adopt().then((agent) => {
      published = true;
      return agent;
    });
    await expect(built.operation.sessionClient.refreshAuth()).rejects.toThrow(
      /disposed/,
    );
    await Promise.resolve();
    expect(published).toBe(false);
    expect(await built.media.store.getStoredByteLength()).toBe(0);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    const agent = await adopting;
    try {
      expect(published).toBe(true);
      expect(agent.workspace.getDirectories()).toContain(
        built.filesystem.paths.directories()[0],
      );
      expect(await agent.getHistory()).toStrictEqual([]);
      expect(agent.listTools().length).toBeGreaterThan(0);
    } finally {
      await agent.dispose();
    }
    await expect(built.media.store.getStoredByteLength()).rejects.toThrow(
      /closed/,
    );
    expect(() => built.filesystem.paths.directories()).toThrow(/disposed/);
    built.selected.writeUserParameter('borrowed-after-ready', 1);
    expect(built.selected.readNamedParameter('borrowed-after-ready')).toBe(1);
  });

  it('joins accepted work before cancelled adoption releases its owned resources', async () => {
    const built = await acquireBarrier(true);
    let published = false;
    const adopting = built.adopt().then(
      async (agent) => {
        published = true;
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => error,
    );
    let closed = false;
    const closing = built.operation.dispose().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(await built.media.store.getStoredByteLength()).toBe(0);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    expect(await adopting).toBeInstanceOf(Error);
    await closing;
    expect(published).toBe(false);
    expect(closed).toBe(true);
    await expect(built.media.store.getStoredByteLength()).rejects.toThrow(
      /closed/,
    );
    expect(() => built.filesystem.paths.directories()).toThrow(/disposed/);
    built.selected.writeUserParameter('borrowed-after-cancel', 2);
    expect(built.selected.readNamedParameter('borrowed-after-cancel')).toBe(2);
  });

  it('rejects replacement workspace identity before acquisition and joins accepted work during rollback', async () => {
    const built = await acquireBarrier(true);
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), 'other-adoption-workspace-')),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const replacement = new WorkspaceFilesystemOwner({
      targetDir: directory,
      isTrusted: () => true,
    });
    cleanups.push(() => replacement.dispose());
    let settled = false;
    const adopting = built.adopt(replacement).then(
      async (agent) => {
        settled = true;
        await agent.dispose();
        return undefined;
      },
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(await built.media.store.getStoredByteLength()).toBe(0);
    built.release.release();
    expect(await built.image).not.toBeInstanceOf(Error);
    expect(await adopting).toBeInstanceOf(Error);
    expect(String(await adopting)).toContain(
      'Preflight workspace owners cannot be replaced',
    );
    expect(replacement.paths.directories()).toContain(directory);
    expect(() => built.filesystem.paths.directories()).toThrow(/disposed/);
    await expect(built.media.store.getStoredByteLength()).rejects.toThrow(
      /closed/,
    );
    built.selected.writeUserParameter('borrowed-after-identity-rejection', 3);
    expect(
      built.selected.readNamedParameter('borrowed-after-identity-rejection'),
    ).toBe(3);
  });
});
