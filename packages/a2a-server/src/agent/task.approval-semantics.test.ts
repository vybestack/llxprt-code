/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the #3221 approval-boundary semantics of Task:
 *
 * - a message that MIXES a pending tool-confirmation part with new content is
 *   a client protocol error (resuming and superseding a paused turn in one
 *   message is incoherent) and must be rejected BEFORE the confirmation is
 *   consumed, leaving the paused turn resumable;
 * - canceling (or superseding) the active turn releases the turn-scoped
 *   confirmation bookkeeping so stale callIds cannot satisfy later
 *   stale-replay guard lookups.
 *
 * Drives the REAL Agent via createTaskAgent (LLXPRT_FAKE_RESPONSES) with a
 * REAL core write_file tool call — the production confirmation path — exactly
 * as the executor does.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { CoderAgentEvent } from '../types.js';
import { Task } from './task.js';

const WORKSPACE = mkdtempSync(join(tmpdir(), 'a2a-approval-sem-'));
// folderTrust grants the write capability the confirmation flow needs, the
// same way the E2E workspace settings do.
mkdirSync(join(WORKSPACE, '.llxprt'), { recursive: true });
writeFileSync(
  join(WORKSPACE, '.llxprt', 'settings.json'),
  JSON.stringify({ folderTrust: true }),
);
const FIXTURE = join(WORKSPACE, 'fake-responses.jsonl');
// Turn 1: a real write_file call (requires confirmation in default mode);
// turn 2: the continuation text after the tool runs.
writeFileSync(
  FIXTURE,
  JSON.stringify({
    chunks: [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'sem-call-1',
            name: 'write_file',
            parameters: {
              absolute_path: join(WORKSPACE, 'sem-out.txt'),
              content: 'approval-semantics',
            },
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
          blocks: [{ type: 'text', text: 'tool ran' }],
        },
      ],
    }) +
    '\n',
);

const SAVED_ENV: Readonly<Record<string, string | undefined>> = {
  ...process.env,
};
const SAVED_CWD = process.cwd();

async function buildAgent(): Promise<Agent> {
  const { createTaskAgent, setTargetDir } = await import('../config/config.js');
  const { loadSettings } = await import('../config/settings.js');
  // Executor parity: resolve the workspace (chdir) before building the task
  // agent, exactly as the executor does per request.
  setTargetDir({
    kind: CoderAgentEvent.StateAgentSettingsEvent,
    workspacePath: WORKSPACE,
  });
  process.env.LLXPRT_FAKE_RESPONSES = FIXTURE;
  const settings = loadSettings(WORKSPACE);
  return createTaskAgent(settings, [], 'approval-semantics-task');
}

/**
 * Drives the first user turn up to the approval boundary the way the
 * executor does: consumes events, records the pending confirmation, and
 * STOPS at the confirmation (the executor returns at the approval boundary;
 * continuing would await the paused stream forever). Breaking the for-await
 * is safe here — the Task's #driveTurnStream firewall prevents the
 * consumer-side break from returning into the paused Agent stream.
 */
async function driveToApprovalBoundary(task: Task): Promise<{
  callId: string;
  confirmationId: string;
}> {
  let recorded: { callId: string; confirmationId: string } | undefined;
  for await (const event of task.acceptUserMessage(
    {
      userMessage: { parts: [{ kind: 'text', text: 'run the tool' }] },
    } as never,
    new AbortController().signal,
  )) {
    if (event.type === 'tool-confirmation') {
      const confirmation = event.confirmation;
      task.recordPendingConfirmation(confirmation);
      recorded = {
        callId: confirmation.toolCallId,
        confirmationId: confirmation.confirmationId,
      };
      break;
    }
  }
  if (!recorded) {
    throw new Error('no tool-confirmation reached the boundary');
  }
  return recorded;
}

afterEach(() => {
  // Full env restore: reinstate keys deleted mid-test, drop keys added
  // mid-test, and reset any mutated values (setTargetDir/buildAgent may
  // touch all three classes via chdir-relative settings loading).
  for (const key of Object.keys(process.env)) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[key];
    } else if (process.env[key] !== SAVED_ENV[key]) {
      process.env[key] = SAVED_ENV[key];
    }
  }
  for (const key of Object.keys(SAVED_ENV)) {
    if (process.env[key] === undefined && SAVED_ENV[key] !== undefined) {
      process.env[key] = SAVED_ENV[key];
    }
  }
  // buildAgent chdir'd into WORKSPACE; restore before any later file (bun
  // runs all test files in one process) resolves paths against it.
  if (process.cwd() !== SAVED_CWD) {
    process.chdir(SAVED_CWD);
  }
});

describe('Task approval-boundary semantics (#3221)', () => {
  it('rejects a message mixing a pending confirmation with new content before consuming the confirmation', async () => {
    const agent = await buildAgent();
    try {
      const task = await Task.create('t-mixed', 'c-mixed', agent);
      const { callId } = await driveToApprovalBoundary(task);

      const mixedMessage = {
        userMessage: {
          parts: [
            { kind: 'data', data: { callId, outcome: 'proceed_once' } },
            { kind: 'text', text: 'and also do something else' },
          ],
        },
      } as never;

      let threw: string | undefined;
      try {
        for await (const _event of task.acceptUserMessage(
          mixedMessage,
          new AbortController().signal,
        )) {
          // drain; the throw should surface on first iteration
        }
      } catch (error) {
        threw = error instanceof Error ? error.message : String(error);
      }
      expect(threw).toContain('mixed tool-confirmation and content parts');

      // The rejection happened BEFORE consuming the confirmation: the call
      // is still pending and a clean confirmation-only message still resumes
      // the paused turn to completion.
      expect(task.hasPendingConfirmation(callId)).toBe(true);
      const confirmOnly = {
        userMessage: {
          parts: [{ kind: 'data', data: { callId, outcome: 'proceed_once' } }],
        },
      } as never;
      const types: string[] = [];
      for await (const event of task.acceptUserMessage(
        confirmOnly,
        new AbortController().signal,
      )) {
        types.push(event.type);
      }
      expect(types).toContain('done');
      expect(existsSync(join(WORKSPACE, 'sem-out.txt'))).toBe(true);
      expect(task.hasPendingConfirmation(callId)).toBe(false);
    } finally {
      await agent.dispose();
    }
  }, 30_000);

  it('cancelTurn at the approval boundary releases the turn-scoped confirmation state', async () => {
    const agent = await buildAgent();
    try {
      const task = await Task.create('t-cancel', 'c-cancel', agent);
      const { callId } = await driveToApprovalBoundary(task);
      expect(task.hasPendingConfirmation(callId)).toBe(true);

      task.cancelTurn();

      expect(task.hasPendingConfirmation(callId)).toBe(false);
      expect(task.isToolCallResolved(callId)).toBe(false);

      // A confirmation-only message after cancel is a graceful no-op (no
      // paused turn to resume), not a crash or a phantom turn.
      const confirmOnly = {
        userMessage: {
          parts: [{ kind: 'data', data: { callId, outcome: 'proceed_once' } }],
        },
      } as never;
      const types: string[] = [];
      for await (const event of task.acceptUserMessage(
        confirmOnly,
        new AbortController().signal,
      )) {
        types.push(event.type);
      }
      expect(types).toEqual([]);
    } finally {
      await agent.dispose();
    }
  }, 30_000);
});

process.on('exit', () => {
  // Leave the process CWD before deleting the workspace it pointed at.
  try {
    process.chdir(SAVED_CWD);
  } catch {
    // SAVED_CWD vanished; fall back to tmpdir so the rm below never runs
    // from inside the directory it is deleting.
    try {
      process.chdir(tmpdir());
    } catch {
      // No viable CWD left; deletion below is best effort.
    }
  }
  try {
    rmSync(WORKSPACE, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup during process exit; nowhere left to report to.
  }
});
