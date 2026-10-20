/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { IContent } from '@vybestack/llxprt-code-core';
import { send, type WholeProductFixture } from './whole-product-fixture.js';
import {
  activePath,
  nativeRows,
  verifyCheckpoint,
  verifyFacts,
  verifyFork,
  verifyReleased,
  recordingArtifacts,
} from './whole-product-observer.js';

export interface LifecycleBranch {
  readonly source: string;
  readonly fork: string;
  readonly forkRows: readonly IContent[];
}

export async function sendAndCheckpoint(
  fixture: WholeProductFixture,
): Promise<{ path: string; rows: readonly IContent[] }> {
  const agent = fixture.live;
  await agent.session.setRecording({ enabled: true });
  expect(agent.session.getRecording().enabled).toBe(true);
  await send(agent, 'Remember the lifecycle receipt.');
  const path = await activePath(agent);
  await verifyFacts(path, agent.session.getSessionId());
  expect(await nativeRows(path)).toHaveLength(2);
  const events = await send(
    agent,
    'Write the lifecycle receipt to receipt.txt.',
  );
  const calls = events.filter((event) => event.type === 'tool-call');
  const results = events.filter((event) => event.type === 'tool-result');
  for (const event of results) {
    if (event.result.isError === true)
      throw new Error(JSON.stringify(event.result));
  }
  expect(calls.map((event) => event.call.name)).toStrictEqual(['write_file']);
  expect(
    results.map((event) => ({
      id: event.result.id,
      name: event.result.name,
      failed: event.result.isError === true,
    })),
  ).toStrictEqual(
    calls.map((event) => ({
      id: event.call.id,
      name: event.call.name,
      failed: false,
    })),
  );
  expect(await readFile(join(fixture.root, 'receipt.txt'), 'utf8')).toBe(
    'durable tool receipt\n',
  );
  const rows = await nativeRows(await activePath(agent));
  expect(rows.map((row) => row.speaker)).toStrictEqual([
    'human',
    'ai',
    'human',
    'ai',
    'tool',
    'ai',
  ]);
  const toolResults = rows.flatMap((row) =>
    row.blocks.filter((block) => block.type === 'tool_response'),
  );
  expect(toolResults).toHaveLength(1);
  await fixture.command('/chat save w24-cut');
  await verifyCheckpoint(path);
  await recordingArtifacts(path);
  return { path, rows };
}

export async function forkAndSwitch(
  fixture: WholeProductFixture,
  checkpoint: { path: string; rows: readonly IContent[] },
): Promise<LifecycleBranch> {
  const agent = fixture.live;
  await send(
    agent,
    'This source-only suffix must remain outside the checkpoint.',
  );
  const sourceRows = await nativeRows(await activePath(agent));
  expect(sourceRows).toHaveLength(checkpoint.rows.length + 2);
  await fixture.command('/chat resume w24-cut');
  const fork = await activePath(agent);
  expect(fork).not.toBe(checkpoint.path);
  await verifyFork(fork);
  await verifyFacts(fork, agent.session.getSessionId());
  expect(await nativeRows(fork)).toStrictEqual(checkpoint.rows);
  expect(fixture.displayed().map((item) => item.type)).toStrictEqual([
    'user',
    'gemini',
    'user',
    'tool_group',
    'gemini',
  ]);
  await verifyReleased([checkpoint.path]);
  await send(agent, 'This child-only turn must not mutate the parent.');
  const forkRows = await nativeRows(await activePath(agent));
  expect(forkRows).toHaveLength(checkpoint.rows.length + 2);
  expect(await nativeRows(checkpoint.path)).toStrictEqual(sourceRows);
  await fixture.command('/continue w24-source');
  expect(await activePath(agent)).toBe(checkpoint.path);
  expect(agent.session.getSessionId()).toBe('w24-source');
  expect(await nativeRows(checkpoint.path)).toStrictEqual(sourceRows);
  expect(await nativeRows(fork)).toStrictEqual(forkRows);
  await verifyReleased([fork]);
  return { source: checkpoint.path, fork, forkRows };
}

export async function compressAndPackage(
  fixture: WholeProductFixture,
  branch: LifecycleBranch,
): Promise<{ path: string; id: string; rows: readonly IContent[] }> {
  const agent = fixture.live;
  const before = await nativeRows(branch.source);
  agent.setEphemeralSetting('compression.strategy', 'one-shot');
  const result = await agent.compress({ promptId: 'w24-compression' });
  expect(result.status).toBe('compressed');
  expect(await activePath(agent)).toBe(branch.source);
  const rows = await nativeRows(branch.source);
  expect(rows.length).toBeLessThan(before.length);
  expect(rows.some((row) => row.metadata?.isSummary === true)).toBe(true);
  expect(
    rows.some((row) => row.metadata?.reason === 'compression-continuation'),
  ).toBe(true);
  expect(
    rows.some((row) =>
      row.blocks.some(
        (block) =>
          block.type === 'text' &&
          block.text === 'Remember the lifecycle receipt.',
      ),
    ),
  ).toBe(false);
  await verifyCheckpoint(branch.source);
  expect(await nativeRows(branch.fork)).toStrictEqual(branch.forkRows);
  const destination = join(fixture.root, 'portable-package');
  await fixture.command(`/continue export w24-source ${destination}`);
  await agent.session.importSession(destination);
  const path = await activePath(agent);
  const id = agent.session.getSessionId();
  expect(id).not.toBe('w24-source');
  expect(path).not.toBe(branch.source);
  expect(await nativeRows(path)).toStrictEqual(rows);
  expect(await nativeRows(branch.source)).toStrictEqual(rows);
  await verifyFacts(path, id);
  await verifyReleased([branch.source, branch.fork]);
  await recordingArtifacts(path);
  return { path, id, rows };
}

export async function reopen(
  fixture: WholeProductFixture,
  imported: { path: string; id: string; rows: readonly IContent[] },
): Promise<void> {
  await fixture.live.dispose();
  await verifyReleased([imported.path]);
  const agent: Agent = await fixture.agent('w24-reopen');
  const listing = await agent.session.listSessions();
  expect(listing.map((entry) => entry.id)).toContain(imported.id);
  const history = await agent.session.resume(imported.id);
  let replayed = 0;
  for await (const row of history) {
    expect(row).toStrictEqual(imported.rows[replayed]);
    replayed++;
  }
  expect(replayed).toBe(imported.rows.length);
  expect(await activePath(agent)).toBe(imported.path);
  await verifyCheckpoint(imported.path);
  await send(agent, 'Continue after cold reopen.');
  expect(await nativeRows(await activePath(agent))).toHaveLength(
    imported.rows.length + 2,
  );
  await agent.dispose();
  await verifyReleased([imported.path]);
  await recordingArtifacts(imported.path);
}
