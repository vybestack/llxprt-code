/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test for issue #1040: Tool calls being executed twice
 *
 * In the Agent facade architecture, tool-call deduplication (same callId
 * emitted twice) is owned by the Agent loop's scheduler, not the CLI. The
 * behavioral dedup coverage lives in the agents-package loop tests
 * (deduplicateToolCallRequests). This file retains only the CLI-layer display
 * merge test, which is a pure function and does not require hook rendering.
 */

import { describe, it, expect } from 'vitest';
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';

describe('useAgentStream duplicate tool call deduplication (issue #1040)', () => {
  it('should deduplicate all overlapping tools (shell and non-shell) from pending group', async () => {
    const { mergePendingToolGroupsForDisplay } = await import(
      './agentStream/index.js'
    );

    const sharedShellCallId = 'shared-shell-call';
    const sharedNonShellCallId = 'shared-non-shell-call';
    const schedulerOnlyCallId = 'scheduler-only-call';

    const pendingHistoryItem: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [
        {
          callId: sharedShellCallId,
          name: 'Shell Command',
          description: 'bash',
          status: ToolCallStatus.Executing,
          resultDisplay: 'pending shell output',
          confirmationDetails: undefined,
          ptyId: 12345,
        },
        {
          callId: sharedNonShellCallId,
          name: 'read_file',
          description: 'Read README.md',
          status: ToolCallStatus.Executing,
          resultDisplay: 'pending read output',
          confirmationDetails: undefined,
        },
      ],
    };

    const pendingToolCallGroupDisplay: HistoryItemWithoutId = {
      type: 'tool_group',
      agentId: 'primary',
      tools: [
        {
          callId: sharedShellCallId,
          name: 'Shell Command',
          description: 'bash',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler shell output',
          confirmationDetails: undefined,
          ptyId: 12345,
        },
        {
          callId: sharedNonShellCallId,
          name: 'read_file',
          description: 'Read README.md',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler read_file output',
          confirmationDetails: undefined,
        },
        {
          callId: schedulerOnlyCallId,
          name: 'search_file_content',
          description: 'Search for TODO',
          status: ToolCallStatus.Executing,
          resultDisplay: 'scheduler search output',
          confirmationDetails: undefined,
        },
      ],
    };

    const mergedItems = mergePendingToolGroupsForDisplay(
      pendingHistoryItem,
      pendingToolCallGroupDisplay,
    );
    const pendingToolGroups = mergedItems.filter(
      (item) => item.type === 'tool_group',
    );

    // All overlapping tools are removed from pending group; scheduler
    // version is authoritative for both shell and non-shell tools.
    const allTools = pendingToolGroups.flatMap((g) => g.tools);
    const shellInstances = allTools.filter(
      (t) => t.callId === sharedShellCallId,
    );
    const nonShellInstances = allTools.filter(
      (t) => t.callId === sharedNonShellCallId,
    );
    const schedulerOnlyInstances = allTools.filter(
      (t) => t.callId === schedulerOnlyCallId,
    );

    expect(shellInstances).toHaveLength(1);
    expect(nonShellInstances).toHaveLength(1);
    expect(schedulerOnlyInstances).toHaveLength(1);

    // Shell tools: pending-history copy wins (scheduler copy is removed).
    // Non-shell tools: scheduler copy wins (pending copy is removed).
    expect(shellInstances[0].resultDisplay).toBe('pending shell output');
    expect(nonShellInstances[0].resultDisplay).toBe(
      'scheduler read_file output',
    );
  });
});
