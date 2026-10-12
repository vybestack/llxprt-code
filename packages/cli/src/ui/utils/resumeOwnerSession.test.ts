/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgent, type Agent } from '@vybestack/llxprt-code-agents';
import { resumeOwnerSession } from './resumeOwnerSession.js';

const fixture = fileURLToPath(
  new URL(
    '../../../../agents/src/api/__tests__/fixtures/plain-text.jsonl',
    import.meta.url,
  ),
);

describe('interactive owner session replay', () => {
  const roots: string[] = [];
  const agents: Agent[] = [];
  const previousHome = process.env.LLXPRT_CONFIG_HOME;
  const previousResponses = process.env.LLXPRT_FAKE_RESPONSES;

  afterEach(async () => {
    for (const agent of agents.splice(0)) await agent.dispose();
    for (const root of roots.splice(0))
      await rm(root, { recursive: true, force: true });
    if (previousHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
    else process.env.LLXPRT_CONFIG_HOME = previousHome;
    if (previousResponses === undefined)
      delete process.env.LLXPRT_FAKE_RESPONSES;
    else process.env.LLXPRT_FAKE_RESPONSES = previousResponses;
  });

  async function build(root: string, id: string): Promise<Agent> {
    process.env.LLXPRT_CONFIG_HOME = root;
    process.env.LLXPRT_FAKE_RESPONSES = fixture;
    const agent = await createAgent({
      provider: 'fake',
      model: 'fake-model',
      workingDir: root,
      sessionId: id,
    });
    agents.push(agent);
    return agent;
  }

  it('replays a living session into UI history and continues on its sole recording', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-ui-owner-'));
    roots.push(root);
    const first = await build(root, 'first-owner');
    await first.session.setRecording({ enabled: true });
    for await (const _event of first.stream('replayed owner turn')) {
      // Consume the real Agent turn.
    }
    const source = first.session.getRecording().path;
    await first.session.setRecording({ enabled: false });

    const next = await build(root, 'second-owner');
    const replay = await resumeOwnerSession(next, 'first-owner', 'allowed');
    expect(
      replay.history.some((item) =>
        item.blocks.some(
          (block) =>
            block.type === 'text' && block.text.includes('replayed owner turn'),
        ),
      ),
    ).toBe(true);
    expect(
      replay.uiHistory.some(
        (item) => item.type === 'user' && item.text === 'replayed owner turn',
      ),
    ).toBe(true);
    expect(next.session.getRecording().path).toBe(source);
    for await (const _event of next.stream('continued owner turn')) {
      // Consume the real Agent turn.
    }
    await next.session.flushRecording();
    expect(next.session.getRecording().enabled).toBe(true);
    if (source === undefined) throw new Error('Recording was not materialized');
    expect(await readFile(source, 'utf8')).toContain('continued owner turn');
    await next.session.setRecording({ enabled: false });
    expect(
      (await readdir(dirname(source))).filter((file) => file.endsWith('.lock')),
    ).toStrictEqual([]);
  }, 30000);

  it('forks a checkpoint with replayable UI turns without retaining the source lock', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-ui-owner-'));
    roots.push(root);
    const agent = await build(root, 'fork-source');
    await agent.session.setRecording({ enabled: true });
    for await (const _event of agent.stream('before owner fork')) {
      // Consume the real Agent turn.
    }
    const checkpoint = await agent.session.createCheckpoint('fork-point');
    const source = agent.session.getRecording().path;
    const replay = await resumeOwnerSession(
      agent,
      checkpoint.checkpointId,
      'allowed',
    );
    expect(
      replay.uiHistory.some(
        (item) => item.type === 'user' && item.text === 'before owner fork',
      ),
    ).toBe(true);
    expect((await agent.session.listSessions()).length).toBe(2);
    if (source === undefined)
      throw new Error('Source recording was not materialized');
    expect(
      (await readdir(dirname(source))).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(1);
    await agent.session.setRecording({ enabled: false });
    expect(
      (await readdir(dirname(source))).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(0);
  }, 30000);

  it('keeps the active recording and history on a failed resume', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-ui-owner-'));
    roots.push(root);
    const agent = await build(root, 'current-owner');
    await agent.session.setRecording({ enabled: true });
    for await (const _event of agent.stream('retain failed resume session')) {
      // Consume the real Agent turn.
    }
    await expect(
      resumeOwnerSession(agent, 'absent-owner', 'allowed'),
    ).rejects.toThrow('Failed to resume session');
    await agent.session.recordRecordingEvent({
      type: 'session_event',
      severity: 'warning',
      message: 'still-running-after-failed-resume',
    });
    const path = agent.session.getRecording().path;
    if (path === undefined) throw new Error('Recording was not materialized');
    expect(await readFile(path, 'utf8')).toContain(
      'still-running-after-failed-resume',
    );
    await agent.session.setRecording({ enabled: false });
    expect(
      (await readdir(dirname(path))).filter((file) => file.endsWith('.lock')),
    ).toHaveLength(0);
  }, 30000);
});
