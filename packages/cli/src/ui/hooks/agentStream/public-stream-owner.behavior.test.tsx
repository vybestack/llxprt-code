/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { useCommandOwners } from '../../../__tests__/command-owner-fixture.js';
import {
  createMockSettings,
  renderHook,
  wrapWithProviders,
} from '../../../__tests__/render.js';
import { SessionStatsProvider } from '../../contexts/SessionContext.js';
import { createStreamRuntimeForTest } from './__tests__/streamRuntimeTestHelper.js';
import { streamPolicyOperations } from './__tests__/stream-policy-operations.js';
import { submissionOperations } from './__tests__/submission-operations.js';
import { useAgentStream } from './useAgentStream.js';

async function submit(owner: Agent, decoy: Agent): Promise<void> {
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
  const path = join(owner.workspace.getWorkingDirectory(), 'request.txt');
  await writeFile(path, 'public captured conversation');
  const inputs = Object.assign(() => owner.stream, {
    ...streamPolicyOperations(runtime),
    ...submissionOperations(owner),
    stream: owner.stream.bind(owner),
    setDisplayCallbacks: owner.tools.setDisplayCallbacks.bind(owner.tools),
    setEditorCallbacks: owner.tools.setEditorCallbacks.bind(owner.tools),
    openClientChannel: owner.tools.openClientChannel.bind(owner.tools),
    subscribeChildTools: owner.tools.subscribeChildTools.bind(owner.tools),
    appendShellHistory: owner.addHistory.bind(owner),
    injectSteer: owner.injectSteer.bind(owner),
    cancelRunningAsyncTasks: () => {},
    readEmojiFilterMode: () => 'auto' as const,
    projectTempDir: runtime.projectTempDir,
    checkpointOperations: undefined,
    readTargetDir: () => owner.workspace.getWorkingDirectory(),
    readUsePty: () => runtime.shell.getShouldUseNodePtyShell(),
    readShellExecutionConfig: () => runtime.shell.getShellExecutionConfig(),
    readPtyWidth: () => runtime.shell.getPtyTerminalWidth(),
    readPtyHeight: () => runtime.shell.getPtyTerminalHeight(),
    readHistory: owner.getHistory.bind(owner),
    isCheckpointingEnabled: () => false,
    projectCheckpointsDir: runtime.projectCheckpointsDir,
    history: [],
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
    tools: decoy.tools,
    mcp: decoy.mcp,
    metrics: decoy.metrics,
    tasks: decoy.tasks,
    session: decoy.session,
    addHistory: decoy.addHistory.bind(decoy),
    getHistory: decoy.getHistory.bind(decoy),
    getProviderContextLimit: owner.getProviderContextLimit.bind(owner),
  });
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
  const hook = renderHook(() => useAgentStream(inputs), { wrapper });
  try {
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    await act(async () => {
      await hook.result.current.submitQuery('@' + path);
    });
  } finally {
    hook.unmount();
  }
}

describe('public stream operation owner', () => {
  const makeOwner = useCommandOwners();
  it('streams through captured operations and leaves the retired owner untouched when a sibling runs', async () => {
    const owner = await makeOwner('public-stream-owner');
    const sibling = await makeOwner('public-stream-sibling');
    await submit(owner, sibling);
    expect(JSON.stringify(await owner.getHistory())).toContain(
      'public captured conversation',
    );
    expect(await sibling.getHistory()).toStrictEqual([]);
    await owner.dispose();
    await submit(sibling, owner);
    expect(JSON.stringify(await sibling.getHistory())).toContain(
      'public captured conversation',
    );
  });
});
