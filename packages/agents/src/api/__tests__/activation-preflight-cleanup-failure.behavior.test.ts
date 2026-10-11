/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FakeProvider,
  ProviderManager,
} from '@vybestack/llxprt-code-providers';
import { fromConfig } from '../fromConfig.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import { buildFactoryLessConfig } from './helpers/buildCliStyleConfig.js';

const cleanups: Array<() => Promise<void>> = [];

async function failingCleanupOperation() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), 'preflight-cleanup-failure-')),
  );
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const built = await buildFactoryLessConfig(
    'plain-text.jsonl',
    {},
    {
      workingDir: directory,
      sessionId: 'preflight-cleanup-failure',
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
  vi.spyOn(built.settingsOwner, 'dispose').mockRejectedValue(
    new Error('settings disposal failed'),
  );
  const operation = assembleAgentActivationBootstrap(
    built.config,
    built.settingsService,
    manager,
    null,
    () => undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    built.settingsOwner,
    'transferred',
    built.policyOwner.trust,
    () => Promise.reject(new Error('trust cleanup failed')),
  );
  const intent = { provider: 'fake', model: 'fake-model' };
  const result = await operation.preflight(intent);
  if (!result.token) throw new Error('Missing actual preflight token');
  return { built, manager, operation, intent, token: result.token };
}

function messagesOf(error: unknown): string[] {
  if (error instanceof AggregateError)
    return [error.message, ...error.errors.flatMap(messagesOf)];
  return [error instanceof Error ? error.message : String(error)];
}

describe('activation preflight cleanup failure reporting', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('reports a settings disposal rejection together with the other collected resource failures', async () => {
    const { operation } = await failingCleanupOperation();
    const outcome = await Promise.resolve(operation.dispose()).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
  });

  it('keeps the original adoption failure when preflight cleanup also fails', async () => {
    const { built, manager, operation, token } =
      await failingCleanupOperation();
    const outcome = await fromConfig({
      ...built,
      providerManager: manager,
      activation: { provider: 'fake', model: 'a-different-model' },
      activationPreflight: { operation, token },
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(AggregateError);
    if (!(outcome instanceof AggregateError))
      throw new Error('Expected an AggregateError');
    expect(messagesOf(outcome.errors[0])[0]).toContain(
      'Activation preflight intent mismatch',
    );
    const messages = messagesOf(outcome);
    expect(messages).toContain('trust cleanup failed');
    expect(messages).toContain('settings disposal failed');
  });
});
