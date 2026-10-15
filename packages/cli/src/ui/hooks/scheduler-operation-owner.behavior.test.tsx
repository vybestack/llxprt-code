/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import {
  useScheduler,
  type SchedulerRefs,
} from '../../runtime/interactiveToolScheduler.js';

async function readThroughScheduler(
  owner: Agent,
  decoy: Agent,
): Promise<CompletedToolCall[]> {
  const path = join(owner.workspace.getWorkingDirectory(), 'entry.txt');
  await writeFile(path, 'owned file data');
  const completed: CompletedToolCall[] = [];
  const refs: SchedulerRefs = {
    updateToolCallOutput: () => {},
    replaceToolCallsForScheduler: () => {},
    onCompleteRef: {
      current: (_id, calls) => {
        completed.push(...calls);
      },
    },
    getPreferredEditorRef: { current: () => undefined },
    onEditorOpenRef: { current: () => {} },
    onEditorCloseRef: { current: () => {} },
    setLastToolOutputTime: () => {},
  };
  const openClientChannel = Object.assign(
    () => owner.tools.openClientChannel(),
    { tools: decoy.tools },
  );
  const id = Symbol('owner-channel');
  const pending = { current: [] };
  const hook = renderHook(() =>
    useScheduler(openClientChannel, id, refs, pending),
  );
  try {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    const scheduler = hook.result.current;
    if (scheduler === null)
      throw new Error('Client scheduler did not become ready');
    await act(async () => {
      await scheduler.schedule(
        {
          callId: 'owner-read',
          name: 'read_file',
          args: { file_path: path },
          isClientInitiated: true,
          prompt_id: 'owner-prompt',
        },
        new AbortController().signal,
      );
    });
    return completed;
  } finally {
    hook.unmount();
  }
}

describe('bound client scheduling operation', () => {
  const makeOwner = useCommandOwners();
  it('uses its captured tool workspace and preserves a sibling after retirement', async () => {
    const owner = await makeOwner('scheduler-owner');
    const sibling = await makeOwner('scheduler-sibling');
    const first = await readThroughScheduler(owner, sibling);
    expect(first.map((call) => call.status)).toStrictEqual(['success']);
    expect(JSON.stringify(first)).toContain('owned file data');
    await owner.dispose();
    const second = await readThroughScheduler(sibling, owner);
    expect(second.map((call) => call.status)).toStrictEqual(['success']);
  });
});
