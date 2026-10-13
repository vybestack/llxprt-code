/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import type { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import { WorkspaceCheckpointOwner } from '@vybestack/llxprt-code-core/services/workspace-checkpoint-owner.js';
import { CHECKPOINT_STORE_MARKER_FILENAME } from '@vybestack/llxprt-code-core/services/gitService.js';
import { fromConfig } from '../fromConfig.js';
import { assembleMcpRuntime } from '../mcpOAuthAssembly.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

async function adoptionOptions(credentialAuthority: CredentialAuthority) {
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
      checkpointing: true,
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

async function blockCheckpointConfiguration(
  historyDirectory: string,
): Promise<void> {
  await mkdir(join(historyDirectory, '.gitconfig'), { recursive: true });
  await writeFile(
    join(historyDirectory, CHECKPOINT_STORE_MARKER_FILENAME),
    'fixture',
  );
}

function collectMessages(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(collectMessages)];
  return [error instanceof Error ? error.message : String(error)];
}

function observeCheckpointFailures(): unknown[] {
  const failures: unknown[] = [];
  const initialize = WorkspaceCheckpointOwner.prototype.initialize;
  vi.spyOn(WorkspaceCheckpointOwner.prototype, 'initialize').mockImplementation(
    function (this: WorkspaceCheckpointOwner) {
      return initialize.call(this).catch((error: unknown) => {
        failures.push(error);
        throw error;
      });
    },
  );
  return failures;
}

describe('fromConfig bootstrap failure reporting', () => {
  const credentials = useOwnedCredentials();

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('surfaces a workspace initialization failure as the original error, not a cleanup wrapper', async () => {
    const options = await adoptionOptions(credentials().authority);
    await blockCheckpointConfiguration(options.config.projectHistoryDir);
    const failures = observeCheckpointFailures();

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
    const options = await adoptionOptions(credentials().authority);
    await blockCheckpointConfiguration(options.config.projectHistoryDir);
    const policyWritePath = join(
      Storage.getUserPoliciesDir(),
      'auto-saved.toml.tmp',
    );
    await mkdir(policyWritePath, { recursive: true });
    const mcpRuntime = await assembleMcpRuntime(
      options.config,
      undefined,
      {},
      undefined,
      'runtime',
      options.settingsOwner,
    );
    mcpRuntime.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'write_file',
      persist: true,
    });
    const failures = observeCheckpointFailures();

    const outcome = await fromConfig({
      ...options,
      mcpRuntime,
      mcpOwnership: 'agent',
      policyOwner: mcpRuntime.policyOwner,
      messageBus: mcpRuntime.messageBus,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(failures).toHaveLength(1);
    const primary = failures[0];
    if (!(primary instanceof Error))
      throw new Error('Expected a checkpoint initialization error');
    expect(outcome.message).toContain(primary.message);
    expect(outcome.errors[0]).toBe(primary);
    expect(collectMessages(outcome).join(' ')).toContain(policyWritePath);
    expect(outcome.errors).toHaveLength(2);
    expect(mcpRuntime.isStopped()).toBe(true);
    expect(credentials().snapshot()).toStrictEqual([1]);
  });
});
