/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import type * as acp from '@agentclientprotocol/sdk';
import {
  DebugLogger,
  MessageBus,
  type Config,
} from '@vybestack/llxprt-code-core';
import {
  ShellTool,
  type IShellToolHost,
  type ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import {
  ACQUISITION_HARD_MAX_BYTES,
  ACQUISITION_MIN_BYTES,
  DEFAULT_ACQUISITION_BUDGET_BYTES,
} from '@vybestack/llxprt-code-tools/acquisition.js';
import { buildZedTerminalSetup } from './zed-terminal-setup.js';
import { RecordingConnection } from './zed-test-helpers.js';

function configFixture(outputLimit?: number): Config {
  return {
    getPolicyEngine: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getEphemeralSetting: (key: string) =>
      key === 'shell-output-retention-max-bytes' ? outputLimit : undefined,
  } as unknown as Config;
}

const messageBus = new MessageBus();

describe('buildZedTerminalSetup', () => {
  it('does not enable a shell tool excluded from the base registry', () => {
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;

    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(),
      baseRegistry,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
    );

    expect(setup.registry.getTool(ShellTool.Name)).toBeUndefined();
  });

  it('registers a terminal-backed ShellTool when the base registry includes one', () => {
    const baseShellTool = new ShellTool({} as unknown as IShellToolHost);
    const baseRegistry = {
      getAllTools: vi.fn(() => [baseShellTool]),
    } as unknown as ToolRegistry;

    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(),
      baseRegistry,
      new RecordingConnection() as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
    );

    const tool = setup.registry.getTool(ShellTool.Name);
    expect(tool).toBeDefined();
    expect(tool).not.toBe(baseShellTool);
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
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;
    const connection = new RecordingConnection();
    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(setting),
      baseRegistry,
      connection as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
      messageBus,
    );

    await setup.terminals.executeShellCommand(
      'echo test',
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.createTerminalCalls).toHaveLength(1);
    expect(connection.createTerminalCalls[0]?.outputByteLimit).toBe(
      expectedLimit,
    );
  });
});
