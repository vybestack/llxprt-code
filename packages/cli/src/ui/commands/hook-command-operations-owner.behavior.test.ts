/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { HookEventName, HookType } from '@vybestack/llxprt-code-core';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createHooksCommand } from './hooksCommand.js';

describe('hook command independent operations', () => {
  const makeOwner = useCommandOwners();
  it('disables only the registered hook and keeps a sibling usable after owner retirement', async () => {
    const definitions = {
      [HookEventName.BeforeTool]: [
        {
          hooks: [
            { type: HookType.Command, name: 'owned-hook', command: 'echo {}' },
          ],
        },
      ],
    };
    const owner = await makeOwner(
      'hook-operation-owner',
      undefined,
      definitions,
    );
    const sibling = await makeOwner(
      'hook-operation-sibling',
      undefined,
      definitions,
    );
    const listHooks = Object.assign(() => owner.hooks.listHooks(), {
      hooks: sibling.hooks,
    });
    const command = createHooksCommand(
      {
        listHooks,
        isConfigured: true,
        isAvailable: true,
        enable: owner.hooks.enable.bind(owner.hooks),
        disable: owner.hooks.disable.bind(owner.hooks),
        setDisabledHooks: owner.hooks.setDisabledHooks.bind(owner.hooks),
      },
      () => 0,
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), hooksCommand: command },
          createMockCommandContext({
            services: {
              config: {
                getEnableHooksUI: () => true,
                isSkillsSupportEnabled: () => false,
                getProjectTempDir: () => owner.workspace.getWorkingDirectory(),
              },
            },
          }).services.config,
        ),
      ],
      new AbortController().signal,
    );
    const registered = registry
      .getCommands()
      .find((entry) => entry.name === 'hooks');
    if (!registered?.action) throw new Error('Missing hooks command');
    await registered.action(createMockCommandContext(), 'disable owned-hook');
    expect(owner.hooks.getDisabledHooks()).toContain('owned-hook');
    expect(sibling.hooks.getDisabledHooks()).not.toContain('owned-hook');
    await owner.dispose();
    const surviving = createHooksCommand(
      {
        listHooks: () => sibling.hooks.listHooks(),
        isConfigured: true,
        isAvailable: true,
        enable: sibling.hooks.enable.bind(sibling.hooks),
        disable: sibling.hooks.disable.bind(sibling.hooks),
        setDisabledHooks: sibling.hooks.setDisabledHooks.bind(sibling.hooks),
      },
      () => 0,
    );
    await surviving.action?.(createMockCommandContext(), 'disable owned-hook');
    expect(sibling.hooks.getDisabledHooks()).toContain('owned-hook');
  });
});
