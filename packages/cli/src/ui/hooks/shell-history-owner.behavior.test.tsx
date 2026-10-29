import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { shellExecutionReads } from './__tests__/shell-execution-reads.js';
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';

async function runShell(
  owner: Agent,
  decoy: Agent,
  query: string,
): Promise<void> {
  let execution: Promise<void> | undefined;
  let settled: () => void = () => {};
  const written = new Promise<void>((resolve) => {
    settled = resolve;
  });
  const appendHistory = Object.assign(
    async (entry: Parameters<Agent['addHistory']>[0]) => {
      await owner.addHistory(entry);
      settled();
    },
    {
      addHistory: async (entry: Parameters<Agent['addHistory']>[0]) => {
        await decoy.addHistory(entry);
        settled();
      },
    },
  );
  const hook = renderHook(() =>
    useShellCommandProcessor(
      () => 0,
      () => {},
      (pending) => {
        execution = pending;
      },
      () => {},
      ...shellExecutionReads({
        getTargetDir: () => owner.workspace.getWorkingDirectory(),
        getShouldUseNodePtyShell: () => false,
        getPtyTerminalWidth: () => undefined,
        getPtyTerminalHeight: () => undefined,
        getShellExecutionConfig: () => ({}),
        getEnableInteractiveShell: () => false,
        setPtyTerminalSize: () => {},
        getTerminalBackground: () => undefined,
        getShellReplacement: () => 'none',
        getSessionId: () => 'shell-session',
        adoptSessionId: () => {},
        getProjectRoot: () => owner.workspace.getWorkingDirectory(),
        getWorkingDir: () => owner.workspace.getWorkingDirectory(),
        getProjectTempDir: () => owner.workspace.getWorkingDirectory(),
        getSessionRecordingQueueByteLimit: () => 1024,
        getLlxprtDir: () => owner.workspace.getWorkingDirectory(),
      }),
      appendHistory,
      () => {},
    ),
  );
  try {
    await act(async () => {
      hook.result.current.handleShellCommand(
        query,
        new AbortController().signal,
      );
      if (!execution) throw new Error('Shell execution was not started');
      await execution;
      await written;
    });
  } finally {
    hook.unmount();
  }
}

describe('shell history owner', () => {
  const makeOwner = useCommandOwners();
  it('records shell results in its captured session and leaves a sibling usable', async () => {
    const owner = await makeOwner('shell-owner');
    const sibling = await makeOwner('shell-sibling');
    await runShell(owner, sibling, 'node -p "6 * 7"');
    const ownerHistory = JSON.stringify(
      await collectResumeRows(owner.streamHistory()),
    );
    expect(ownerHistory).toContain('42');
    expect(await collectResumeRows(sibling.streamHistory())).toHaveLength(0);
    await owner.dispose();
    await runShell(sibling, owner, 'node -p "7 * 8"');
    expect(
      JSON.stringify(await collectResumeRows(sibling.streamHistory())),
    ).toContain('56');
  });
});
