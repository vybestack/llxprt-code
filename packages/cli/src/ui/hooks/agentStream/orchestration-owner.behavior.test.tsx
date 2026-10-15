/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
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
  return {
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
    runtime: createStreamRuntimeForTest({
      getTargetDir: () => owner.workspace.getWorkingDirectory(),
      getProjectTempDir: () => owner.workspace.getWorkingDirectory(),
    }),
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

async function submitOwnedTurn(owner: Agent, decoy: Agent): Promise<void> {
  const inputs = ownerInputs(owner, decoy);
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
      await hook.result.current.submitQuery('captured orchestration turn');
    });
  } finally {
    hook.unmount();
  }
}

describe('stream orchestration owner', () => {
  const makeOwner = useCommandOwners();
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
