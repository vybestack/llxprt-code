/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type * as acp from '@agentclientprotocol/sdk';
import { DebugLogger, type Config } from '@vybestack/llxprt-code-core';
import {
  ShellTool,
  type IShellToolHost,
  type ToolRegistry,
} from '@vybestack/llxprt-code-tools';
import { buildZedTerminalSetup } from './zed-terminal-setup.js';
import { RecordingConnection } from './zed-test-helpers.js';

function configFixture(outputLimit?: number): Config {
  return {
    getPolicyEngine: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getEphemeralSetting: () => outputLimit,
  } as unknown as Config;
}

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
    );

    const tool = setup.registry.getTool(ShellTool.Name);
    expect(tool).toBeDefined();
    expect(tool).not.toBe(baseShellTool);
  });

  it('ignores non-positive terminal output token limits', async () => {
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;
    const connection = new RecordingConnection();
    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(-1),
      baseRegistry,
      connection as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
    );

    await setup.terminals.executeShellCommand(
      'echo test',
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.createTerminalCalls).toHaveLength(1);
    expect(connection.createTerminalCalls[0]).not.toHaveProperty(
      'outputByteLimit',
    );
  });

  it('converts a positive output token limit to bytes', async () => {
    const baseRegistry = {
      getAllTools: vi.fn(() => []),
    } as unknown as ToolRegistry;
    const connection = new RecordingConnection();
    const setup = buildZedTerminalSetup(
      'session-1',
      configFixture(100),
      baseRegistry,
      connection as unknown as acp.AgentSideConnection,
      new DebugLogger('llxprt:zed-terminal-setup-test'),
    );

    await setup.terminals.executeShellCommand(
      'echo test',
      '/project',
      () => undefined,
      new AbortController().signal,
    );

    expect(connection.createTerminalCalls).toHaveLength(1);
    expect(connection.createTerminalCalls[0]?.outputByteLimit).toBe(400);
  });
});
