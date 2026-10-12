/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spyOn } from 'bun:test';
import { fileURLToPath } from 'node:url';
import {
  OAuthManager,
  AnthropicOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { FakeProvider } from '../../../../../providers/src/fake/FakeProvider.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from '../../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import type { AgentConfig } from '../../config-types.js';
import {
  buildCliStyleConfig,
  type BuiltCliConfig,
} from './buildCliStyleConfig.js';

interface RecordingLifetimeFixture {
  readonly config: BuiltCliConfig['config'];
  readonly settingsOwner: BuiltCliConfig['settingsOwner'];
  readonly settingsService: BuiltCliConfig['settingsService'];
  readonly agent: Agent;
  readonly chatsDir: string;
  readonly oauthManager: OAuthManager;
  readonly borrow: () => Promise<Agent>;
}

async function settleFixtureSteps(
  steps: ReadonlyArray<() => Promise<void> | void>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Recording lifetime fixture cleanup failed',
    );
}

async function disposeRecordingAgent(agent: Agent): Promise<void> {
  await settleFixtureSteps([
    async () => {
      if (agent.session.getRecording().enabled)
        await agent.session.setRecording({ enabled: false });
    },
    () => agent.dispose(),
  ]);
}

async function cleanupRecordingFixture(
  agents: readonly Agent[],
  built: BuiltCliConfig | undefined,
  workingDir: string,
): Promise<void> {
  await settleFixtureSteps([
    ...[...agents].reverse().map((agent) => () => disposeRecordingAgent(agent)),
    async () => {
      await built?.config.dispose();
    },
    async () => {
      await built?.cleanup();
    },
    async () => {
      if (built !== undefined)
        await rm(built.config.projectTempDir, {
          recursive: true,
          force: true,
        });
    },
    () => rm(workingDir, { recursive: true, force: true }),
  ]);
}

export interface RecordingRefreshBarrier {
  readonly entered: (signal: AbortSignal) => void;
  readonly body: Promise<void>;
}

async function pauseProviderRefresh(
  built: BuiltCliConfig,
  workingDir: string,
  barrier: RecordingRefreshBarrier,
): Promise<{
  readonly oauthManager: OAuthManager;
  readonly restore: () => void;
}> {
  const manager = built.providerManager;

  const provider = new FakeProvider(
    fileURLToPath(
      new URL('../fixtures/multi-turn-text.jsonl', import.meta.url),
    ),
    workingDir,
  );
  provider.name = 'claudecode';
  provider.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
  manager.registerProvider(provider);
  const store = new MemoryTokenStore();
  await store.saveToken(
    'claudecode',
    makeExpiredToken('recording-refresh'),
    'primary',
  );
  const oauth = new OAuthManager(store, undefined, {
    config: built.config,
    messageBus: built.messageBus,
  });
  oauth.registerProvider(new AnthropicOAuthProvider(store));
  await oauth.toggleOAuthEnabled('claudecode');
  built.sessionClient.bindProviderFiles(
    built.runtime.providerFileLifecycle,
    (provider) => oauth.composeRetryOperations(provider),
  );
  const transport = spyOn(globalThis, 'fetch').mockImplementation(
    async (input, init): Promise<Response> => {
      if (
        String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
        !(init?.body instanceof URLSearchParams) ||
        init.body.get('grant_type') !== 'refresh_token' ||
        !init.signal
      )
        throw new Error(`Unexpected provider request: ${String(input)}`);
      const signal = init.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller): Promise<void> {
            barrier.entered(signal);
            await barrier.body;
            controller.enqueue(
              new TextEncoder().encode(
                JSON.stringify({
                  access_token: 'recording-rotated',
                  refresh_token: 'recording-rotated-refresh',
                  expires_in: 120,
                }),
              ),
            );
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    },
  );
  return { oauthManager: oauth, restore: () => transport.mockRestore() };
}

export async function withRecordingLifetimeFixture(
  scenario: (fixture: RecordingLifetimeFixture) => Promise<void>,
  refreshBarrier?: RecordingRefreshBarrier,
  overrides: Readonly<Partial<AgentConfig>> = {},
  fixture = 'multi-turn-text.jsonl',
): Promise<void> {
  const workingDir = await mkdtemp(join(tmpdir(), 'recording-owner-lifetime-'));
  let built: BuiltCliConfig | undefined;
  const agents: Agent[] = [];
  let restoreTransport: (() => void) | undefined;
  const failures: unknown[] = [];
  try {
    built = await buildCliStyleConfig(fixture, {
      workingDir,
      ...overrides,
    });
    let selectedOAuth = built.runtime.oauthManager;
    if (refreshBarrier) {
      const paused = await pauseProviderRefresh(
        built,
        workingDir,
        refreshBarrier,
      );
      restoreTransport = paused.restore;
      selectedOAuth = paused.oauthManager;
    }
    const {
      config,
      messageBus,
      mcpRuntime,
      providerManager,
      agentClient,
      settingsService,
      runtime,
    } = built;
    const borrow = async (): Promise<Agent> => {
      const agent = await fromConfig({
        oauthManager: selectedOAuth,
        providerFileLifecycle: runtime.providerFileLifecycle,
        settingsService,
        config,
        agentClient,
        providerManager,
        messageBus,
        mcpRuntime,
        sessionId: `${randomUUID()}-recording-lifetime`,
      });
      agents.push(agent);
      return agent;
    };
    const agent = await borrow();
    await scenario({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      config,
      agent,
      borrow,
      oauthManager: selectedOAuth,
      chatsDir: join(config.projectTempDir, 'chats'),
    });
  } catch (error) {
    failures.push(error);
  } finally {
    for (const step of [
      () => cleanupRecordingFixture(agents, built, workingDir),
      () => restoreTransport?.(),
    ]) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Recording lifetime fixture failed');
}
