/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Engine-owned task-continuation integration tests (issue #2657).
 *
 * These tests prove the engine — not a CLI React layer — owns the decision
 * to continue or stop the agent loop. They drive the PUBLIC `agent.stream()`
 * API over a real FakeProvider and assert behavioral effects observable to
 * ALL consumers (CLI, ACP/Zed, a2a).
 *
 * Behaviors tested:
 * 1. A successful pause-tool call stops the loop (no extra model turn).
 *    This proves AgenticLoop.buildNextMessage() is the authoritative pause
 *    handler — the engine does NOT need a CLI React pause gate.
 * 2. A failed pause-tool call does NOT stop the loop — the model
 *    continues with another turn. This proves only SUCCESSFUL pauses
 *    terminate the loop.
 * 3. A normal (non-pause) tool call continues the loop (regression guard).
 *
 * The test approach follows dev-docs/RULES.md: real agent.stream() over a
 * real FakeProvider via the LLXPRT_FAKE_RESPONSES production seam. The only
 * mock boundary is the LLM provider (scripted JSONL fixtures).
 */

import { describe, it, expect } from 'vitest';
import {
  buildAgentFromContent,
  drain,
  isToolCallEvent,
  isToolResultEvent,
  isTextEvent,
  isErrorEvent,
  countType,
} from './helpers/agentHarness.js';
import { ApprovalMode } from '@vybestack/llxprt-code-agents';
import type { AgentEvent } from '@vybestack/llxprt-code-agents';

/**
 * Builds a single-turn JSONL fixture: one tool_call block for the given tool
 * and params. Shared by scriptToolCallThenText and scriptToolCallOnly to
 * prevent schema drift if the event format evolves.
 */
function buildToolCallTurn(
  toolName: string,
  parameters: Readonly<Record<string, unknown>>,
): object {
  return {
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call-1',
            name: toolName,
            parameters,
          },
        ],
      },
    ],
  };
}

/**
 * Builds a two-turn JSONL fixture: turn 1 emits a tool_call for the given
 * tool with the given params; turn 2 emits a terminal text block so the
 * continuation settles with a `done`.
 */
function scriptToolCallThenText(
  toolName: string,
  parameters: Readonly<Record<string, unknown>>,
  continuationText = 'done after tool',
): string {
  const turn1 = buildToolCallTurn(toolName, parameters);
  const turn2 = {
    chunks: [
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: continuationText }],
      },
    ],
  };
  return `${JSON.stringify(turn1)}\n${JSON.stringify(turn2)}\n`;
}

/**
 * Builds a single-turn fixture that emits ONLY a tool_call (no continuation
 * turn). If the engine continues after the tool, the FakeProvider has no
 * more scripted responses and the stream will end. This is used to test
 * pause-stop behavior: the loop MUST stop after a successful pause.
 */
function scriptToolCallOnly(
  toolName: string,
  parameters: Readonly<Record<string, unknown>>,
): string {
  const turn1 = buildToolCallTurn(toolName, parameters);
  return `${JSON.stringify(turn1)}\n`;
}

describe('Engine task continuation and pause (issue #2657)', () => {
  /**
   * Shared assertion: a successful pause must stop the loop with no
   * continuation text and no error events. Used by both the pause-stop
   * test and the CLI/ACP parity test to avoid duplicated assertions.
   */
  function assertPauseStopsLoop(events: AgentEvent[]): void {
    expect(events.filter(isToolCallEvent).length).toBeGreaterThanOrEqual(1);
    expect(events.filter(isToolResultEvent).length).toBeGreaterThanOrEqual(1);
    expect(countType(events, 'done')).toBe(1);
    expect(events.filter(isTextEvent)).toHaveLength(0);
    expect(events.filter(isErrorEvent)).toHaveLength(0);
  }

  it('stops the loop after a successful pause tool call — no CLI React gate needed', async () => {
    // The engine must own pause detection. A successful pause must
    // terminate the loop without requiring a CLI React pause gate.
    const fixture = scriptToolCallOnly('todo_pause', { reason: 'blocked' });
    const { agent, cleanup } = await buildAgentFromContent(fixture, {
      approvalMode: ApprovalMode.YOLO,
    });
    try {
      const events: AgentEvent[] = await drain(agent.stream('pause please'));

      expect(events.filter(isToolCallEvent)[0].call.name).toBe('todo_pause');
      assertPauseStopsLoop(events);
    } finally {
      await cleanup();
    }
  });

  it('does NOT stop the loop when the pause tool fails (error response)', async () => {
    // The pause tool with an empty reason should fail validation.
    // The engine must NOT treat a failed pause as a terminal signal — the
    // model should get the error and continue.
    const fixture = scriptToolCallThenText(
      'todo_pause',
      { reason: '' },
      'continued after failed pause',
    );
    const { agent, cleanup } = await buildAgentFromContent(fixture, {
      approvalMode: ApprovalMode.YOLO,
    });
    try {
      const events: AgentEvent[] = await drain(agent.stream('try pause'));

      const callEvents = events.filter(isToolCallEvent);
      expect(callEvents.length).toBeGreaterThanOrEqual(1);
      expect(callEvents[0].call.name).toBe('todo_pause');

      // The loop continued — a text event from the second turn appears.
      const textEvents = events.filter(isTextEvent);
      expect(textEvents.length).toBeGreaterThanOrEqual(1);

      // The loop terminated normally.
      expect(countType(events, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('continues the loop normally for non-pause tools (regression guard)', async () => {
    // A normal read_file tool call should continue the loop — the model
    // gets the tool response and produces a second turn.
    const fixture = scriptToolCallThenText(
      'read_file',
      { file_path: '{{CWD}}/package.json' },
      'read the file and continued',
    );
    const { agent, cleanup } = await buildAgentFromContent(fixture, {
      approvalMode: ApprovalMode.YOLO,
    });
    try {
      const events: AgentEvent[] = await drain(agent.stream('read the file'));

      const callEvents = events.filter(isToolCallEvent);
      expect(callEvents.length).toBeGreaterThanOrEqual(1);
      expect(callEvents[0].call.name).toBe('read_file');

      // The loop continued — text from the second turn.
      const textEvents = events.filter(isTextEvent);
      expect(textEvents.length).toBeGreaterThanOrEqual(1);

      expect(countType(events, 'done')).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('engine pause behavior is identical for all consumers (CLI/ACP parity)', async () => {
    // This test documents the parity guarantee: the engine handles pause
    // identically regardless of which consumer drives it. There is no
    // CLI-specific compensating layer. The same agent.stream() path is
    // used by CLI, ACP/Zed, and a2a.
    const fixture = scriptToolCallOnly('todo_pause', {
      reason: 'parity check',
    });
    const { agent, cleanup } = await buildAgentFromContent(fixture, {
      approvalMode: ApprovalMode.YOLO,
    });
    try {
      const events: AgentEvent[] = await drain(agent.stream('verify parity'));

      expect(events.length).toBeGreaterThan(0);
      assertPauseStopsLoop(events);
    } finally {
      await cleanup();
    }
  });
});
