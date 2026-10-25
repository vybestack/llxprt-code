/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Config } from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AgentEvent } from '../event-types.js';
import { ForegroundRunLifecycle } from '../foregroundRunLifecycle.js';
import {
  SessionExecutionOwner,
  toLoopResolution,
} from '../../session/session-execution-owner.js';
import { openClientOwner } from './helpers/client-owner-session.js';
import { useFakeResponsesReplay } from './helpers/fake-responses-replay.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('session execution resolution keeps the initialization failure', () => {
  useFakeResponsesReplay('multi-turn-text.jsonl');
  const credentials = useOwnedCredentials();
  const cleanup: Array<() => void | Promise<void>> = [];
  let client: AgentClientContract;
  let config: Config;
  let policy: RuntimePolicyOwner;
  let settings: SessionSettingsOwner;

  beforeEach(async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'execution-resolution-'));
    cleanup.push(() => rm(temporary, { recursive: true, force: true }));
    const directory = await realpath(temporary);
    config = new Config({
      sessionId: 'execution-resolution',
      cwd: directory,
      targetDir: directory,
      model: 'fake-model',
      provider: 'fake',
      debugMode: false,
      telemetry: { enabled: false },
    });
    cleanup.push(() => config.dispose());
    policy = new RuntimePolicyOwner(config);
    cleanup.push(() => policy.dispose());
    settings = new SessionSettingsOwner(new SettingsService());
    cleanup.push(() => settings.dispose());
    settings.bindTelemetry(config);
    const opened = await openClientOwner(
      credentials().authority,
      {
        provider: 'fake',
        model: 'fake-model',
        workingDir: directory,
        harness: { includeProcessCwd: false },
      },
      { provider: 'fake', model: 'fake-model' },
    );
    cleanup.push(() => opened.close());
    client = opened.client;
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
      throw new AggregateError(
        failures,
        'Execution resolution fixture cleanup failed',
      );
  });

  function acquireExecution(): SessionExecutionOwner {
    return new SessionExecutionOwner(
      config,
      settings,
      policy.session.messageBus,
      client.tools,
      () => settings.readToolGovernance([]),
      policy.trust,
      undefined,
      undefined,
      undefined,
    );
  }

  it('returns the closed-session error as the cause of an initialization failure', async () => {
    const owner = acquireExecution();
    owner.initialize(client);
    await owner.dispose();

    const resolution = owner.resolve(client);

    expect(resolution.execution).toBeUndefined();
    expect(resolution.error).toMatchObject({
      kind: 'initialization-failed',
      message: 'Agent loop initialization failed: Session execution is closed',
    });
    const cause =
      resolution.error?.kind === 'initialization-failed'
        ? resolution.error.cause
        : undefined;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe('Session execution is closed');
  });

  it('reports an owner that was never initialized as not initialized, with no cause', () => {
    const owner = acquireExecution();
    cleanup.push(() => owner.dispose());

    const resolution = owner.resolve(client);

    expect(resolution).toStrictEqual({
      error: {
        kind: 'not-initialized',
        message: 'Agent loop is not initialized',
      },
    });
  });

  it('yields the same cause on the error event of a run whose execution is closed', async () => {
    const owner = acquireExecution();
    owner.initialize(client);
    await owner.dispose();
    const lifecycle = new ForegroundRunLifecycle(
      {
        transcriptPath: () => undefined,
        persistSemanticMediaPurge: async () => {},
      },
      () => false,
      () => true,
      () => {},
      () => {},
      () => toLoopResolution(owner.resolve(client)),
      () => undefined,
      async () => new Map<string, string>(),
      () => {},
      () => {},
    );

    const events: AgentEvent[] = [];
    for await (const event of lifecycle.stream('hello')) events.push(event);

    expect(events.map((event) => event.type)).toStrictEqual(['error', 'done']);
    const [failure, done] = events;
    expect(done).toStrictEqual({ type: 'done', reason: 'error' });
    if (failure.type !== 'error') throw new Error('Expected an error event');
    expect(failure.error.message).toBe(
      'Agent loop initialization failed: Session execution is closed',
    );
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe(
      'Session execution is closed',
    );
    expect(failure.error).toStrictEqual({
      message: 'Agent loop initialization failed: Session execution is closed',
    });
  });
});
