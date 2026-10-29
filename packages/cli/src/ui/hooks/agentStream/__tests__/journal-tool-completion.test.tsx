/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ApprovalMode } from '@vybestack/llxprt-code-core';
import { act } from 'react';
import { captureSessionOwner } from '../../../../../../agents/src/api/__tests__/helpers/capture-session-owner.js';
import { buildAgent } from '../../../../../../agents/src/api/__tests__/helpers/agentHarness.js';
import { renderHook } from '../../../../__tests__/render.js';
import { createTurnStore } from '../../../stores/turn/turnStore.js';
import { readJournalItems } from '../../../stores/turn/journal-turn-test-helpers.js';
import { ToolCallStatus } from '../../../types.js';
import { useAgentEventStream } from '../useAgentEventStream.js';

describe('journal engine tool completion', () => {
  it('renders completed engine tools from the journal without writing a second UI tool group', async () => {
    const {
      value: { agent, cleanup },
      owner,
    } = await captureSessionOwner(() =>
      buildAgent('tool-call-then-answer.jsonl', {
        approvalMode: ApprovalMode.YOLO,
        workingDir: process.cwd(),
      }),
    );
    const turn = createTurnStore();
    turn.commands.bindJournal(() =>
      owner.clients.getAgentClient().getHistoryService(),
    );
    const rendered = renderHook(() =>
      useAgentEventStream({
        stream: agent.stream.bind(agent),
        setDisplayCallbacks: agent.tools.setDisplayCallbacks,
        setEditorCallbacks: agent.tools.setEditorCallbacks,
        addItem: turn.commands.addItem,
        processAgentEventRef: { current: null },
        flushPendingHistoryItem: () => {},
        clearPendingHistoryItem: () => {},
        performMemoryRefresh: async () => {},
      }),
    );
    try {
      await agent.session.setRecording({ enabled: true });
      await act(async () => {
        await rendered.result.current.runStream(
          'read the file',
          new AbortController().signal,
          'journal-tool',
        );
      });
      expect(turn.store.getState().displayError).toBeNull();
      const items = await readJournalItems(agent);
      const tools = items.flatMap((item) =>
        item.type === 'tool_group' ? item.tools : [],
      );
      expect(tools.map((tool) => tool.callId)).toStrictEqual(['call-tool-1']);
      expect(tools[0]?.status).toBe(ToolCallStatus.Success);
      expect(JSON.stringify(await agent.session.getHistory())).toContain(
        '@vybestack/llxprt-code',
      );
      expect(
        items.map((item) => ('text' in item ? item.text : '')).join(''),
      ).toContain('after the tool ran');
    } finally {
      rendered.unmount();
      await cleanup();
    }
  });
});
