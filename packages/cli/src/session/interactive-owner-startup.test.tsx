/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Agent } from '@vybestack/llxprt-code-agents';
import {
  type Config,
  getProjectHash,
  listSessions,
} from '@vybestack/llxprt-code-core';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';
import { createMockSettings } from '../__tests__/render.js';
import { setupOwnerSessionRecording as setupOwnerSessionRecordingCore } from '../cliSessionBootstrap.js';
import { dispatchInteractiveOrNonInteractive } from '../__tests__/session-dispatch-fixture.js';
import { __setRenderForTesting } from './interactiveUI.js';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from '../utils/cleanup.js';
import { AppWrapper } from '../ui/App.js';
import { iContentToHistoryItems } from '../ui/utils/iContentToHistoryItems.js';
import { collectResumeRows } from '../__tests__/resumeRows.js';

const settings = createMockSettings({
  ui: { hideWindowTitle: true, unicode: 'auto' },
});

function setupOwnerSessionRecording(
  config: Parameters<typeof setupOwnerSessionRecordingCore>[0],
  agent: Agent,
  argv: Parameters<typeof setupOwnerSessionRecordingCore>[3],
  selection: Parameters<typeof setupOwnerSessionRecordingCore>[4],
  warnings?: Parameters<typeof setupOwnerSessionRecordingCore>[5],
) {
  return setupOwnerSessionRecordingCore(
    config,
    agent.session,
    agent.session.listBrowserTargetsDetailed.bind(agent.session),
    argv,
    selection,
    warnings,
  ).then(({ resumedBoot }) => resumedBoot);
}

describe('interactive CLI owner startup', () => {
  const roots: string[] = [];
  const agents: Agent[] = [];
  const routes: RouteBPreflight[] = [];
  const oldHome = process.env.LLXPRT_CONFIG_HOME;
  useFakeResponsesReplay('plain-text.jsonl');
  afterEach(async () => {
    __setRenderForTesting(null);

    await runExitCleanup();
    __resetCleanupStateForTesting();
    for (const agent of agents.splice(0)) await agent.dispose();
    for (const route of routes.splice(0)) await route.close();
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = oldHome;
  });

  async function build(
    continueSession?: string,
    root?: string,
  ): Promise<{
    agent: Agent;
    config: Config;
    root: string;
    runtimeSettings: RouteBPreflight['preflight'];
  }> {
    const directory =
      root ?? (await mkdtemp(join(tmpdir(), 'interactive-owner-')));
    if (root === undefined) roots.push(directory);
    process.env.LLXPRT_CONFIG_HOME = directory;
    const route = await openRouteBPreflight({
      config: {
        workingDir: directory,
        sessionId: `owner-${agents.length + 1}`,
        interactive: true,
        settings: { continueSession },
      },
    });
    routes.push(route);
    await route.prepare();
    const agent = await route.createAgent();
    agents.push(agent);
    registerCleanup(() => agent.dispose());
    return {
      agent,
      config: route.config,
      root: directory,
      runtimeSettings: route.preflight,
    };
  }

  async function renderOwner(
    config: Config,
    agent: Agent,
    history: Awaited<ReturnType<typeof setupOwnerSessionRecording>>,
    runtimeSettings: RouteBPreflight['preflight'],
  ): Promise<React.ReactElement> {
    let tree: React.ReactElement | undefined;
    __setRenderForTesting((node) => {
      if (!React.isValidElement(node))
        throw new Error('Ink tree was not an element');
      tree = node;
      return {
        clear: () => {},
        unmount: () => {},
        waitUntilExit: async () => {},
      } as never;
    });
    await dispatchInteractiveOrNonInteractive({
      runtimeSettings,
      config,
      agent,
      settings,
      workspaceRoot: config.getProjectRoot(),
      recordingOwner: 'agent',
      resumedBoot: history,
      hasPipedInput: false,
      readStdinData: async () => '',
    });
    if (!tree) throw new Error('Ink tree not rendered');
    return tree;
  }

  function appProps(
    tree: React.ReactElement,
  ): React.ComponentProps<typeof AppWrapper> {
    const visit = (
      node: React.ReactNode,
    ): React.ComponentProps<typeof AppWrapper> | undefined => {
      if (
        !React.isValidElement<
          React.ComponentProps<typeof AppWrapper> & {
            children?: React.ReactNode;
          }
        >(node)
      )
        return undefined;
      if (node.type === AppWrapper) return node.props;
      return React.Children.toArray(node.props.children)
        .map(visit)
        .find((value) => value !== undefined);
    };
    const props = visit(tree);
    if (!props) throw new Error('AppWrapper missing');
    return props;
  }

  async function resumedItems(
    history: Awaited<ReturnType<typeof setupOwnerSessionRecording>>,
  ): Promise<ReturnType<typeof iContentToHistoryItems>> {
    if (history === null) throw new Error('Expected resumed rows');
    return iContentToHistoryItems(
      await collectResumeRows(history.streamRows()),
      'allowed',
    );
  }

  async function locks(config: Config): Promise<string[]> {
    return (await readdir(config.projectChatsDir)).filter((name) =>
      name.endsWith('.lock'),
    );
  }

  it('renders fresh with one Agent owner, appends JSONL and releases its lock', async () => {
    const { config, agent, runtimeSettings } = await build();
    const history = await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    await renderOwner(config, agent, history, runtimeSettings);
    expect(await locks(config)).toHaveLength(1);
    for await (const _event of agent.stream('fresh-interactive-turn')) {
      /* consume */
    }
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('No recording path');
    expect(await readFile(path, 'utf8')).toContain('fresh-interactive-turn');
    await agent.session.setRecording({ enabled: false });
    await renderOwner(config, agent, null, runtimeSettings);
    expect(agent.session.getRecording().enabled).toBe(false);
    await runExitCleanup();
    expect(await locks(config)).toHaveLength(0);
  }, 30000);

  it('disposes only the rendered owner through the input shutdown operation', async () => {
    const first = await build();
    const second = await build();
    const history = await setupOwnerSessionRecording(
      first.config,
      first.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    await setupOwnerSessionRecording(
      second.config,
      second.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    const props = appProps(
      await renderOwner(
        first.config,
        first.agent,
        history,
        first.runtimeSettings,
      ),
    );
    expect(await locks(first.config)).toHaveLength(1);
    expect(await locks(second.config)).toHaveLength(1);
    const disposeInput = props.disposeInput;
    if (typeof disposeInput !== 'function')
      throw new Error('Missing input shutdown');
    await disposeInput();
    expect(await locks(first.config)).toHaveLength(0);
    expect(await locks(second.config)).toHaveLength(1);
    for await (const _event of second.agent.stream(
      'surviving-interactive-owner',
    )) {
      /* consume */
    }
    const path = second.agent.session.getRecording().path;
    if (!path) throw new Error('No sibling recording path');
    expect(await readFile(path, 'utf8')).toContain(
      'surviving-interactive-owner',
    );
  }, 30000);

  it('replays a resumed session into the same Agent and continues writing to its original JSONL', async () => {
    const source = await build();
    await setupOwnerSessionRecording(
      source.config,
      source.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of source.agent.stream('resume-interactive-seed')) {
      /* consume */
    }
    const recording = source.agent.session.getRecording();
    const path = recording.path;
    await source.agent.session.setRecording({ enabled: false });
    const targets = await source.agent.session.listBrowserTargets();
    const persisted = targets.find(
      (target) => target.kind === 'session' && target.session.filePath === path,
    );
    if (persisted?.kind !== 'session')
      throw new Error('Expected persisted recording');
    const resumed = await build(persisted.session.sessionId, source.root);
    const history = await setupOwnerSessionRecording(
      resumed.config,
      resumed.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    const props = appProps(
      await renderOwner(
        resumed.config,
        resumed.agent,
        history,
        resumed.runtimeSettings,
      ),
    );
    expect(props.readAgentRecordingPath()).toBe(
      resumed.agent.session.getRecording().path,
    );
    if (history === null) throw new Error('Missing resumed journal boot');
    expect(props.resumedBoot).toBe(history);
    expect(
      (await resumedItems(history)).some(
        (item) =>
          item.type === 'user' && item.text === 'resume-interactive-seed',
      ),
    ).toBe(true);
    expect(resumed.agent.session.getRecording().path).toBe(path);
    expect(
      (await resumed.agent.session.listBrowserTargets()).some(
        (target) =>
          target.kind === 'session' && target.session.filePath === path,
      ),
    ).toBe(true);
    expect(await locks(resumed.config)).toHaveLength(1);
    for await (const _event of props.stream('resume-interactive-continued')) {
      /* consume */
    }
    if (!path) throw new Error('No recording path');
    expect(await readFile(path, 'utf8')).toContain(
      'resume-interactive-continued',
    );
  }, 30000);

  it('forks a checkpoint without taking a second lock on its source', async () => {
    const source = await build();
    await setupOwnerSessionRecording(
      source.config,
      source.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of source.agent.stream('fork-interactive-seed')) {
      /* consume */
    }
    await source.agent.session.createCheckpoint('fork-point');
    const sourcePath = source.agent.session.getRecording().path;
    await source.agent.session.setRecording({ enabled: false });
    const fork = await build('fork-point', source.root);
    const history = await setupOwnerSessionRecording(
      fork.config,
      fork.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    const props = appProps(
      await renderOwner(fork.config, fork.agent, history, fork.runtimeSettings),
    );
    if (history === null) throw new Error('Missing resumed journal boot');
    expect(props.resumedBoot).toBe(history);
    expect(
      (await resumedItems(history)).some(
        (item) => item.type === 'user' && item.text === 'fork-interactive-seed',
      ),
    ).toBe(true);
    expect(fork.agent.session.getRecording().path).not.toBe(sourcePath);
    expect(await locks(fork.config)).toHaveLength(1);
  }, 30000);

  it('uses fresh Agent recording on failed resume, and leaves no lock on failed bootstrap', async () => {
    const fallback = await build('missing-session');
    const history = await setupOwnerSessionRecording(
      fallback.config,
      fallback.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    expect(
      appProps(
        await renderOwner(
          fallback.config,
          fallback.agent,
          history,
          fallback.runtimeSettings,
        ),
      ).resumedBoot,
    ).toBeUndefined();
    expect(await locks(fallback.config)).toHaveLength(1);
    await fallback.agent.session.setRecording({ enabled: false });
    const failed = await build(undefined, fallback.root);
    const invalid = join(fallback.root, 'invalid.json');
    await writeFile(invalid, '{}');
    await expect(
      setupOwnerSessionRecording(
        failed.config,
        failed.agent,
        { listSessions: false, deleteSession: undefined },
        { path: invalid, source: '--jsp-bootstrap' },
      ),
    ).rejects.toThrow('JSP bootstrap file named by --jsp-bootstrap');
    expect(await locks(failed.config)).toHaveLength(0);
  }, 30000);

  it('handles list and delete before starting an owner or taking its lock', async () => {
    const source = await build();
    await setupOwnerSessionRecording(
      source.config,
      source.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of source.agent.stream('early-exit-seed')) {
      /* consume */
    }
    const recording = source.agent.session.getRecording();
    const path = recording.path;
    await source.agent.session.setRecording({ enabled: false });
    const next = await build(undefined, source.root);
    const listed = await listSessions(
      next.config.projectChatsDir,
      getProjectHash(next.config.getProjectRoot()),
    );
    expect(listed.sessions.length).toBeGreaterThan(0);
    const exit = spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`early-exit:${code}`);
    });
    try {
      await expect(
        setupOwnerSessionRecording(
          next.config,
          next.agent,
          { listSessions: true, deleteSession: undefined },
          null,
        ),
      ).rejects.toThrow('early-exit:0');
      expect(next.agent.session.getRecording().enabled).toBe(false);
      await expect(
        setupOwnerSessionRecording(
          next.config,
          next.agent,
          { listSessions: false, deleteSession: '1' },
          null,
        ),
      ).rejects.toThrow('early-exit:0');
      if (!path) throw new Error('No recording path');
      expect(await readdir(next.config.projectChatsDir)).not.toContain(
        path.split('/').at(-1),
      );
      expect(await locks(next.config)).toHaveLength(0);
    } finally {
      exit.mockRestore();
    }
  }, 30000);
});
