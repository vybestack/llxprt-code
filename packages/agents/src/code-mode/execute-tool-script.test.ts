/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * execute_tool_script runs only inside a scheduler that hands it a
 * nested-execution scope (issue #4084); anything else fails before any guest
 * code is evaluated.
 */

import { describe, expect, it } from 'bun:test';
import { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { CoreMessageBusAdapter } from '@vybestack/llxprt-code-core/tools-adapters/CoreMessageBusAdapter.js';
import { ExecuteToolScriptTool } from './execute-tool-script.js';
import type { CodeModeRuntime } from './runtime-contract.js';

function toolWithRecordingRuntime(): {
  readonly tool: ExecuteToolScriptTool;
  readonly runs: string[];
} {
  const runs: string[] = [];
  const runtime: CodeModeRuntime = {
    run: async (request) => {
      runs.push(request.source);
      return { ok: true, value: null, callCount: 0, logs: [] };
    },
  };
  const tool = new ExecuteToolScriptTool(
    new CoreMessageBusAdapter(new MessageBus()),
    () => runtime,
  );
  return { tool, runs };
}

const params = {
  source: 'return 1;',
  tools: ['read_file'],
  purpose: 'scope check',
};

describe('ExecuteToolScriptTool execution scope', () => {
  it('fails fast when executed outside a scheduler', async () => {
    const { tool, runs } = toolWithRecordingRuntime();

    await expect(
      tool.build(params).execute(new AbortController().signal),
    ).rejects.toThrow('nested-execution scope');
    expect(runs).toStrictEqual([]);
  });

  it('fails fast when the scheduler scope carries no nested-execution port', async () => {
    const { tool, runs } = toolWithRecordingRuntime();

    await expect(
      tool
        .build(params)
        .execute(
          new AbortController().signal,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            callId: 'call-1',
            promptId: 'prompt-1',
            agentId: 'primary',
            origin: 'model',
            hookRestrictedAllowedTools: undefined,
            nestedExecution: { kind: 'nested-tool-execution' },
          },
        ),
    ).rejects.toThrow('nested-execution scope');
    expect(runs).toStrictEqual([]);
  });

  it('accepts api_revision as optional until discovery exists', () => {
    const { tool } = toolWithRecordingRuntime();

    expect(() => tool.build(params)).not.toThrow();
    expect(() =>
      tool.build({ ...params, api_revision: 'any-revision' }),
    ).not.toThrow();
    expect(() =>
      tool.build({ ...params, purpose: undefined } as never),
    ).toThrow('purpose');
  });
});
