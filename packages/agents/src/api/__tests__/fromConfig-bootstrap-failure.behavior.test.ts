/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { fromConfig } from '../fromConfig.js';
import { McpRuntimeOwner } from '../mcpRuntimeAssembly.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

const cleanups: Array<() => Promise<void>> = [];

async function adoptionOptions() {
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
      folderTrust: true,
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
      settings: { jitContextEnabled: false },
    },
  );
  cleanups.push(built.cleanup);
  const manager = new ProviderManager({
    settingsService: built.settingsService,
  });
  manager.registerProvider(
    new FakeProvider(join(import.meta.dir, 'fixtures/plain-text.jsonl')),
  );
  return {
    ...built,
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
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('surfaces a workspace initialization failure as the original error, not a cleanup wrapper', async () => {
    const primary = new Error(
      'checkpoint history is not backed by a persistent checkpoint store',
    );
    vi.spyOn(IdeClient, 'create').mockRejectedValue(primary);

    const outcome = await fromConfig(await adoptionOptions()).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(outcome).toBe(primary);
  });

  it('keeps the primary message visible when a genuine cleanup failure is also reported', async () => {
    const primary = new Error('workspace initialization failed');
    vi.spyOn(IdeClient, 'create').mockRejectedValue(primary);
    vi.spyOn(McpRuntimeOwner.prototype, 'dispose').mockRejectedValue(
      new Error('workspace disposal failed'),
    );

    const outcome = await fromConfig(await adoptionOptions()).then(
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
