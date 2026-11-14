/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installWorkspaceRuntimeFixture } from '../../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

/**
 * Rendering of code mode runs in the tool group (issue #4084): the parent
 * `execute_tool_script` card stays bounded for a 64-call script, and a nested
 * call waiting for approval renders the ordinary confirmation prompt under a
 * label naming the script that made it. Real ToolMessage and confirmation
 * components, rendered with ink-testing-library.
 */

import { describe, expect, it } from 'bun:test';
import {
  formatToolScriptCard,
  type ToolScriptRunView,
} from '@vybestack/llxprt-code-agents';
import {
  Config,
  type ToolCallConfirmationDetails,
  type Todo,
} from '@vybestack/llxprt-code-core';
import { renderWithProviders } from '../../../__tests__/render.js';
import { StreamingContext } from '../../contexts/StreamingContext.js';
import { TodoContext } from '../../contexts/TodoContext.js';
import type { IndividualToolCallDisplay } from '../../types.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { ToolGroupMessage } from './ToolGroupMessage.js';

const config = new Config({
  sessionId: 'code-mode-tool-group',
  targetDir: process.cwd(),
  cwd: process.cwd(),
  model: 'code-mode-fixture',
  debugMode: false,
  trustedFolder: true,
});
const noTodos: {
  todos: Todo[];
  updateTodos: () => void;
  refreshTodos: () => void;
} = { todos: [], updateTodos: () => {}, refreshTodos: () => {} };

function runOf(calls: number): ToolScriptRunView {
  const time = '2026-11-13T00:00:00.000Z';
  return {
    runId: 'run-1',
    parentCallId: 'script-call-1',
    agentId: 'primary',
    purpose: 'list exported symbols',
    tools: ['read_file'],
    calls: Array.from({ length: calls }, (_, index) => ({
      phase: 'call' as const,
      runId: 'run-1',
      parentCallId: 'script-call-1',
      time,
      sequence: index + 1,
      callId: `script-call-1#script-run-${index + 1}`,
      tool: 'read_file',
      argsSummary: JSON.stringify({
        absolute_path: `/repo/file-${index + 1}.ts`,
      }),
      approval: 'not_required' as const,
      status: 'ok' as const,
      completeness: 'complete' as const,
      resultBytes: 10,
    })),
    finished: {
      phase: 'finished',
      runId: 'run-1',
      parentCallId: 'script-call-1',
      time,
      ok: true,
      callCount: calls,
      partial: false,
      inputBytes: calls * 10,
      finalBytes: 2,
      durationMs: 20,
    },
  };
}

function renderGroup(toolCalls: IndividualToolCallDisplay[]) {
  return renderWithProviders(
    <StreamingContext.Provider value={StreamingState.WaitingForConfirmation}>
      <TodoContext.Provider value={noTodos}>
        <ToolGroupMessage
          readIdeMode={() => false}
          readIdeDiffingEnabled={() => false}
          subscribeIdeDiffing={() => () => {}}
          resolveIdeDiff={async () => {}}
          groupId={1}
          terminalWidth={120}
          config={composeFixtureRuntime(config)}
          isFocused={true}
          toolCalls={toolCalls}
        />
      </TodoContext.Provider>
    </StreamingContext.Provider>,
  );
}

describe('code mode in the tool group', () => {
  it('keeps the card of a 64-call script to its listed calls', () => {
    const card = formatToolScriptCard(runOf(64), {
      source:
        'for (const f of files) await tools["read_file"]({ absolute_path: f });',
      result: '[]',
    });
    const { lastFrame } = renderGroup([
      {
        callId: 'script-call-1',
        name: 'Execute tool script',
        description: 'list exported symbols [tools: read_file]',
        resultDisplay: card,
        status: ToolCallStatus.Success,
        confirmationDetails: undefined,
        renderOutputAsMarkdown: false,
      },
    ]);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Purpose: list exported symbols');
    expect(frame).toContain('Tool calls: 64 (64 ok)');
    expect(frame).toContain('56 earlier call(s) not shown');
    expect(frame).toContain('/repo/file-64.ts');
    expect(frame).not.toContain('/repo/file-56.ts');
    expect(frame).not.toContain('/repo/file-1.ts');
  });

  it('labels a waiting nested call with its script above the ordinary confirmation prompt', () => {
    const confirmation: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Command',
      command: 'touch marker',
      rootCommand: 'touch',
      rootCommands: ['touch'],
      onConfirm: async () => {},
    };
    const { lastFrame } = renderGroup([
      {
        callId: 'script-call-1',
        name: 'Execute tool script',
        description: 'create the marker [tools: run_shell_command]',
        resultDisplay: undefined,
        status: ToolCallStatus.Executing,
        confirmationDetails: undefined,
        renderOutputAsMarkdown: false,
      },
      {
        callId: 'script-call-1#script-abc12345-1',
        name: 'Shell',
        description: 'touch marker',
        resultDisplay: undefined,
        status: ToolCallStatus.Confirming,
        confirmationDetails: confirmation,
        renderOutputAsMarkdown: false,
        scriptOrigin: {
          parentCallId: 'script-call-1',
          purpose: 'create the marker',
        },
      },
    ]);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('↳ from script: create the marker');
    expect(frame).toContain('touch marker');
    expect(frame).toContain('Allow execution');
    expect(frame.indexOf('↳ from script')).toBeLessThan(
      frame.indexOf('Allow execution'),
    );
  });
});
