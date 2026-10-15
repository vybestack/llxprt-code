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
import { renderHook } from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { useToolSchedulerSetup } from './useAgentStreamLifecycle.js';

async function scheduleRead(owner: Agent, decoy: Agent): Promise<string> {
  const file = join(owner.workspace.getWorkingDirectory(), 'entry.txt');
  await writeFile(file, 'captured lifecycle workspace');
  const openClientChannel = Object.assign(
    () => owner.tools.openClientChannel(),
    { tools: decoy.tools },
  );
  const subscribeChildTools = owner.tools.subscribeChildTools.bind(owner.tools);
  const setPendingHistoryItem = (): void => {};
  const getPreferredEditor = (): undefined => undefined;
  const onEditorClose = (): void => {};
  const onEditorOpen = (): void => {};
  const completed: unknown[] = [];
  const addItem = (item: unknown): number => completed.push(item);
  const hook = renderHook(() =>
    useToolSchedulerSetup(
      setPendingHistoryItem,
      getPreferredEditor,
      onEditorClose,
      onEditorOpen,
      addItem,
      openClientChannel,
      subscribeChildTools,
    ),
  );
  try {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    await act(async () => {
      await hook.result.current.toolSchedulerResult[1](
        {
          callId: 'lifecycle-read',
          name: 'read_file',
          args: { file_path: file },
          isClientInitiated: true,
          prompt_id: 'lifecycle-prompt',
        },
        new AbortController().signal,
      );
    });
    return JSON.stringify(completed);
  } finally {
    hook.unmount();
  }
}

describe('stream scheduler lifecycle owner', () => {
  const makeOwner = useCommandOwners();
  it('schedules in its captured workspace and keeps a sibling usable after retirement', async () => {
    const owner = await makeOwner('lifecycle-owner');
    const sibling = await makeOwner('lifecycle-sibling');
    const first = await scheduleRead(owner, sibling);
    expect(first).toContain('"status":"Success"');
    expect(first).not.toContain('"status":"Error"');
    await owner.dispose();
    expect(await scheduleRead(sibling, owner)).toContain('"status":"Success"');
  });
});
