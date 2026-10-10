/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Config,
  HookEventName,
  HookType,
  escapeShellArg,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { clearCommand } from './clearCommand.js';
import type { HistoryItemWithoutId } from '../types.js';
import type { CommandContext } from './types.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { assertDefined } from '../../__tests__/assertions.js';

const realTelemetry = { ...(await import('@vybestack/llxprt-code-telemetry')) };
void vi.mock('@vybestack/llxprt-code-telemetry', () => ({
  ...realTelemetry,
  uiTelemetryService: { reset: vi.fn() },
}));
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
const clearAction = clearCommand.action;
assertDefined(clearAction);

describe('clearCommand', () => {
  let directory: string;
  let config: Config;
  let context: CommandContext;
  let resetCount: number;
  let uiEvents: string[];
  let agent: ReturnType<typeof createUiSessionOwner> & {
    resetChat: Agent['resetChat'];
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(uiTelemetryService, 'reset').mockReset();
    directory = await mkdtemp(join(tmpdir(), 'clear-hook-'));
    const script = join(directory, 'hook.ts');
    await writeFile(
      script,
      `import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const input = JSON.parse(await Bun.stdin.text());
appendFileSync(${JSON.stringify(join(directory, 'order'))}, input.hook_event_name + '\\n');
const failure = ${JSON.stringify(join(directory, 'failure'))};
if (existsSync(failure) && readFileSync(failure, 'utf8') === input.hook_event_name) process.exit(1);
console.log(JSON.stringify({systemMessage: input.hook_event_name + ' feedback'}));
`,
    );
    const command = `exec ${escapeShellArg(process.execPath, 'bash')} ${escapeShellArg(script, 'bash')}`;
    config = new Config({
      sessionId: 'clear-test',
      targetDir: directory,
      cwd: directory,
      model: 'clear-test',
      debugMode: false,
      trustedFolder: true,
      enableHooks: true,
      hooks: {
        [HookEventName.SessionEnd]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
        [HookEventName.SessionStart]: [
          { hooks: [{ type: HookType.Command, command }] },
        ],
      },
    });
    resetCount = 0;
    uiEvents = [];
    agent = {
      ...createUiSessionOwner(config),
      resetChat: async () => {
        resetCount++;
        await appendFile(join(directory, 'order'), 'reset\n');
      },
    };
    context = createMockCommandContext({
      services: { config, agent },
      ui: {
        setDebugMessage: (text: string) => {
          uiEvents.push(text);
        },
        updateHistoryTokenCount: (count: number) => {
          uiEvents.push(`tokens:${count}`);
        },
        clear: () => {
          uiEvents.push('clear');
        },
        addItem: (item: HistoryItemWithoutId) => {
          if ('text' in item && item.text !== undefined)
            uiEvents.push(item.text);
        },
      },
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  async function order(): Promise<string[]> {
    return (await readFile(join(directory, 'order'), 'utf8'))
      .trim()
      .split('\n');
  }

  it('should set debug message, reset chat via agent, reset telemetry, update history token count, and clear UI when agent is available', async () => {
    const telemetryOrders: string[] = [];
    vi.spyOn(uiTelemetryService, 'reset').mockImplementation(() => {
      telemetryOrders.push(readFileSync(join(directory, 'order'), 'utf8'));
      uiEvents.push('telemetry');
    });
    await clearAction(context, '');
    expect(telemetryOrders).toStrictEqual([
      'SessionEnd\nreset\nSessionStart\n',
    ]);
    expect(uiEvents.slice(-3)).toStrictEqual([
      'telemetry',
      'tokens:0',
      'clear',
    ]);
    expect(resetCount).toBe(1);
    expect(uiEvents[0]).toBe('Clearing terminal and resetting chat.');
    expect(uiEvents).toContain('SessionStart feedback');
    expect(uiEvents.slice(-2)).toStrictEqual(['tokens:0', 'clear']);
    expect(await order()).toStrictEqual([
      'SessionEnd',
      'reset',
      'SessionStart',
    ]);
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
  it('should ask the agent to drop the whole conversation, including the initial turn', async () => {
    let history = ['first question', 'first answer', 'later question'];
    agent.resetChat = async (options) => {
      history =
        options?.retainInitialHistory === false ? [] : history.slice(0, 2);
    };
    await clearAction(context, '');
    expect(history).toStrictEqual([]);
  });
  it('should skip reset when no agent is available (terminal-only clear)', async () => {
    const terminal = createMockCommandContext({
      services: { config: null, agent: null },
      ui: context.ui,
    });
    await clearAction(terminal, '');
    expect(resetCount).toBe(0);
    expect(uiEvents[0]).toBe('Clearing terminal.');
    expect(uiEvents.slice(-2)).toStrictEqual(['tokens:0', 'clear']);
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
  it('should trigger SessionEnd hook before resetChat when clearing', async () => {
    const observed: string[] = [];
    agent.hooks.onHookExecution((request) => {
      observed.push(request.event);
    });
    await clearAction(context, '');
    expect(await order()).toStrictEqual([
      'SessionEnd',
      'reset',
      'SessionStart',
    ]);
    expect(observed).toStrictEqual(['SessionEnd', 'SessionStart']);
    expect(resetCount).toBe(1);
    expect(uiEvents).toContain('SessionStart feedback');
    expect(uiEvents.at(-1)).toBe('clear');
  });
  it('should complete clear even if SessionEnd hook throws', async () => {
    await writeFile(join(directory, 'failure'), 'SessionEnd');
    await clearAction(context, '');
    expect(resetCount).toBe(1);
    expect(await order()).toStrictEqual([
      'SessionEnd',
      'reset',
      'SessionStart',
    ]);
    expect(uiEvents).toContain('SessionStart feedback');
    expect(uiEvents.at(-1)).toBe('clear');
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
  it('should complete clear even if SessionStart hook throws', async () => {
    await writeFile(join(directory, 'failure'), 'SessionStart');
    await clearAction(context, '');
    expect(resetCount).toBe(1);
    expect(await order()).toStrictEqual([
      'SessionEnd',
      'reset',
      'SessionStart',
    ]);
    expect(uiEvents).not.toContain('SessionStart feedback');
    expect(uiEvents.at(-1)).toBe('clear');
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
  it('should not trigger hooks when agent is absent (terminal-only clear)', async () => {
    const observed: string[] = [];
    agent.hooks.onHookExecution((request) => {
      observed.push(request.event);
    });
    const terminal = createMockCommandContext({
      services: { config: null, agent: null },
      ui: context.ui,
    });
    await clearAction(terminal, '');
    expect(observed).toStrictEqual([]);
    expect(resetCount).toBe(0);
    expect(uiEvents).toStrictEqual(['Clearing terminal.', 'tokens:0', 'clear']);
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
  it('should use explicit agent hooks when agent is present but config is null', async () => {
    const explicit = createMockCommandContext({
      services: { config: null, agent },
      ui: context.ui,
    });
    await clearAction(explicit, '');
    expect(resetCount).toBe(1);
    expect(await order()).toStrictEqual([
      'SessionEnd',
      'reset',
      'SessionStart',
    ]);
    expect(uiEvents).toContain('SessionStart feedback');
    expect(uiEvents.at(-1)).toBe('clear');
    expect(uiTelemetryService.reset).toHaveBeenCalledTimes(1);
  });
});
