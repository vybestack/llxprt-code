/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { canonicalizeToolName } from '@vybestack/llxprt-code-tools';
import type { HistoryItemWithoutId } from '../types.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { bindToolsCommand } from './toolsCommandHost.js';
import { createToolsCommand } from './toolsCommand.js';

describe('registered tools command owner', () => {
  const makeOwner = useCommandOwners();

  it('changes the registered Agent tool policy instead of the invocation Agent policy', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    const target = owner.tools.list().find((tool) => tool.source !== 'mcp');
    if (!target) throw new Error('Expected an owned non-MCP tool');
    owner.setEphemeralSetting('tools.disabled', []);
    decoy.setEphemeralSetting('tools.disabled', []);
    const history: HistoryItemWithoutId[] = [];
    const command = createToolsCommand(bindToolsCommand(owner), (item) => {
      history.push(item);
    });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), toolsCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const registered = registry
      .getCommands()
      .find((candidate) => candidate.name === 'tools');
    if (!registered?.action) throw new Error('Tools command is unavailable');

    await registered.action(
      createMockCommandContext({ services: { agent: decoy } }),
      `disable "${target.displayName ?? target.name}"`,
    );

    const disabled = owner.getEphemeralSetting('tools.disabled');
    if (!Array.isArray(disabled)) {
      throw new Error(
        'The registered Agent did not persist its disabled tools',
      );
    }
    expect(disabled).toContain(canonicalizeToolName(target.name));
    expect(decoy.getEphemeralSetting('tools.disabled')).toStrictEqual([]);
    expect(history.some((item) => item.type === 'info')).toBe(true);
  });
});
