/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type OAuthManager,
  CredentialAuthority,
} from '@vybestack/llxprt-code-providers/auth.js';
import {
  MemoryTokenStore,
  makeExpiredToken,
} from '../../../../../providers/src/auth/__tests__/behavioral/test-utils.js';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureSessionOwner } from './capture-session-owner.js';
import type { SessionClientOwner } from '../../../session/session-client-owner.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createAgent,
  fromConfig,
  type Agent,
} from '@vybestack/llxprt-code-agents';
import { createRefreshableOAuthContribution } from './refreshable-oauth-provider.js';
import { enableOAuthProviders } from './oauth-contribution.js';
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
  readonly clientFor: (agent: Agent) => AgentClientContract;
  readonly shareHistory: (
    first: Agent,
    second: Agent,
  ) => Promise<HistoryService>;
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

async function createPausedRefreshAgent(
  authority: CredentialAuthority,
  workingDir: string,
  barrier: RecordingRefreshBarrier,
): Promise<{ agent: Agent; oauthManager: OAuthManager }> {
  const contribution = createRefreshableOAuthContribution([
    {
      alias: 'recording-refresh-oauth',
      refresh: async (current, signal) => {
        if (signal === undefined)
          throw new Error('Token refresh has no abort signal');
        barrier.entered(signal);
        await barrier.body;
        return {
          ...current,
          access_token: 'recording-rotated',
          refresh_token: 'recording-rotated-refresh',
          expiry: Math.floor(Date.now() / 1000) + 120,
        };
      },
    },
  ]);
  const store = new MemoryTokenStore();
  const previous = process.env.LLXPRT_FAKE_RESPONSES;
  delete process.env.LLXPRT_FAKE_RESPONSES;
  let agent: Agent;
  try {
    agent = await createAgent({
      provider: 'recording-refresh-oauth',
      model: 'initial-model',
      workingDir,
      interactive: true,
      telemetry: { enabled: false },
      recording: { enabled: false },
      credentialAuthority: authority,
      tokenStore: store,
      providerContributions: contribution.contributions,
      harness: { includeProcessCwd: false },
    });
  } finally {
    if (previous === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previous;
  }
  await store.saveToken(
    'recording-refresh-oauth',
    makeExpiredToken('recording-refresh'),
    'primary',
  );
  await store.saveToken(
    'recording-refresh-oauth',
    makeExpiredToken('recording-refresh-secondary'),
    'secondary',
  );
  const oauthManager = [...contribution.managers].pop();
  if (oauthManager === undefined)
    throw new Error('Contributed provider has no OAuth owner');
  return { agent, oauthManager };
}

function adoptRecordingAgent(
  built: BuiltCliConfig,
  authority: CredentialAuthority,
): Promise<Agent> {
  return fromConfig(
    built.config,
    built.settingsService,
    {
      sessionId: randomUUID(),
      activation: {
        provider: built.config.getProvider(),
        model: built.config.getModel(),
      },
    },
    authority,
  );
}

function recordingClientCaptures() {
  const owners = new Map<Agent, SessionClientOwner>();
  const clientFor = (selected: Agent): AgentClientContract => {
    const owner = owners.get(selected);
    if (owner === undefined) throw new Error('Unknown recording fixture agent');
    return owner.clients.getAgentClient();
  };
  const shareHistory = async (
    first: Agent,
    second: Agent,
  ): Promise<HistoryService> => {
    const shared = clientFor(first).getHistoryService();
    if (shared === null) throw new Error('Missing shared fixture history');
    const client = clientFor(second);
    const previous = client.getHistoryService();
    client.storeHistoryServiceForReuse(shared);
    if (previous !== null && previous !== shared) await previous.dispose();
    return shared;
  };
  return { owners, clientFor, shareHistory };
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
  const previousConfigHome = process.env.LLXPRT_CONFIG_HOME;
  const failures: unknown[] = [];
  try {
    if (refreshBarrier !== undefined) {
      const configHome = join(workingDir, 'config');
      await mkdir(configHome);
      process.env.LLXPRT_CONFIG_HOME = configHome;
      await enableOAuthProviders(configHome, ['recording-refresh-oauth']);
    }
    built = await buildCliStyleConfig(fixture, {
      workingDir,
      ...overrides,
    });
    let selectedOAuth = built.runtime.oauthManager;
    const prepared = built;
    const { config } = prepared;
    const authority =
      overrides.credentialAuthority ?? new CredentialAuthority();
    const { owners, clientFor, shareHistory } = recordingClientCaptures();
    const borrow = async (): Promise<Agent> => {
      if (refreshBarrier !== undefined) {
        const { value: paused, owner } = await captureSessionOwner(() =>
          createPausedRefreshAgent(authority, workingDir, refreshBarrier),
        );
        owners.set(paused.agent, owner);
        agents.push(paused.agent);
        selectedOAuth = paused.oauthManager;
        return paused.agent;
      }
      const { value: agent, owner } = await captureSessionOwner(() =>
        adoptRecordingAgent(prepared, authority),
      );
      owners.set(agent, owner);
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
      clientFor,
      shareHistory,
      oauthManager: selectedOAuth,
      chatsDir: join(config.projectTempDir, 'chats'),
    });
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await settleFixtureSteps([
        () => cleanupRecordingFixture(agents, built, workingDir),
        () => {
          if (previousConfigHome === undefined)
            delete process.env.LLXPRT_CONFIG_HOME;
          else process.env.LLXPRT_CONFIG_HOME = previousConfigHome;
        },
      ]);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Recording lifetime fixture failed');
}
