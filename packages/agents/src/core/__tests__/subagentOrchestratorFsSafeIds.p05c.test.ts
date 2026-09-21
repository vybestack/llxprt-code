/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: the SubagentOrchestrator allocates each child's
 * runtime sessionId as a random FS-SAFE id BEFORE runtime construction and
 * threads the parent session id onto the child runtime state.
 *
 * RED on assertion: the orchestrator exists, but `createRuntimeId` builds
 * `${parent}#${name}#${suffix}` runtime ids and `createRuntimeState` derives
 * `${parent}::${runtimeId}` sessionIds. The `::`/`#` characters fail the
 * safe-session lock grammar, every child of one parent shares the parent's
 * first 12 filename characters, and no parentSessionId is threaded. All four
 * red assertions below fail until the green session reworks id allocation.
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import {
  SettingsService,
  type Profile,
  type ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentRuntimeLoaderOptions } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import * as runtimeModule from '@vybestack/llxprt-code-providers/runtime.js';
import { isValidSafeSessionId } from '@vybestack/llxprt-code-core/recording/janitor/sessionSafety.js';
import { SESSION_FILE_ID_PREFIX_LENGTH } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import type { SubAgentScope } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { createRuntimeBundle } from './subagentOrchestrator-test-helpers.js';

const PARENT_SESSION_ID = 'primary-session';

const subagentConfigs: Record<string, SubagentConfig> = {
  helper: {
    name: 'helper',
    profile: 'helper-profile',
    systemPrompt: 'You are a helpful assistant.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  scout: {
    name: 'scout',
    profile: 'scout-profile',
    systemPrompt: 'You scout.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

const profiles: Record<string, Profile> = {
  'helper-profile': {
    version: 1,
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    modelParams: { temperature: 0.3, top_p: 0.95 },
    ephemeralSettings: { 'auth-key': 'helper-key' },
  },
  'scout-profile': {
    version: 1,
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    modelParams: { temperature: 0.3, top_p: 0.95 },
    ephemeralSettings: { 'auth-key': 'scout-key' },
  },
};

function makeForegroundConfig(): Config {
  const settingsService = new SettingsService();
  return {
    getSessionId: () => PARENT_SESSION_ID,
    getProvider: () => 'gemini',
    getContentGeneratorConfig: () => undefined,
    getModel: () => 'gemini-1.5-flash',
    getToolRegistry: () => undefined,
    getSettingsService: () => settingsService,
    getEphemeralSetting: () => undefined,
  } as unknown as Config;
}

type RuntimeLoaderMock = {
  mock: { calls: ReadonlyArray<readonly unknown[]> };
};

function buildOrchestrator(): {
  orchestrator: SubagentOrchestrator;
  runtimeLoader: RuntimeLoaderMock;
} {
  const loadSubagent = vi
    .fn()
    .mockImplementation(async (name: string) => subagentConfigs[name]);
  const loadProfile = vi
    .fn()
    .mockImplementation(async (name: string) => profiles[name]);
  const runtimeLoader = vi
    .fn()
    .mockImplementation(async (_options: AgentRuntimeLoaderOptions) =>
      createRuntimeBundle('sess'),
    );
  const scope = {
    runtimeContext: createRuntimeBundle('sess').runtimeContext,
    getAgentId: () => 'child-agent-1',
  } as unknown as SubAgentScope;
  const scopeFactory = vi
    .fn<typeof SubAgentScope.create>()
    .mockResolvedValue(scope);
  const orchestrator = new SubagentOrchestrator({
    subagentManager: { loadSubagent } as unknown as SubagentManager,
    profileManager: { loadProfile } as unknown as ProfileManager,
    foregroundConfig: makeForegroundConfig(),
    scopeFactory,
    runtimeLoader,
    messageBus: new MessageBus(),
  });
  return { orchestrator, runtimeLoader };
}

function capturedStates(runtimeLoader: RuntimeLoaderMock): AgentRuntimeState[] {
  return runtimeLoader.mock.calls.map(
    (call: readonly unknown[]) =>
      (call[0] as AgentRuntimeLoaderOptions).profile.state,
  );
}

async function launch(
  orchestrator: SubagentOrchestrator,
  name: string,
): Promise<() => Promise<void>> {
  const result = await orchestrator.launch({ name });
  return result.dispose;
}

afterEach(() => {
  runtimeModule.resetRuntimeScopeForTesting();
  runtimeModule.resetCliRuntimeRegistryForTesting();
});

describe('P05c orchestrator allocates fs-safe child ids @plan:PLAN-20260917-ISSUE854.P05c', () => {
  it('allocates a child sessionId that passes the safe-session lock grammar', async () => {
    const { orchestrator, runtimeLoader } = buildOrchestrator();
    const dispose = await launch(orchestrator, 'helper');
    const [state] = capturedStates(runtimeLoader);
    expect(state).toBeDefined();
    expect(isValidSafeSessionId(state.sessionId)).toBe(true);
    await dispose();
  });

  it('keeps the child sessionId distinct from the parent session id', async () => {
    const { orchestrator, runtimeLoader } = buildOrchestrator();
    const dispose = await launch(orchestrator, 'helper');
    const [state] = capturedStates(runtimeLoader);
    expect(state.sessionId).not.toBe(PARENT_SESSION_ID);
    await dispose();
  });

  it('gives parallel launches distinct filename prefixes in one bucket', async () => {
    const { orchestrator, runtimeLoader } = buildOrchestrator();
    const [disposeA, disposeB] = await Promise.all([
      launch(orchestrator, 'helper'),
      launch(orchestrator, 'scout'),
    ]);
    const states = capturedStates(runtimeLoader);
    expect(states).toHaveLength(2);
    const prefixes = new Set(
      states.map((state) =>
        state.sessionId.slice(0, SESSION_FILE_ID_PREFIX_LENGTH),
      ),
    );
    expect(prefixes.size).toBe(2);
    await disposeA();
    await disposeB();
  });

  it('threads the parent session id onto the child runtime state', async () => {
    const { orchestrator, runtimeLoader } = buildOrchestrator();
    const dispose = await launch(orchestrator, 'helper');
    const [state] = capturedStates(runtimeLoader);
    const threaded = (state as AgentRuntimeState & { parentSessionId?: string })
      .parentSessionId;
    expect(threaded).toBe(PARENT_SESSION_ID);
    await dispose();
  });
});
