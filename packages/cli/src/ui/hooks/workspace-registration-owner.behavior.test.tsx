/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { renderHook } from '../../__tests__/render.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createWorkspaceCommandOwners } from './workspaceCommandOwners.js';
import { canonicalizeToolName } from '@vybestack/llxprt-code-tools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('workspace command registration operations', () => {
  const makeOwner = useCommandOwners();
  it('registers a captured tool policy rather than a conflicting legacy graph', async () => {
    const owner = await makeOwner('workspace-registration-owner');
    const sibling = await makeOwner('workspace-registration-sibling');
    const legacyOwner = {
      tools: owner.tools,
      agentClient: owner.sessionClient,
      getEphemeralSetting: owner.getEphemeralSetting.bind(owner),
      setEphemeralSetting: owner.setEphemeralSetting.bind(owner),
    };
    const hook = renderHook(
      ({ actual, decoy }: { actual: Agent; decoy: typeof legacyOwner }) => {
        const listTools = Object.assign(() => actual.tools.list(), {
          tools: decoy.tools,
          agentClient: decoy.agentClient,
          getEphemeralSetting: decoy.getEphemeralSetting,
          setEphemeralSetting: decoy.setEphemeralSetting,
        });
        return createWorkspaceCommandOwners(
          null,
          listTools,
          actual.getEphemeralSetting.bind(actual),
          actual.setEphemeralSetting.bind(actual),
          () => 0,
          () => {},
          async () => {
            await actual.sessionClient.publishTools();
          },
          actual.policy.getRules.bind(actual.policy),
          actual.policy.getDefaultDecision.bind(actual.policy),
          actual.policy.isNonInteractive.bind(actual.policy),
          actual.hooks.listHooks.bind(actual.hooks),
          actual.hooks.enable.bind(actual.hooks),
          actual.hooks.disable.bind(actual.hooks),
          actual.hooks.setDisabledHooks.bind(actual.hooks),
          actual.tasks.list.bind(actual.tasks),
          actual.tasks.listRunning.bind(actual.tasks),
          actual.tasks.get.bind(actual.tasks),
          actual.tasks.cancel.bind(actual.tasks),
          actual.addDirectoryContext.bind(actual),
          () => {},
          actual.sessionClient.runImageOperation.bind(actual.sessionClient),
          () => undefined,
          () => '',
        );
      },
      {
        initialProps: {
          actual: owner,
          decoy: {
            tools: sibling.tools,
            agentClient: sibling.sessionClient,
            getEphemeralSetting: sibling.getEphemeralSetting.bind(sibling),
            setEphemeralSetting: sibling.setEphemeralSetting.bind(sibling),
          },
        },
      },
    );
    try {
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), ...hook.result.current },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const tools = registry
        .getCommands()
        .find((command) => command.name === 'tools');
      const target = owner.tools.list().find((tool) => tool.source !== 'mcp');
      if (!tools?.action || !target)
        throw new Error('Missing registered tool command or fixture tool');
      await tools.action(
        createMockCommandContext(),
        `disable "${target.name}"`,
      );
      expect(owner.getEphemeralSetting('tools.disabled')).toContain(
        canonicalizeToolName(target.name),
      );
      expect(sibling.getEphemeralSetting('tools.disabled')).toBeUndefined();
      await owner.dispose();
      await act(async () => {
        hook.rerender({ actual: sibling, decoy: legacyOwner });
      });
      expect(() => owner.getEphemeralSetting('tools.disabled')).toThrow(
        'Session settings owner is closed',
      );
      await hook.result.current.toolsCommand.action?.(
        createMockCommandContext(),
        `disable "${target.name}"`,
      );
      expect(sibling.getEphemeralSetting('tools.disabled')).toContain(
        target.name,
      );
    } finally {
      hook.unmount();
    }
  });
});
