/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { CHECKPOINT_STORE_MARKER_FILENAME } from '@vybestack/llxprt-code-core/services/gitService.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';

import { toConfigParameters } from '../agentConfig.adapter.js';
import { fromConfig } from '../fromConfig.js';
import { cleanupFailedFromConfig } from '../fromConfig-cleanup.js';
import { runCleanupSteps } from '../../core/subagent-cleanup.js';

import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { buildTestMcpRuntime } from './helpers/mcp-owner-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

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

async function openCheckpointingConfig(): Promise<{
  config: Config;
  directory: string;
}> {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'from-config-bootstrap-failure-')),
  );
  const config = new Config(
    toConfigParameters({
      provider: 'fake',
      model: 'fake-model',
      workingDir: directory,
      sessionId: 'from-config-bootstrap-failure',
      checkpointing: true,
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    }),
  );
  cleanups.push(() =>
    runCleanupSteps([
      () => config.dispose(),
      () => rm(directory, { recursive: true, force: true }),
    ]),
  );
  return { config, directory };
}

describe('fromConfig bootstrap failure reporting', () => {
  useFakeResponsesReplay('plain-text.jsonl');
  const credentials = useOwnedCredentials();

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('surfaces a workspace initialization failure as the original error, not a cleanup wrapper', async () => {
    const { config } = await openCheckpointingConfig();
    const settings = new SettingsService();
    for (const [key, value] of Object.entries(config.getInitialSettings()))
      settings.set(key, value);
    await blockCheckpointConfiguration(config.projectHistoryDir);

    const outcome = await fromConfig(
      config,
      settings,
      { activation: { provider: 'fake', model: 'fake-model' } },
      credentials().authority,
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(outcome).not.toBeInstanceOf(AggregateError);
    expect(outcome).toMatchObject({
      message: expect.stringContaining('Failed to initialize checkpointing'),
    });
    expect(credentials().snapshot()).toStrictEqual([1]);
  });

  it('keeps the primary message visible when a genuine cleanup failure is also reported', async () => {
    const { config } = await openCheckpointingConfig();
    const policyWritePath = join(
      Storage.getUserPoliciesDir(),
      'auto-saved.toml.tmp',
    );
    await mkdir(policyWritePath, { recursive: true });
    const policy = new RuntimePolicyOwner(config);
    const mcpRuntime = await buildTestMcpRuntime(
      config,
      policy.session.messageBus,
      {},
      undefined,
      policy,
    );
    mcpRuntime.messageBus.publish({
      type: MessageBusType.UPDATE_POLICY,
      toolName: 'write_file',
      persist: true,
    });
    const primary = new Error('Failed to initialize checkpointing: fixture');

    const outcome = await cleanupFailedFromConfig(
      primary,
      undefined,
      async () => undefined,
      undefined,
      undefined,
      () => mcpRuntime.dispose(),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(outcome.message).toContain(primary.message);
    expect(outcome.errors[0]).toBe(primary);
    expect(collectMessages(outcome).join(' ')).toContain(policyWritePath);
    expect(outcome.errors).toHaveLength(2);
    expect(mcpRuntime.isStopped()).toBe(true);
  });
});
