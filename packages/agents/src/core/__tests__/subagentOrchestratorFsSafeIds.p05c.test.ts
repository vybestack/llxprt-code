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

import { afterEach, describe, expect, it, vi, setSystemTime } from 'bun:test';
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
import { makeRecordingInputs } from './subagent-journal-fixture.js';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';

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

function makeForegroundConfig(
  recording = true,
  sessionId = PARENT_SESSION_ID,
  inputs = makeRecordingInputs(),
): Config {
  const settingsService = new SettingsService();
  return {
    ...(recording ? inputs : {}),
    getSessionId: () => sessionId,
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

function buildOrchestrator(
  config: Config = makeForegroundConfig(),
  onLoad?: (options: AgentRuntimeLoaderOptions) => Promise<void>,
  onScope?: () => void,
): {
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
    .mockImplementation(async (options: AgentRuntimeLoaderOptions) => {
      await onLoad?.(options);
      const history = options.overrides?.historyService;
      if (history === undefined) throw new Error('Child history required');
      history.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'child' }],
      });
      await history.waitForCommit();
      const bundle = createRuntimeBundle('sess');
      return {
        ...bundle,
        history,
        runtimeContext: { ...bundle.runtimeContext, history },
      };
    });
  const scope = {
    runtimeContext: createRuntimeBundle('sess').runtimeContext,
    getAgentId: () => 'child-agent-1',
  } as unknown as SubAgentScope;
  const scopeFactory = vi.fn<typeof SubAgentScope.create>(async () => {
    onScope?.();
    return scope;
  });
  const orchestrator = new SubagentOrchestrator({
    subagentManager: { loadSubagent } as unknown as SubagentManager,
    profileManager: { loadProfile } as unknown as ProfileManager,
    foregroundConfig: config,
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

function resetRuntimeAfterTest(): void {
  setSystemTime();
  runtimeModule.resetRuntimeScopeForTesting();
  runtimeModule.resetCliRuntimeRegistryForTesting();
}

describe('P05c orchestrator allocates fs-safe child ids @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(resetRuntimeAfterTest);

  it('allocates a child sessionId that passes the safe-session lock grammar', async () => {
    const { orchestrator, runtimeLoader } = buildOrchestrator();
    const dispose = await launch(orchestrator, 'helper');
    const [state] = capturedStates(runtimeLoader);
    expect(state).toBeDefined();
    expect(isValidSafeSessionId(state.sessionId)).toBe(true);
    await dispose();
  });

  it('rejects launch when mandatory recording inputs are absent', async () => {
    const { orchestrator } = buildOrchestrator(makeForegroundConfig(false));
    await expect(orchestrator.launch({ name: 'helper' })).rejects.toThrow(
      /getProjectTempDir/,
    );
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

describe('mandatory launch journal lifecycle', () => {
  afterEach(resetRuntimeAfterTest);

  it('keeps parallel and nested journals separate and preserves the parent', async () => {
    setSystemTime(new Date('2026-09-21T12:00:00Z'));
    const config = makeForegroundConfig();
    const chatsDir = config.storage.getProjectChatsDir();
    const parent = await SessionRecordingService.createLocked({
      sessionId: PARENT_SESSION_ID,
      projectHash: 'parent',
      chatsDir,
      workspaceDirs: [],
      provider: 'gemini',
      model: 'gemini-1.5-flash',
    });
    await parent.commit('session_event', {
      severity: 'info',
      message: 'parent',
    });
    const parentFile = parent.getFilePath();
    if (parentFile === null) throw new Error('Parent file missing');
    const before = await readFile(parentFile, 'utf8');
    const baseline = (await readdir(chatsDir)).sort();
    const { orchestrator, runtimeLoader } = buildOrchestrator(config);
    const [first, second] = await Promise.all([
      orchestrator.launch({ name: 'helper' }),
      orchestrator.launch({ name: 'scout' }),
    ]);
    const files = (await readdir(chatsDir)).filter((file) =>
      file.endsWith('.jsonl'),
    );
    expect(new Set(files).size).toBe(3);
    expect(new Set(files.map((file) => file.slice(0, 27))).size).toBe(1);
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(3);
    const headers = await Promise.all(
      files.map(async (file) => readFile(join(chatsDir, file), 'utf8')),
    );
    const childHeader = headers.find((text) =>
      text.includes('"kind":"subagent"'),
    );
    if (childHeader === undefined) throw new Error('Child header missing');
    const header: unknown = JSON.parse(childHeader.split('\n')[0]);
    expect(header).toMatchObject({
      payload: { kind: 'subagent', parentSessionId: PARENT_SESSION_ID },
    });
    const childId = capturedStates(runtimeLoader)[0].sessionId;
    const nestedConfig = makeForegroundConfig(true, childId, {
      storage: config.storage,
      getWorkspaceContext: () => config.getWorkspaceContext(),
    });
    const nested = await buildOrchestrator(nestedConfig).orchestrator.launch({
      name: 'helper',
    });
    const nestedFiles = await readdir(chatsDir);
    expect(nestedFiles.filter((file) => file.endsWith('.jsonl'))).toHaveLength(
      4,
    );
    const nestedFile = nestedFiles.find(
      (file) => file.endsWith('.jsonl') && !files.includes(file),
    );
    if (nestedFile === undefined) throw new Error('Nested journal missing');
    const nestedText = await readFile(join(chatsDir, nestedFile), 'utf8');
    const nestedHeader: unknown = JSON.parse(nestedText.split('\n')[0]);
    expect(nestedHeader).toMatchObject({
      payload: { kind: 'subagent', parentSessionId: childId },
    });
    expect(nestedText).toContain('"text":"child"');
    await nested.dispose();
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.jsonl')),
    ).toHaveLength(3);
    await first.dispose();
    await second.dispose();
    expect((await readdir(chatsDir)).sort()).toStrictEqual(baseline);
    expect(await readFile(parentFile, 'utf8')).toBe(before);
    await parent.dispose();
  });
});

describe('mandatory launch journal failure cleanup', () => {
  afterEach(resetRuntimeAfterTest);

  it('removes the child journal when scope startup fails after runtime creation', async () => {
    const config = makeForegroundConfig();
    const { orchestrator } = buildOrchestrator(config, undefined, () => {
      throw new Error('scope startup failed');
    });
    await expect(orchestrator.launch({ name: 'helper' })).rejects.toThrow(
      'scope startup failed',
    );
    expect(await readdir(config.storage.getProjectChatsDir())).toStrictEqual(
      [],
    );
  });

  it.each(['failure', 'cancel', 'timeout'] as const)(
    'removes the real file and lock after launch %s',
    async (mode) => {
      const config = makeForegroundConfig();
      const controller = new AbortController();
      const chatsDir = config.storage.getProjectChatsDir();
      const { orchestrator } = buildOrchestrator(config, async () => {
        const files = await readdir(chatsDir);
        expect(files.filter((file) => file.endsWith('.jsonl'))).toHaveLength(1);
        expect(files.filter((file) => file.endsWith('.lock'))).toHaveLength(1);
        if (mode === 'failure') throw new Error('runtime assembly failed');
        if (mode === 'cancel') {
          controller.abort(new DOMException('cancelled', 'AbortError'));
        } else {
          const deadline = AbortSignal.timeout(1);
          await new Promise<void>((resolve) => {
            deadline.addEventListener(
              'abort',
              () => {
                controller.abort(deadline.reason);
                resolve();
              },
              { once: true },
            );
          });
        }
      });
      await expect(
        orchestrator.launch({ name: 'helper' }, controller.signal),
      ).rejects.toThrow(
        mode === 'failure' ? 'runtime assembly failed' : /aborted/,
      );
      expect(await readdir(chatsDir)).toStrictEqual([]);
    },
  );
});
