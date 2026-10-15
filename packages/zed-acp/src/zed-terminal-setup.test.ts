/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { createAgent } from '@vybestack/llxprt-code-agents';
import {
  ACQUISITION_HARD_MAX_BYTES,
  ACQUISITION_MIN_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import { useOwnedCredentials } from '../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { createZedTerminalTransport } from './zed-terminal-setup.js';
import { RecordingConnection } from './__tests__/zed-test-helpers.js';

function transport(connection: RecordingConnection, setting?: number) {
  return createZedTerminalTransport(
    'session-1',
    connection as unknown as acp.AgentSideConnection,
    process.cwd(),
    new DebugLogger('llxprt:zed-terminal-transport-test'),
    setting,
  );
}

describe('preferred ACP terminal transport', () => {
  const credentials = useOwnedCredentials();
  it('does not enable a shell tool excluded from the base registry', async () => {
    const terminals = transport(new RecordingConnection());
    const agent = await createAgent({
      provider: 'openai',
      model: 'terminal-model',
      workingDir: process.cwd(),
      excludeTools: ['run_shell_command'],
      credentialAuthority: credentials().authority,
      executeShellCommand: terminals.executeShellCommand.bind(terminals),
    });
    try {
      expect(agent.tools.get('run_shell_command')).toBeUndefined();
    } finally {
      await agent.dispose();
      await terminals.settleAll();
    }
  });

  it('binds a distinct terminal-backed shell when the base registry includes one', async () => {
    const connection = new RecordingConnection();
    const terminals = transport(connection);
    const input = {
      provider: 'openai',
      model: 'terminal-model',
      workingDir: process.cwd(),
      credentialAuthority: credentials().authority,
    };
    const base = await createAgent(input);
    const agent = await createAgent({
      ...input,
      executeShellCommand: terminals.executeShellCommand.bind(terminals),
    });
    try {
      const tool = agent.tools.get('run_shell_command');
      expect(tool).toBeDefined();
      expect(tool).not.toBe(base.tools.get('run_shell_command'));
    } finally {
      await Promise.all([
        agent.dispose(),
        base.dispose(),
        terminals.settleAll(),
      ]);
    }
  });

  it.each([
    [
      'the default for an absent setting',
      undefined,
      DEFAULT_ACQUISITION_BUDGET_BYTES,
    ],
    ['the hard maximum for -1', -1, ACQUISITION_HARD_MAX_BYTES],
    ['the default for an invalid zero', 0, DEFAULT_ACQUISITION_BUDGET_BYTES],
    ['the minimum for a small positive value', 100, ACQUISITION_MIN_BYTES],
    [
      'the hard maximum for an excessive value',
      ACQUISITION_HARD_MAX_BYTES + 1,
      ACQUISITION_HARD_MAX_BYTES,
    ],
  ])('passes %s to ACP', async (_description, setting, expectedLimit) => {
    const connection = new RecordingConnection();
    const terminals = transport(connection, setting);
    try {
      await terminals.executeShellCommand(
        'echo test',
        '/project',
        () => undefined,
        new AbortController().signal,
      );
      expect(connection.createTerminalCalls).toHaveLength(1);
      expect(connection.createTerminalCalls[0]?.outputByteLimit).toBe(
        expectedLimit,
      );
    } finally {
      await terminals.settleAll();
    }
  });
});
