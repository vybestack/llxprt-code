/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { Config } from '@vybestack/llxprt-code-core';
import { setupOwnerSessionRecording } from './cliSessionBootstrap.js';
import {
  __resetCleanupStateForTesting,
  registerCleanup,
  runExitCleanup,
} from './utils/cleanup.js';

const fixture = fileURLToPath(
  new URL(
    '../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    import.meta.url,
  ),
);

describe('foreground noninteractive recording owner', () => {
  const roots: string[] = [];
  const tempDirs = new Set<string>();
  const agents: Agent[] = [];
  const oldHome = process.env.LLXPRT_CONFIG_HOME;
  const oldFake = process.env.LLXPRT_FAKE_RESPONSES;

  afterEach(async () => {
    await runExitCleanup();
    __resetCleanupStateForTesting();
    for (const agent of agents.splice(0)) await agent.dispose();
    for (const directory of tempDirs) {
      await rm(directory, { recursive: true, force: true });
    }
    tempDirs.clear();
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = oldHome;
    if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
  });

  async function built(
    continueSession?: string,
    existingRoot?: string,
  ): Promise<{ agent: Agent; config: Config }> {
    const root = existingRoot ?? (await mkdtemp(join(tmpdir(), 'cli-owner-')));
    if (existingRoot === undefined) roots.push(root);
    const id = `owner-${agents.length + 1}`;
    process.env.LLXPRT_CONFIG_HOME = root;
    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      sessionId: id,
    });
    agents.push(agent);
    registerCleanup(() => agent.dispose());
    const config = new Config({
      cwd: root,
      targetDir: root,
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: id,
      model: 'fake-model',
      provider: 'fake',
      continueSession,
    });
    tempDirs.add(config.projectTempDir);
    return { agent, config };
  }

  it('starts, records and releases the same owner through exit cleanup', async () => {
    const { agent, config } = await built();
    const history = await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    expect(history).toBeNull();
    expect(agent.session.getRecording().enabled).toBe(true);
    for await (const _event of agent.stream('cli-owner-turn')) {
      // Consume the public run to completion.
    }
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Recording was not materialized');
    await runExitCleanup();
    expect(agent.session.getRecording().enabled).toBe(false);
    expect(await readFile(path, 'utf8')).toContain('cli-owner-turn');
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);

  it('resumes through the owner and returns replayable IContent', async () => {
    const { agent, config } = await built();
    await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of agent.stream('cli-owner-resume-seed')) {
      // Consume the public run to completion.
    }
    const path = agent.session.getRecording().path;
    expect(path).toBeDefined();
    await agent.session.setRecording({ enabled: false });
    const resumed = await built('owner-1', roots[0]);
    const duplicateAdoption = spyOn(resumed.config, 'adoptSessionId');
    const history = await setupOwnerSessionRecording(
      resumed.config,
      resumed.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    expect(duplicateAdoption).not.toHaveBeenCalled();
    expect(
      history?.some((content) =>
        content.blocks.some(
          (block) =>
            block.type === 'text' &&
            block.text.includes('cli-owner-resume-seed'),
        ),
      ),
    ).toBe(true);
    expect(resumed.agent.session.getRecording().path).toBe(path);
    await runExitCleanup();
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);

  it('flushes a live owner recording at a turn boundary without stopping it', async () => {
    const { agent, config } = await built();
    await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of agent.stream('owner-flush-boundary')) {
      // Consume the public run to completion.
    }
    await agent.session.flushRecording();
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Recording was not materialized');
    expect(await readFile(path, 'utf8')).toContain('owner-flush-boundary');
    expect(agent.session.getRecording().enabled).toBe(true);
    await agent.session.setRecording({ enabled: false });
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);

  it('persists owner events across stop and resume without writing while stopped', async () => {
    const { agent, config } = await built();
    await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of agent.stream('owner-event-seed')) {
      // Consume the public run to completion.
    }
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Recording was not materialized');

    await agent.session.recordRecordingEvent({
      type: 'provider_switch',
      provider: 'first-provider',
      model: 'first-model',
    });
    await agent.session.recordRecordingEvent({
      type: 'directories_changed',
      directories: ['/first', '/second'],
    });
    await agent.session.recordRecordingEvent({
      type: 'session_event',
      severity: 'warning',
      message: 'first-warning',
    });
    const beforeStop = await readFile(path, 'utf8');
    expect(beforeStop).toContain('"type":"provider_switch"');
    expect(beforeStop).toContain('"type":"directories_changed"');
    expect(beforeStop).toContain('"type":"session_event"');
    expect(beforeStop).toContain('first-warning');

    await agent.session.setRecording({ enabled: false });
    await agent.session.recordRecordingEvent({
      type: 'session_event',
      severity: 'error',
      message: 'must-not-appear',
    });
    expect(await readFile(path, 'utf8')).not.toContain('must-not-appear');

    const resumed = await built('owner-1', roots[0]);
    await setupOwnerSessionRecording(
      resumed.config,
      resumed.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    expect(resumed.agent.session.getRecording().path).toBe(path);
    await resumed.agent.session.recordRecordingEvent({
      type: 'provider_switch',
      provider: 'next-provider',
      model: 'next-model',
    });
    await resumed.agent.session.recordRecordingEvent({
      type: 'directories_changed',
      directories: ['/resumed'],
    });
    await resumed.agent.session.recordRecordingEvent({
      type: 'session_event',
      severity: 'info',
      message: 'resumed-event',
    });
    const afterResume = await readFile(path, 'utf8');
    expect(afterResume).toContain('next-provider');
    expect(afterResume).toContain('/resumed');
    expect(afterResume).toContain('resumed-event');
    expect(afterResume).not.toContain('must-not-appear');
  }, 30000);

  it('falls back to a fresh owned recording when a continue target is missing', async () => {
    const { agent, config } = await built('missing-session');
    expect(
      await setupOwnerSessionRecording(
        config,
        agent,
        { listSessions: false, deleteSession: undefined },
        null,
      ),
    ).toBeNull();
    expect(agent.session.getRecording().enabled).toBe(true);
    await agent.session.setRecording({ enabled: false });
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);

  it('forks a startup checkpoint through the owner without reusing its source lock', async () => {
    const { agent, config } = await built();
    await setupOwnerSessionRecording(
      config,
      agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    for await (const _event of agent.stream('cli-owner-checkpoint-seed')) {
      // Consume the public run to completion.
    }
    await agent.session.createCheckpoint('owner-checkpoint');
    const sourcePath = agent.session.getRecording().path;
    await agent.session.setRecording({ enabled: false });
    const resumed = await built('owner-checkpoint', roots[0]);
    const history = await setupOwnerSessionRecording(
      resumed.config,
      resumed.agent,
      { listSessions: false, deleteSession: undefined },
      null,
    );
    expect(
      history?.some((content) =>
        content.blocks.some(
          (block) =>
            block.type === 'text' &&
            block.text.includes('cli-owner-checkpoint-seed'),
        ),
      ),
    ).toBe(true);
    expect(resumed.agent.session.getRecording().path).not.toBe(sourcePath);
    await runExitCleanup();
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);

  it('releases the owner lock when observation validation fails', async () => {
    const { agent, config } = await built();
    const invalid = join(roots[0], 'invalid-bootstrap.json');
    await writeFile(invalid, '{}');
    await expect(
      setupOwnerSessionRecording(
        config,
        agent,
        { listSessions: false, deleteSession: undefined },
        { path: invalid, source: '--jsp-bootstrap' },
      ),
    ).rejects.toThrow('JSP bootstrap file named by --jsp-bootstrap');
    expect(agent.session.getRecording().enabled).toBe(false);
    expect(
      (await readdir(config.projectChatsDir)).filter((file) =>
        file.endsWith('.lock'),
      ),
    ).toStrictEqual([]);
  }, 30000);
});
