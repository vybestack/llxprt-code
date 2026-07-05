/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral RED suite for post-construction display-callbacks registration
 * (issue #2372 Phase A, change (3)).
 *
 * Covers:
 *  (b) setDisplayCallbacks registered AFTER agent construction receives tool
 *      updates/output/completion during a subsequent agent.stream() turn.
 *  (c) registration survives a loop rebuild (after setModel/setProvider).
 *  (d) interactiveMode threading (loop scheduler receives interactiveMode true
 *      when config.isInteractive() is true) — exercised at the full-agent level.
 *
 * The agent is built over a REAL FakeProvider (LLXPRT_FAKE_RESPONSES seam) so
 * these are genuine behavioral assertions (events emitted, callbacks invoked
 * with real data), not mock-call-count assertions.
 */

import { describe, it, expect } from 'vitest';
import type { ToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  buildAgent,
  buildAgentFromContent,
  drain,
  countType,
  isToolCallEvent,
  isToolResultEvent,
  isTextEvent,
  respondToFirstConfirmation,
  ToolConfirmationOutcome,
  type AgentEvent,
} from './helpers/agentHarness.js';

describe('post-construction display callbacks (issue #2372 Phase A change 3)', () => {
  it('setDisplayCallbacks registered AFTER construction receives tool updates + completion during a subsequent turn', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const toolUpdates: ToolCall[][] = [];
        const completions: number[] = [];

        agent.tools.setDisplayCallbacks({
          onToolCallsUpdate: (toolCalls) => {
            toolUpdates.push(toolCalls);
          },
          onAllToolCallsComplete: (completed) => {
            completions.push(completed.length);
          },
        });

        const events: AgentEvent[] = await drain(agent.stream('go'));

        expect(countType(events, 'done')).toBe(1);
        expect(events.some(isToolCallEvent)).toBe(true);
        expect(events.some(isToolResultEvent)).toBe(true);

        expect(toolUpdates.length).toBeGreaterThanOrEqual(1);
        const flattenedUpdates = toolUpdates.flat();
        expect(flattenedUpdates.length).toBeGreaterThan(0);

        expect(completions.length).toBeGreaterThanOrEqual(1);
        expect(completions[0]).toBeGreaterThanOrEqual(1);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  it('display callbacks registered after construction survive a loop rebuild (after setModel)', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      const completions: number[] = [];

      agent.tools.setDisplayCallbacks({
        onAllToolCallsComplete: (completed) => {
          completions.push(completed.length);
        },
      });

      await agent.setModel('gpt-4o-mini');

      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events: AgentEvent[] = await drain(
          agent.stream('rebuild then go'),
        );

        expect(countType(events, 'done')).toBe(1);
        expect(events.some(isToolResultEvent)).toBe(true);

        expect(completions.length).toBeGreaterThanOrEqual(1);
        expect(completions[0]).toBeGreaterThanOrEqual(1);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  it('completes a full turn with tool call + text when config.isInteractive()=true (interactiveMode threading into the loop is asserted in rebuild-loop.spec.ts)', async () => {
    const jsonl =
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call-int-mode',
                name: 'read_file',
                parameters: { path: '{{CWD}}/package.json' },
              },
            ],
          },
        ],
      }) +
      '\n' +
      JSON.stringify({
        chunks: [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'interactive ok' }],
          },
        ],
      }) +
      '\n';

    const { agent, cleanup } = await buildAgentFromContent(jsonl);
    try {
      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events: AgentEvent[] = await drain(
          agent.stream('interactive turn'),
        );
        expect(countType(events, 'done')).toBe(1);
        expect(events.some(isToolResultEvent)).toBe(true);
        const textEvents = events.filter(isTextEvent);
        expect(textEvents.length).toBeGreaterThanOrEqual(1);
        expect(textEvents[textEvents.length - 1].text).toContain(
          'interactive ok',
        );
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });

  it('setDisplayCallbacks replaces previously registered display callbacks (replace semantics)', async () => {
    const { agent, cleanup } = await buildAgent('tool-call-then-answer.jsonl');
    try {
      let firstCalled = 0;
      let secondCalled = 0;

      agent.tools.setDisplayCallbacks({
        onAllToolCallsComplete: () => {
          firstCalled += 1;
        },
      });
      agent.tools.setDisplayCallbacks({
        onAllToolCallsComplete: () => {
          secondCalled += 1;
        },
      });

      const responder = respondToFirstConfirmation(
        agent,
        ToolConfirmationOutcome.ProceedOnce,
      );
      try {
        const events: AgentEvent[] = await drain(agent.stream('replace test'));
        expect(countType(events, 'done')).toBe(1);
        expect(events.some(isToolResultEvent)).toBe(true);

        expect(firstCalled).toBe(0);
        expect(secondCalled).toBeGreaterThanOrEqual(1);
      } finally {
        responder.unsubscribe();
      }
    } finally {
      await cleanup();
    }
  });
});
