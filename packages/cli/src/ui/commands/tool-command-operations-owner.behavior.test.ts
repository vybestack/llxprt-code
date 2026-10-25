/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { canonicalizeToolName } from '@vybestack/llxprt-code-tools';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createToolsCommand } from './toolsCommand.js';

describe('tool command independent operations', () => {
  const makeOwner = useCommandOwners();
  it('uses the registered setting writer despite a conflicting legacy owner and keeps a sibling usable', async () => {
    const owner = await makeOwner('tool-operation-owner');
    const sibling = await makeOwner('tool-operation-sibling');
    const target = owner.tools.list().find((tool) => tool.source !== 'mcp');
    if (!target) throw new Error('Missing fixture tool');
    const listTools = Object.assign(() => owner.tools.list(), {
      tools: sibling.tools,
      sessionClient: sibling.sessionClient,
      getEphemeralSetting: sibling.getEphemeralSetting.bind(sibling),
      setEphemeralSetting: sibling.setEphemeralSetting.bind(sibling),
    });
    const command = createToolsCommand(
      {
        listTools,
        readSetting: owner.getEphemeralSetting.bind(owner),
        writeSetting: owner.setEphemeralSetting.bind(owner),
        refreshToolSchema: () => owner.sessionClient.publishTools(),
      },
      () => 0,
    );
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
      .find((entry) => entry.name === 'tools');
    if (!registered?.action) throw new Error('Missing tools command');
    await registered.action(
      createMockCommandContext(),
      `disable "${target.name}"`,
    );
    expect(owner.getEphemeralSetting('tools.disabled')).toContain(
      canonicalizeToolName(target.name),
    );
    expect(sibling.getEphemeralSetting('tools.disabled')).toBeUndefined();
    await owner.dispose();
    const surviving = createToolsCommand(
      {
        listTools: () => sibling.tools.list(),
        readSetting: sibling.getEphemeralSetting.bind(sibling),
        writeSetting: sibling.setEphemeralSetting.bind(sibling),
        refreshToolSchema: () => sibling.sessionClient.publishTools(),
      },
      () => 0,
    );
    await surviving.action?.(
      createMockCommandContext(),
      `disable "${target.name}"`,
    );
    expect(sibling.getEphemeralSetting('tools.disabled')).toContain(
      canonicalizeToolName(target.name),
    );
  });
});
