/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { streamPolicyOperations } from './__tests__/stream-policy-operations.js';
import React, { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  createMockSettings,
  renderHook,
  wrapWithProviders,
} from '../../../__tests__/render.js';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import { SessionStatsProvider } from '../../contexts/SessionContext.js';
import { useAgentStreamOrchestration } from './useAgentStreamOrchestration.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';
import { submissionOperations } from './__tests__/submission-operations.js';

function ownerInputs(owner: Agent, decoy: Agent) {
  const runtime = createStreamRuntimeForTest(
    {
      getTargetDir: () => owner.workspace.getWorkingDirectory(),
      getProjectTempDir: () => owner.workspace.getWorkingDirectory(),
    },
    {
      files: {
        directories: () => [...owner.workspace.getDirectories()],
        contains: (path) => owner.workspace.containsPath(path),
        ignore: owner.workspace,
      },
    },
  );
  return {
    ...streamPolicyOperations(runtime),
    readEmojiFilterMode: () => 'auto' as const,
    projectTempDir: runtime.projectTempDir,
    checkpointOperations: undefined,
    readTargetDir: () => owner.workspace.getWorkingDirectory(),
    readUsePty: () => runtime.shell.getShouldUseNodePtyShell(),
    readShellExecutionConfig: () => runtime.shell.getShellExecutionConfig(),
    readPtyWidth: () => runtime.shell.getPtyTerminalWidth(),
    readPtyHeight: () => runtime.shell.getPtyTerminalHeight(),
    ...{ agent: decoy },
    ...submissionOperations(owner),
    stream: owner.stream.bind(owner),
    setDisplayCallbacks: owner.tools.setDisplayCallbacks.bind(owner.tools),
    setEditorCallbacks: owner.tools.setEditorCallbacks.bind(owner.tools),
    openClientChannel: owner.tools.openClientChannel.bind(owner.tools),
    subscribeChildTools: owner.tools.subscribeChildTools.bind(owner.tools),
    appendShellHistory: owner.addHistory.bind(owner),
    injectSteer: owner.injectSteer.bind(owner),
    cancelRunningAsyncTasks: () => {
      for (const task of owner.tasks.listRunning()) {
        if (task.kind === 'subagent') void owner.tasks.cancel(task.id);
      }
    },
    runtime,
    settings: createMockSettings({}),
    addItem: () => 0,
    onDebugMessage: () => {},
    handleSlashCommand: async () => false as const,
    shellModeActive: false,
    getPreferredEditor: () => undefined,
    onAuthError: () => {},
    performMemoryRefresh: async () => {},
    onEditorClose: () => {},
    onEditorOpen: () => {},
    onCancelSubmit: () => {},
    setShellInputFocused: () => {},
  };
}

async function submitOwnedTurn(
  owner: Agent,
  decoy: Agent,
  query = 'captured orchestration turn',
  conflictingWorkspace = false,
): Promise<void> {
  const inputs = ownerInputs(owner, decoy);
  if (conflictingWorkspace)
    inputs.runtime = createStreamRuntimeForTest(
      {},
      {
        files: {
          directories: () => [...decoy.workspace.getDirectories()],
          contains: (path) => decoy.workspace.containsPath(path),
          ignore: decoy.workspace,
        },
      },
    );
  const wrapper = ({
    children,
  }: {
    children: React.ReactNode;
  }): React.ReactElement =>
    wrapWithProviders(
      <SessionStatsProvider metrics={owner.metrics}>
        {children}
      </SessionStatsProvider>,
    );
  const hook = renderHook(() => useAgentStreamOrchestration(inputs), {
    wrapper,
  });
  try {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    await act(async () => {
      await hook.result.current.submitQuery(query);
    });
  } finally {
    hook.unmount();
  }
}

describe('stream orchestration owner', () => {
  const makeOwner = useCommandOwners();
  it('prepares referenced files through captured workspace access rather than a conflicting runtime', async () => {
    const owner = await makeOwner('orchestration-workspace-owner');
    const sibling = await makeOwner('orchestration-workspace-sibling');
    const path = join(owner.workspace.getWorkingDirectory(), 'request.txt');
    await writeFile(path, 'owned orchestration workspace content');
    await submitOwnedTurn(owner, sibling, '@' + path, true);
    expect(JSON.stringify(await owner.getHistory())).toContain(
      'owned orchestration workspace content',
    );
    expect(await sibling.getHistory()).toHaveLength(0);
  });
  it('streams through captured operations and preserves a sibling after owner retirement', async () => {
    const owner = await makeOwner('orchestration-owner');
    const sibling = await makeOwner('orchestration-sibling');
    await submitOwnedTurn(owner, sibling);
    expect(JSON.stringify(await owner.getHistory())).toContain(
      'captured orchestration turn',
    );
    expect(await sibling.getHistory()).toHaveLength(0);
    await owner.dispose();
    await submitOwnedTurn(sibling, owner);
    expect(JSON.stringify(await sibling.getHistory())).toContain(
      'captured orchestration turn',
    );
  });
});
