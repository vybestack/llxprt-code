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

function configFixture(): Config {
  return {
    getPolicyEngine: () => undefined,
    getDebugMode: () => false,
    getTargetDir: () => '/project',
    getEphemeralSetting: () => undefined,
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
});
