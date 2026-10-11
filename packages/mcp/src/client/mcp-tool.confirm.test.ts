/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'bun:test';
import { DiscoveredMCPTool } from './mcp-tool.js';
import {
  ToolConfirmationOutcome,
  type CallableTool,
} from '@vybestack/llxprt-code-tools';
import { unsupportedApprovalPolicy } from './test-support/approval-policy.js';

const callable: CallableTool = {
  tool: async () => [],
  callTool: async () => {
    throw new Error('Confirmation must not call transport');
  },
};
function tool(trust = false, folderTrust = true) {
  return new DiscoveredMCPTool(
    unsupportedApprovalPolicy(),
    callable,
    'server',
    'tool',
    '',
    { type: 'object' },
    trust,
    undefined,
    { isTrustedFolder: () => folderTrust },
  );
}
const signal = new AbortController().signal;

describe('MCP confirmation host contract', () => {
  it('returns original server and tool names for an untrusted server', async () => {
    expect(await tool().build({}).shouldConfirmExecute(signal)).toMatchObject({
      type: 'mcp',
      serverName: 'server',
      toolName: 'tool',
    });
  });
  it('does not override host policy ASK with local server or folder trust', async () => {
    expect(
      await tool(true, true).build({}).shouldConfirmExecute(signal),
    ).toMatchObject({ type: 'mcp' });
    expect(
      await tool(true, false).build({}).shouldConfirmExecute(signal),
    ).toMatchObject({ type: 'mcp' });
    expect(
      await tool(false, true).build({}).shouldConfirmExecute(signal),
    ).toMatchObject({ type: 'mcp' });
  });
  it.each([
    ToolConfirmationOutcome.ProceedAlwaysServer,
    ToolConfirmationOutcome.ProceedAlwaysTool,
    ToolConfirmationOutcome.ProceedAlwaysAndSave,
  ])('surfaces unsupported host approval for %s', async (outcome) => {
    const details = await tool().build({}).shouldConfirmExecute(signal);
    if (details === false) throw new Error('Expected confirmation');
    await expect(details.onConfirm(outcome)).rejects.toThrow(
      'Reusable MCP approval is unsupported',
    );
  });
  it.each([
    ToolConfirmationOutcome.Cancel,
    ToolConfirmationOutcome.ProceedOnce,
    ToolConfirmationOutcome.ProceedAlways,
  ])(
    'permits %s without requesting reusable host approval',
    async (outcome) => {
      const instance = tool();
      const details = await instance.build({}).shouldConfirmExecute(signal);
      if (details === false) throw new Error('Expected confirmation');
      await details.onConfirm(outcome);
      expect(
        await instance.build({}).shouldConfirmExecute(signal),
      ).toMatchObject({ type: 'mcp' });
    },
  );
  it('describes invocation arguments', () => {
    expect(tool().build({ value: 42 }).getDescription()).toBe('{"value":42}');
  });
});
