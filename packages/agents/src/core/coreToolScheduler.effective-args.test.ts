/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Policy authorizes the arguments that actually execute (issue #4084): a
 * BeforeTool rewrite is prepared once, before policy evaluation; approval
 * edits are validated and authorized; a rewrite that does not validate fails
 * the call instead of falling back to the original invocation.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';
import { MockModifiableTool } from '@vybestack/llxprt-code-test-utils/core/tools.js';
import { PolicyDecision } from '@vybestack/llxprt-code-core/policy/types.js';
import { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools/types/tool-confirmation-types.js';
import type { ToolConfirmationPayload } from '@vybestack/llxprt-code-tools';
import {
  createEffectiveArgsFixture,
  type EffectiveArgsFixture,
  type EffectiveArgsFixtureOptions,
} from './__tests__/effective-args-fixture.js';
import type { WaitingToolCall } from './coreToolScheduler.js';

const fixtures: EffectiveArgsFixture[] = [];

function fixture(options: EffectiveArgsFixtureOptions): EffectiveArgsFixture {
  const created = createEffectiveArgsFixture(options);
  fixtures.push(created);
  return created;
}

function hookedTool(): MockTool {
  return new MockTool({
    name: 'hooked-tool',
    execute: async () => ({
      llmContent: 'executed',
      returnDisplay: 'executed',
    }),
  });
}

function shellTool(): MockTool {
  return new MockTool({
    name: 'run_shell_command',
    shouldConfirmExecute: (params) =>
      Promise.resolve({
        type: 'exec',
        title: 'Confirm Shell Command',
        command: String(params['command'] ?? ''),
        rootCommand: 'npm',
        rootCommands: ['npm'],
        onConfirm: async () => {},
      }),
    execute: async () => ({ llmContent: 'ran', returnDisplay: 'ran' }),
  });
}

async function awaitingApproval(
  target: EffectiveArgsFixture,
): Promise<WaitingToolCall> {
  let waiting: WaitingToolCall | undefined;
  await waitFor(() => {
    const latest = target.updates.slice(-1).flat();
    expect(latest.map((call) => call.status)).toStrictEqual([
      'awaiting_approval',
    ]);
    waiting = latest[0] as WaitingToolCall;
  });
  if (waiting === undefined) throw new Error('No call awaiting approval.');
  return waiting;
}

async function respond(
  waiting: WaitingToolCall,
  outcome: ToolConfirmationOutcome,
  payload?: ToolConfirmationPayload,
): Promise<void> {
  if (!('onConfirm' in waiting.confirmationDetails))
    throw new Error('Missing confirmation callback.');
  await waiting.confirmationDetails.onConfirm(outcome, payload);
}

describe('CoreToolScheduler effective-argument authorization', () => {
  afterEach(async () => {
    for (const created of fixtures.splice(0)) await created.dispose();
  });

  it('denies BeforeTool-rewritten arguments that a DENY rule matches, without executing', async () => {
    const tool = hookedTool();
    const target = fixture({
      tool,
      beforeToolOutput: {
        hookSpecificOutput: { tool_input: { rewritten: true } },
      },
      rules: [
        {
          toolName: 'hooked-tool',
          decision: PolicyDecision.DENY,
          argsPattern: /"rewritten":true/,
        },
      ],
    });

    await target.schedule({ original: true });
    const [completed] = await target.completed;

    expect(completed.status).toBe('error');
    expect(tool.executeFn).not.toHaveBeenCalled();
    expect(target.beforeToolRuns()).toBe(1);
  });

  it('does not let an ALLOW for the original arguments authorize a rewrite policy never allowed', async () => {
    const tool = hookedTool();
    const target = fixture({
      tool,
      beforeToolOutput: {
        hookSpecificOutput: { tool_input: { rewritten: true } },
      },
      defaultDecision: PolicyDecision.DENY,
      rules: [
        {
          toolName: 'hooked-tool',
          decision: PolicyDecision.ALLOW,
          argsPattern: /"original":true/,
          priority: 10,
        },
      ],
    });

    await target.schedule({ original: true });
    const [completed] = await target.completed;

    expect(completed.status).toBe('error');
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  it('preserves model-requested arguments while executing the BeforeTool rewrite', async () => {
    const tool = hookedTool();
    const target = fixture({
      tool,
      beforeToolOutput: {
        hookSpecificOutput: { tool_input: { file_path: 'modified.txt' } },
      },
    });

    await target.schedule({ file_path: 'original.txt' });
    const [completed] = await target.completed;

    expect(completed.status).toBe('success');
    expect(completed.request.args).toStrictEqual({ file_path: 'original.txt' });
    expect(tool.executeFn.mock.calls.map((call) => call[0])).toStrictEqual([
      { file_path: 'modified.txt' },
    ]);
    expect(target.beforeToolRuns()).toBe(1);
  });

  it('executes exactly the rewritten arguments policy allowed and runs BeforeTool once', async () => {
    const tool = hookedTool();
    const target = fixture({
      tool,
      beforeToolOutput: {
        hookSpecificOutput: { tool_input: { rewritten: true } },
      },
      rules: [
        {
          toolName: 'hooked-tool',
          decision: PolicyDecision.ALLOW,
          argsPattern: /"rewritten":true/,
          priority: 10,
        },
      ],
      defaultDecision: PolicyDecision.DENY,
    });

    await target.schedule({ original: true });
    const [completed] = await target.completed;

    expect(completed.status).toBe('success');
    expect(tool.executeFn.mock.calls.map((call) => call[0])).toStrictEqual([
      { rewritten: true },
    ]);
    expect(completed.request.args).toStrictEqual({ original: true });
    expect(target.beforeToolRuns()).toBe(1);
  });

  it('fails a call whose BeforeTool rewrite does not validate instead of running the original', async () => {
    const tool = hookedTool();
    const target = fixture({
      tool,
      beforeToolOutput: { hookSpecificOutput: { tool_input: { param: 42 } } },
    });

    await target.schedule({ param: 'safe' });
    const [completed] = await target.completed;

    expect(completed.status).toBe('error');
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  it('asks approval for the rewritten arguments and runs BeforeTool once across approval', async () => {
    const tool = shellTool();
    const target = fixture({
      tool,
      beforeToolOutput: {
        hookSpecificOutput: { tool_input: { command: 'npm test' } },
      },
      defaultDecision: PolicyDecision.ASK_USER,
    });

    await target.schedule({ command: 'npm run build' });
    const waiting = await awaitingApproval(target);
    expect(waiting.request.args).toStrictEqual({ command: 'npm run build' });
    await respond(waiting, ToolConfirmationOutcome.ProceedOnce);
    const [completed] = await target.completed;

    expect(completed.status).toBe('success');
    expect(tool.executeFn.mock.calls.map((call) => call[0])).toStrictEqual([
      { command: 'npm test' },
    ]);
    expect(target.beforeToolRuns()).toBe(1);
  });

  it('executes approval-edited arguments that policy allows without rerunning BeforeTool', async () => {
    const tool = shellTool();
    const target = fixture({ tool, defaultDecision: PolicyDecision.ASK_USER });

    await target.schedule({ command: 'npm instal' });
    await respond(
      await awaitingApproval(target),
      ToolConfirmationOutcome.SuggestEdit,
      { editedCommand: 'npm ci' },
    );
    const [completed] = await target.completed;

    expect(completed.status).toBe('success');
    expect(tool.executeFn.mock.calls.map((call) => call[0])).toStrictEqual([
      { command: 'npm ci' },
    ]);
    expect(target.beforeToolRuns()).toBe(1);
  });

  it('denies approval-edited shell arguments that a DENY rule matches', async () => {
    const tool = shellTool();
    const target = fixture({
      tool,
      defaultDecision: PolicyDecision.ASK_USER,
      rules: [
        {
          toolName: 'run_shell_command',
          decision: PolicyDecision.DENY,
          argsPattern: /npm install/,
          priority: 100,
        },
      ],
    });

    await target.schedule({ command: 'npm instal' });
    await respond(
      await awaitingApproval(target),
      ToolConfirmationOutcome.SuggestEdit,
      { editedCommand: 'npm install' },
    );
    const [completed] = await target.completed;

    expect(completed.status).toBe('error');
    expect(completed.request.args).toStrictEqual({ command: 'npm install' });
    expect(tool.executeFn).not.toHaveBeenCalled();
  });

  it('denies inline-modified content that a DENY rule matches', async () => {
    const tool = new MockModifiableTool();
    const target = fixture({
      tool,
      defaultDecision: PolicyDecision.ASK_USER,
      rules: [
        {
          toolName: 'mockModifiableTool',
          decision: PolicyDecision.DENY,
          argsPattern: /forbidden content/,
          priority: 100,
        },
      ],
    });

    await target.schedule({});
    await respond(
      await awaitingApproval(target),
      ToolConfirmationOutcome.ProceedOnce,
      { newContent: 'forbidden content' },
    );
    const [completed] = await target.completed;

    expect(completed.status).toBe('error');
    expect(tool.executeFn).not.toHaveBeenCalled();
  });
});
