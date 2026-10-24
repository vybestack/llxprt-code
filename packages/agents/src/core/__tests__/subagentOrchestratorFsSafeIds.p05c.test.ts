/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { readJournalFileFacts } from '@vybestack/llxprt-code-core/recording/journalSessionListing.js';

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

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import type { SubagentConfig } from '@vybestack/llxprt-code-core/config/types.js';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { isValidSafeSessionId } from '@vybestack/llxprt-code-core/recording/janitor/sessionSafety.js';
import { SESSION_FILE_ID_PREFIX_LENGTH } from '@vybestack/llxprt-code-core/recording/sessionFileName.js';
import type { AgentRuntimeLoaderOptions } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';
import { afterEach, describe, expect, it, setSystemTime, vi } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSessionSettingsFixture,
  subagentSessionPorts,
} from '../../api/__tests__/helpers/session-settings-fixture.js';
import type { SubAgentScope } from '../subagent.js';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import {
  createRuntimeBundle,
  fixtureToolSelection,
} from './subagentOrchestrator-test-helpers.js';

import { createLockedSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectJournalRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

function restoreBackend(): void {}

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

const createWorkspaceFilesystem = installTestWorkspaceFilesystem();
const launchRoots = new Set<string>();

function makeForegroundConfig(
  sessionId = PARENT_SESSION_ID,
  directory = mkdtempSync(join(tmpdir(), 'orchestrator-journal-')),
): Config {
  const config = new Config({
    sessionId,
    provider: 'gemini',
    model: 'gemini-1.5-flash',
    targetDir: directory,
    cwd: directory,
    debugMode: false,
  });
  launchRoots.add(directory);
  launchRoots.add(config.projectTempDir);
  return config;
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
  let childContext: SubAgentScope['runtimeContext'] | undefined;
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
      const bundle = createRuntimeBundle('sess', history);
      childContext = bundle.runtimeContext;
      return {
        ...bundle,
        history,
        runtimeContext: { ...bundle.runtimeContext, history },
      };
    });
  const scope = {
    get runtimeContext(): SubAgentScope['runtimeContext'] {
      if (childContext === undefined) throw new Error('Child runtime missing');
      return childContext;
    },
    getAgentId: () => 'child-agent-1',
  } as unknown as SubAgentScope;
  const scopeFactory = vi.fn<typeof SubAgentScope.create>(async () => {
    onScope?.();
    return scope;
  });
  const session = createSessionSettingsFixture(config);
  const orchestrator = new SubagentOrchestrator({
    ...subagentSessionPorts(session),
    instructions: emptyInstructionReads,
    toolRegistry: fixtureToolSelection(),
    workspacePaths: createWorkspaceFilesystem({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    }).paths,
    readMcpInstructions: () => undefined,
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

async function resetRuntimeAfterTest(): Promise<void> {
  setSystemTime();
  const roots = [...launchRoots];
  launchRoots.clear();
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
}

describe('P05c orchestrator allocates fs-safe child ids @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(restoreBackend);

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
    const config = makeForegroundConfig();
    Object.defineProperty(config, 'projectTempDir', { value: undefined });
    const { orchestrator } = buildOrchestrator(config);
    await expect(orchestrator.launch({ name: 'helper' })).rejects.toThrow(
      /must be of type string/,
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
  afterEach(restoreBackend);

  afterEach(resetRuntimeAfterTest);

  it('keeps parallel and nested journals separate and preserves the parent', async () => {
    setSystemTime(new Date('2026-09-21T12:00:00Z'));
    const config = makeForegroundConfig();
    const chatsDir = config.projectChatsDir;
    const parent = await createLockedSessionRecorder({
      sessionId: PARENT_SESSION_ID,
      projectHash: 'parent',
      chatsDir,
      workspaceDirs: [],
      provider: 'gemini',
      model: 'gemini-1.5-flash',
    });
    await recordRowsForTest(parent, [
      { speaker: 'human', blocks: [{ type: 'text', text: 'parent' }] },
    ]);
    await parent.flush();
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
      file.endsWith('.llxj'),
    );
    expect(new Set(files).size).toBe(3);
    expect(new Set(files.map((file) => file.slice(0, 27))).size).toBe(1);
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(3);
    const headers = await Promise.all(
      files.map((file) => readJournalFileFacts(join(chatsDir, file))),
    );
    expect(
      headers.some(
        (header) =>
          header?.facts.start.kind === 'subagent' &&
          header.facts.start.parentSessionId === PARENT_SESSION_ID,
      ),
    ).toBe(true);
    const childId = capturedStates(runtimeLoader)[0].sessionId;
    const nestedConfig = makeForegroundConfig(childId, config.getTargetDir());
    const nested = await buildOrchestrator(nestedConfig).orchestrator.launch({
      name: 'helper',
    });
    const nestedFiles = await readdir(chatsDir);
    expect(nestedFiles.filter((file) => file.endsWith('.llxj'))).toHaveLength(
      4,
    );
    const nestedFile = nestedFiles.find(
      (file) => file.endsWith('.llxj') && !files.includes(file),
    );
    if (nestedFile === undefined) throw new Error('Nested journal missing');
    const nestedText = await readFile(join(chatsDir, nestedFile), 'utf8');
    const nestedHeader = await readJournalFileFacts(join(chatsDir, nestedFile));
    expect(nestedHeader?.facts.start).toMatchObject({
      kind: 'subagent',
      parentSessionId: childId,
    });
    expect(nestedText).toContain('"text":"child"');
    await nested.dispose();
    expect(
      (await readdir(chatsDir)).filter((file) => file.endsWith('.llxj')),
    ).toHaveLength(3);
    await first.dispose();
    await second.dispose();
    expect((await readdir(chatsDir)).sort()).toStrictEqual(baseline);
    expect(await readFile(parentFile, 'utf8')).toBe(before);
    await parent.dispose();
  });
});

describe('mandatory launch journal failure cleanup', () => {
  afterEach(restoreBackend);

  afterEach(resetRuntimeAfterTest);

  it('removes the child journal when scope startup fails after runtime creation', async () => {
    const config = makeForegroundConfig();
    const { orchestrator } = buildOrchestrator(config, undefined, () => {
      throw new Error('scope startup failed');
    });
    await expect(orchestrator.launch({ name: 'helper' })).rejects.toThrow(
      'scope startup failed',
    );
    expect(await readdir(config.projectChatsDir)).toStrictEqual([]);
  });

  it.each(['failure', 'cancel', 'timeout'] as const)(
    'removes the real file and lock after launch %s',
    async (mode) => {
      const config = makeForegroundConfig();
      const controller = new AbortController();
      const chatsDir = config.projectChatsDir;
      const { orchestrator } = buildOrchestrator(config, async () => {
        const files = await readdir(chatsDir);
        expect(files.filter((file) => file.endsWith('.llxj'))).toHaveLength(1);
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

describe.each(['journal'] as const)('production child history on %s', () => {
  afterEach(restoreBackend);

  afterEach(resetRuntimeAfterTest);

  it.each(['normal', 'execution-failure', 'execution-cancel'] as const)(
    'persists isolated child history and releases it after %s',
    async (mode) => {
      const config = makeForegroundConfig();
      const parent = await createLockedSessionRecorder({
        sessionId: PARENT_SESSION_ID,
        projectHash: 'parent',
        chatsDir: config.projectChatsDir,
        workspaceDirs: [],
        provider: 'gemini',
        model: 'gemini-1.5-flash',
      });
      const parentHistory = new HistoryService({ recording: parent });
      parentHistory.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'parent' }],
      });
      await parentHistory.waitForCommit();
      const parentFile = parent.getFilePath();
      if (parentFile === null) throw new Error('Missing parent file');
      const before = await readFile(parentFile);
      const baseline = (await readdir(config.projectChatsDir)).sort();
      const { orchestrator } = buildOrchestrator(config);
      try {
        const result = await orchestrator.launch({ name: 'helper' });
        try {
          const history = result.runtime.history;
          expect(history.journalPath()?.endsWith('.llxj')).toBe(true);
          await collectJournalRowsForAssertions(history, (rows) => {
            expect(rows.map((row) => row.blocks)).toStrictEqual([
              [{ type: 'text', text: 'child' }],
            ]);
          });
          const dump = await history.openDumpSnapshot();
          const outcome = await executeChild(history, mode).then(
            () => 'completed',
            (error: unknown) =>
              error instanceof Error ? error.message : String(error),
          );
          const expectedOutcomes = {
            normal: 'completed',
            'execution-failure': 'child execution failed',
            'execution-cancel': 'The operation was aborted.',
          };
          expect(outcome).toBe(expectedOutcomes[mode]);
          await collectJournalRowsForAssertions(history, (rows) => {
            expect(rows.map((row) => row.speaker)).toStrictEqual([
              'human',
              'ai',
            ]);
          });

          await result.dispose();
          await expect(
            Promise.resolve().then(() => history.openDumpSnapshot()),
          ).rejects.toThrow(/disposed/);
          await expect(
            Promise.resolve().then(() =>
              dump.rows()[Symbol.asyncIterator]().next(),
            ),
          ).rejects.toThrow(/closed/);
          expect((await readdir(config.projectChatsDir)).sort()).toStrictEqual(
            baseline,
          );
          expect(await readFile(parentFile)).toStrictEqual(before);
        } finally {
          await result.dispose();
        }
      } finally {
        await parentHistory.dispose();
        await parent.dispose();
      }
    },
  );

  it.each(['runtime-failure', 'scope-failure', 'cancel', 'timeout'] as const)(
    'releases history reads and removes file and lock after %s',
    async (mode) => {
      const config = makeForegroundConfig();
      const controller = new AbortController();
      let dump:
        | Awaited<ReturnType<HistoryService['openDumpSnapshot']>>
        | undefined;
      let history: HistoryService | undefined;
      const { orchestrator } = buildOrchestrator(
        config,
        async (options) => {
          history = options.overrides?.historyService;
          if (history === undefined) throw new Error('Missing child history');
          history.add({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'in-flight child' }],
          });
          await history.waitForCommit();
          dump = await history.openDumpSnapshot();
          if (mode === 'runtime-failure') throw new Error('runtime failed');
          if (mode === 'cancel') controller.abort();
          if (mode === 'timeout') {
            await new Promise<void>((resolve) => {
              const deadline = AbortSignal.timeout(1);
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
        },
        () => {
          if (mode === 'scope-failure') throw new Error('scope failed');
        },
      );
      try {
        await expect(
          orchestrator.launch({ name: 'helper' }, controller.signal),
        ).rejects.toThrow(
          {
            'runtime-failure': /runtime failed/,
            'scope-failure': /scope failed/,
            cancel: /aborted/,
            timeout: /aborted/,
          }[mode],
        );
        if (dump === undefined) throw new Error('Missing child read');
        if (history === undefined) throw new Error('Missing child history');
        const childHistory = history;
        await expect(
          Promise.resolve().then(() => childHistory.openDumpSnapshot()),
        ).rejects.toThrow(/disposed/);
        const heldDump = dump;
        await expect(
          Promise.resolve().then(() =>
            heldDump.rows()[Symbol.asyncIterator]().next(),
          ),
        ).rejects.toThrow(/closed/);
        expect(await readdir(config.projectChatsDir)).toStrictEqual([]);
      } finally {
        await dump?.close();
        await history?.dispose();
      }
    },
  );
});

async function executeChild(
  history: HistoryService,
  mode: 'normal' | 'execution-failure' | 'execution-cancel',
): Promise<void> {
  history.add({
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'child execution' }],
  });
  await history.waitForCommit();
  const controller = new AbortController();
  if (mode === 'execution-cancel') controller.abort();
  controller.signal.throwIfAborted();
  if (mode === 'execution-failure') throw new Error('child execution failed');
}
