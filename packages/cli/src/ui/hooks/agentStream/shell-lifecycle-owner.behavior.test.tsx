/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { realpathSync } from 'node:fs';
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

const RESULT_FENCE =
  /This produced the following result:\n```\n([\s\S]*?)\n```/;

// The shell reports its working directory in whatever spelling the platform
// gives it (Windows temp paths come back as either the 8.3 short form or the
// long form), so the printed text is extracted and compared by real path.
async function printedWorkingDirectory(owner: Agent): Promise<string> {
  const history = await owner.getHistory();
  const texts = history.flatMap((entry) =>
    entry.blocks.flatMap((block) =>
      block.type === 'text' ? [block.text] : [],
    ),
  );
  const printed = texts
    .map((text) => RESULT_FENCE.exec(text)?.[1])
    .find((output) => output !== undefined);
  if (printed === undefined) {
    throw new Error(`No shell result in history: ${JSON.stringify(texts)}`);
  }
  // The shell may print warnings before the command's own output.
  const lines = printed.trim().split('\n');
  return lines[lines.length - 1].trim();
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
    const printed = realpathSync.native(await printedWorkingDirectory(owner));
    expect(printed).toBe(
      realpathSync.native(owner.workspace.getWorkingDirectory()),
    );
    expect(printed).not.toBe(
      realpathSync.native(sibling.workspace.getWorkingDirectory()),
    );
  });
});
