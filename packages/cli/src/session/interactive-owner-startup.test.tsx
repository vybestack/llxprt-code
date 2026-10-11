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
import { fileURLToPath } from 'node:url';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  Config,
  getProjectHash,
  listSessions,
} from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { LoadedSettings } from '../config/settings.js';
import { setupOwnerSessionRecording } from '../cliSessionBootstrap.js';
import { dispatchInteractiveOrNonInteractive } from './nonInteractiveSession.js';
import {
  __setRenderForTesting,
  __resetInteractiveUIStateForTesting,
} from './interactiveUI.js';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from '../utils/cleanup.js';
import { AppWrapper } from '../ui/App.js';
import { iContentToHistoryItems } from '../ui/utils/iContentToHistoryItems.js';
import { listOwnerBrowserTargets } from '../ui/utils/ownerSessionUi.js';

const fixture = fileURLToPath(
  new URL(
    '../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    import.meta.url,
  ),
);
const settings = {
  merged: { ui: { hideWindowTitle: true, unicode: 'auto' } },
} as LoadedSettings;

describe('interactive CLI owner startup', () => {
  const roots: string[] = [];
  const agents: Agent[] = [];
  const oldHome = process.env.LLXPRT_CONFIG_HOME;
  const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
  afterEach(async () => {
    __setRenderForTesting(null);
    __resetInteractiveUIStateForTesting();
    await runExitCleanup();
    __resetCleanupStateForTesting();
    for (const agent of agents.splice(0)) await agent.dispose();
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = oldHome;
    if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
  });

  async function build(
    continueSession?: string,
    root?: string,
  ): Promise<{
    agent: Agent;
    config: Config;
    root: string;
    runtimeSettings: { owner: SessionSettingsOwner; store: SettingsService };
  }> {
    const directory =
      root ?? (await mkdtemp(join(tmpdir(), 'interactive-owner-')));
    if (root === undefined) roots.push(directory);
    process.env.LLXPRT_CONFIG_HOME = directory;
    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    const id = `owner-${agents.length + 1}`;
    const config = new Config({
      cwd: directory,
      targetDir: directory,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: id,
      model: 'fake-model',
      provider: 'fake',
      continueSession,
      interactive: true,
    });
    const store = new SettingsService();
    const owner = new SessionSettingsOwner(store);
    const runtimeSettings = { owner, store };
    registerCleanup(async () => {
      await owner.dispose();
      await config.dispose();
    });
    const agent = await fromConfig({
      config,
      settingsService: store,
      settingsOwner: owner,
      activation: { provider: 'fake', model: 'fake-model' },
    });
    agents.push(agent);
    registerCleanup(() => agent.dispose());
    return { agent, config, root: directory, runtimeSettings };
  }

  async function renderOwner(
    config: Config,
    agent: Agent,
    history: Awaited<ReturnType<typeof setupOwnerSessionRecording>>,
    runtimeSettings: { owner: SessionSettingsOwner; store: SettingsService },
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
      resumedHistory: history,
      hasPipedInput: false,
      readStdinData: async () => '',
    });
    if (!tree) throw new Error('Ink tree not rendered');
    return tree;
  }

  function appProps(tree: React.ReactElement): Record<string, unknown> {
    const visit = (
      node: React.ReactNode,
    ): Record<string, unknown> | undefined => {
      if (!React.isValidElement(node)) return undefined;
      if (node.type === AppWrapper)
        return node.props as Record<string, unknown>;
      const props = node.props as { children?: React.ReactNode };
      return React.Children.toArray(props.children)
        .map(visit)
        .find((value) => value !== undefined);
    };
    const props = visit(tree);
    if (!props) throw new Error('AppWrapper missing');
    return props;
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
    const props = appProps(
      await renderOwner(config, agent, history, runtimeSettings),
    );
    expect(props.agent).toBe(agent);
    expect(props.recordingOwner).toBe('agent');
    expect(props).not.toHaveProperty('recordingIntegration');
    expect(props).not.toHaveProperty('initialRecordingService');
    expect(props).not.toHaveProperty('initialLockHandle');
    expect(await locks(config)).toHaveLength(1);
    for await (const _event of agent.stream('fresh-interactive-turn')) {
      /* consume */
    }
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('No recording path');
    expect(await readFile(path, 'utf8')).toContain('fresh-interactive-turn');
    await agent.session.setRecording({ enabled: false });
    expect(
      appProps(await renderOwner(config, agent, null, runtimeSettings))
        .recordingOwner,
    ).toBe('agent');
    expect(agent.session.getRecording().enabled).toBe(false);
    await runExitCleanup();
    expect(await locks(config)).toHaveLength(0);
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
    const targets = await listOwnerBrowserTargets(source.agent);
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
    expect(props.agent).toBe(resumed.agent);
    expect(JSON.stringify(props.resumedHistory)).toContain(
      'resume-interactive-seed',
    );
    expect(
      iContentToHistoryItems(history ?? [], 'allowed').some(
        (item) =>
          item.type === 'user' && item.text === 'resume-interactive-seed',
      ),
    ).toBe(true);
    expect(resumed.agent.session.getRecording().path).toBe(path);
    expect(
      (await listOwnerBrowserTargets(resumed.agent)).some(
        (target) =>
          target.kind === 'session' && target.session.filePath === path,
      ),
    ).toBe(true);
    expect(await locks(resumed.config)).toHaveLength(1);
    for await (const _event of resumed.agent.stream(
      'resume-interactive-continued',
    )) {
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
    expect(JSON.stringify(props.resumedHistory)).toContain(
      'fork-interactive-seed',
    );
    expect(
      iContentToHistoryItems(history ?? [], 'allowed').some(
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
      ).resumedHistory,
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
