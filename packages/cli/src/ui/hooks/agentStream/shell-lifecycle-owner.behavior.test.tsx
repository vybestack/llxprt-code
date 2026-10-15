/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';
import { useShellCommandSetup } from './useAgentStreamLifecycle.js';

async function runShell(
  owner: Agent,
  decoy: Agent,
  query: string,
  runtimeOwner: Agent = owner,
): Promise<void> {
  let complete = (): void => {};
  const written = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const runtime = createStreamRuntimeForTest({
    getTargetDir: () => runtimeOwner.workspace.getWorkingDirectory(),
    getShouldUseNodePtyShell: () => false,
    getEnableInteractiveShell: () => false,
    getShellReplacement: () => 'none',
  });
  const hook = renderHook(() =>
    useShellCommandSetup({
      ...{
        agent: {
          addHistory: async (entry: Parameters<Agent['addHistory']>[0]) => {
            await decoy.addHistory(entry);
            complete();
          },
        },
      },
      ...{ runtime },
      readTargetDir: () => owner.workspace.getWorkingDirectory(),
      readUsePty: () => false,
      readShellExecutionConfig: () => ({}),
      readPtyWidth: () => undefined,
      readPtyHeight: () => undefined,
      appendShellHistory: async (entry) => {
        await owner.addHistory(entry);
        complete();
      },
      addItem: () => 0,
      setPendingHistoryItem: () => {},
      setIsResponding: () => {},
      onDebugMessage: () => {},
      setShellInputFocused: () => {},
      pendingHistoryItemRef: { current: null },
    }),
  );
  try {
    await act(async () => {
      hook.result.current.handleShellCommand(
        query,
        new AbortController().signal,
      );
      await written;
    });
  } finally {
    hook.unmount();
  }
}

describe('shell lifecycle session owner', () => {
  const makeOwner = useCommandOwners();
  it('appends real shell output only to the captured session and preserves its sibling', async () => {
    const owner = await makeOwner('shell-lifecycle-owner');
    const sibling = await makeOwner('shell-lifecycle-sibling');
    await runShell(owner, sibling, 'node -p "6 * 7"');
    expect(JSON.stringify(await owner.getHistory())).toContain('42');
    expect(await sibling.getHistory()).toHaveLength(0);
    await owner.dispose();
    await runShell(sibling, owner, 'node -p "7 * 8"');
    expect(JSON.stringify(await sibling.getHistory())).toContain('56');
  });
  it('executes in the captured working directory instead of a conflicting runtime', async () => {
    const owner = await makeOwner('shell-directory-owner');
    const sibling = await makeOwner('shell-directory-sibling');
    await runShell(owner, sibling, 'node -p "process.cwd()"', sibling);
    const history = JSON.stringify(await owner.getHistory());
    expect(history).toContain(owner.workspace.getWorkingDirectory());
    expect(history).not.toContain(sibling.workspace.getWorkingDirectory());
  });
});
