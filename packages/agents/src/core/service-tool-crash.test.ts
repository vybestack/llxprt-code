/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { SessionLockManager } from '@vybestack/llxprt-code-core/recording/SessionLockManager.js';
import { serviceToolChild } from './__tests__/support/service-tool-child.js';
import {
  diskToolState,
  recordingConfig,
  type DriverEvent,
} from './__tests__/support/service-tool-recorders.js';
import {
  toolId,
  toolResult,
} from './__tests__/support/service-tool-runtime.js';
import { proveToolResume } from './__tests__/support/service-tool-resume.js';

function numbers(event: DriverEvent, key: string): number[] {
  return z.array(z.number()).length(1).parse(event.details[key]);
}

type Rig = Awaited<ReturnType<typeof serviceToolChild>>;
type Disk = Awaited<ReturnType<typeof diskToolState>>;
async function crash(
  rig: Rig,
  files: string[],
  committed: Disk[],
): Promise<void> {
  const lockBefore = await readFile(
    SessionLockManager.getLockPath(
      recordingConfig(rig.directory, 'primary').chatsDir,
      'primary',
    ),
    'utf8',
  );
  expect(z.object({ pid: z.number() }).parse(JSON.parse(lockBefore)).pid).toBe(
    rig.child.pid,
  );
  rig.child.kill('SIGKILL');
  await rig.child.exited;
  expect(rig.child.signalCode).toBe('SIGKILL');
  for (let file = 0; file < files.length; file++)
    expect(await diskToolState(files[file])).toStrictEqual(committed[file]);
  await proveToolResume(rig.directory, 'primary', committed[0].rows);
}
async function clean(
  rig: Rig,
  files: string[],
  committed: Disk[],
): Promise<void> {
  rig.send('respond');
  await rig.wait('closed');
  expect(await rig.child.exited).toBe(0);
  for (const name of ['primary'])
    expect(
      await SessionLockManager.isLocked(
        recordingConfig(rig.directory, name).chatsDir,
        name,
      ),
    ).toBe(false);
  for (const file of files) {
    const closed = await diskToolState(file);
    expect(
      closed.rows.filter((row) => row.content.speaker === 'tool'),
    ).toHaveLength(1);
    expect(closed.rows[2]).toStrictEqual(committed[0].rows[2]);
  }
}
const finish = { crash, clean };
async function scenario(mode: 'crash' | 'clean'): Promise<unknown> {
  const role = 'primary';
  const rig = await serviceToolChild(role, mode);
  try {
    const ready = await rig.wait('ready');
    const files = z.array(z.string()).length(1).parse(ready.details.files);
    const baseline = await Promise.all(files.map(diskToolState));
    expect(baseline.map((state) => state.rows.length)).toStrictEqual([2]);
    expect(baseline[0].rows[1].owner).toBe(
      z.string().parse(ready.details.owner),
    );
    rig.send('next');
    const held = await rig.wait('held');
    expect(held.details.entries).toBe(1);
    expect(held.details.nextStarted).toBe(true);
    const index = 0;
    expect(numbers(held, 'seqs')[index]).toBe(numbers(ready, 'seqs')[index]);
    expect(numbers(held, 'flushes')[index]).toBe(
      numbers(ready, 'flushes')[index] + 1,
    );
    rig.send('probe');
    const probe = await rig.wait('probe');
    expect(probe.details.entries).toBe(1);
    const beforeRelease = await diskToolState(files[index]);
    expect(beforeRelease.rows).toStrictEqual(baseline[index].rows);
    rig.send('release');
    const entry = await rig.wait('transport-entry');
    expect(numbers(entry, 'seqs')).toStrictEqual(
      numbers(ready, 'seqs').map((seq) => seq + 4),
    );
    expect(numbers(entry, 'flushes')).toStrictEqual(
      numbers(ready, 'flushes').map((count) => count + 7),
    );
    const request = await rig.wait('transport-request');
    const committed = await Promise.all(files.map(diskToolState));
    for (let file = 0; file < committed.length; file++) {
      expect(committed[file].rows.slice(0, 2)).toStrictEqual(
        baseline[file].rows,
      );
      expect(committed[file].rows).toHaveLength(3);
      expect(committed[file].rows[2]).toMatchObject({
        owner: null,
        content: {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: toolId,
              toolName: 'lookup',
              result: toolResult,
            },
          ],
        },
      });
    }
    await finish[mode](rig, files, committed);
    await writeFile(
      join(rig.directory, 'proof.json'),
      JSON.stringify(
        {
          role,
          mode,
          pid: rig.child.pid,
          ready,
          held,
          probe,
          entry,
          request,
        },
        null,
        2,
      ),
    );
    return request.details.request;
  } finally {
    await rig.close();
  }
}
describe('ChatSession native tool-round durability at the next provider request', () => {
  const modes: ReadonlyArray<'crash' | 'clean'> = ['crash', 'clean'];
  for (const mode of modes) {
    it(`primary trailer blocks the next request before ${mode}`, async () => {
      expect(await scenario(mode)).toMatchObject({
        calls: 1,
        results: 1,
        ids: [toolId, toolId],
        result: toolResult,
      });
    }, 60000);
  }
});
