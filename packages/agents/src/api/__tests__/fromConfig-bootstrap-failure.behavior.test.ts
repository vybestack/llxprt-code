/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { WorkspaceCheckpointOwner } from '@vybestack/llxprt-code-core/services/workspace-checkpoint-owner.js';
import { fromConfig } from '../fromConfig.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

async function adoptionOptions(
  credentialAuthority: CredentialAuthority,
  checkpointing = false,
) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'from-config-bootstrap-failure-')),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const built = await buildFactoryLessConfig(
    'plain-text.jsonl',
    {},
    {
      workingDir: directory,
      sessionId: 'from-config-bootstrap-failure',
      checkpointing,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    },
  );
  cleanups.push(built.cleanup);
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    built.settingsService,
  );
  manager.registerProvider(
    new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
  );
  return {
    ...built,
    credentialAuthority,
    providerManager: manager,
    activation: { provider: 'fake', model: 'fake-model' },
  };
}

function collectMessages(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(collectMessages)];
  return [error instanceof Error ? error.message : String(error)];
}

describe('fromConfig bootstrap failure reporting', () => {
  const credentials = useOwnedCredentials();

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('surfaces a workspace initialization failure as the original error, not a cleanup wrapper', async () => {
    const options = await adoptionOptions(credentials().authority, true);
    await mkdir(join(options.config.projectHistoryDir, '.gitconfig'), {
      recursive: true,
    });
    const failures: unknown[] = [];
    const initialize = WorkspaceCheckpointOwner.prototype.initialize;
    vi.spyOn(
      WorkspaceCheckpointOwner.prototype,
      'initialize',
    ).mockImplementation(function (this: WorkspaceCheckpointOwner) {
      return initialize.call(this).catch((error: unknown) => {
        failures.push(error);
        throw error;
      });
    });

    const outcome = await fromConfig(options).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failures).toHaveLength(1);
    expect(outcome).toBe(failures[0]);
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(AggregateError);
    expect(outcome).toMatchObject({
      message: expect.stringContaining('Failed to initialize checkpointing'),
    });
    expect(credentials().snapshot()).toStrictEqual([1]);
  });

  it('keeps the primary message visible when a genuine cleanup failure is also reported', async () => {
    const primary = new Error('workspace initialization failed');
    vi.spyOn(IdeClient, 'create').mockRejectedValue(primary);
    vi.spyOn(McpRuntimeOwner.prototype, 'dispose').mockRejectedValue(
      new Error('workspace disposal failed'),
    );

    const outcome = await fromConfig(
      await adoptionOptions(credentials().authority),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(outcome.message).toContain('workspace initialization failed');
    expect(outcome.errors[0]).toBe(primary);
    expect(collectMessages(outcome)).toContain('workspace disposal failed');
  });
});
