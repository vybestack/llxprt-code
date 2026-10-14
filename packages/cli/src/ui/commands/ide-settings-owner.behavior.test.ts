/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { IdeClient } from '@vybestack/llxprt-code-core';
import type { IdeState } from '../cliUiRuntime.js';
import { LoadedSettings } from '../../config/settings.js';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { CommandService } from '../../services/CommandService.js';
import { createIdeCommand } from './ideCommand.js';
import { bindIdeCommand } from './ideCommandHost.js';

function settingsAt(root: string): LoadedSettings {
  return new LoadedSettings(
    { settings: {}, path: join(root, 'system.json') },
    { settings: {}, path: join(root, 'defaults.json') },
    { settings: { ui: { ideMode: false } }, path: join(root, 'user.json') },
    { settings: {}, path: join(root, 'workspace.json') },
    true,
  );
}

describe('registered IDE settings owner', () => {
  const makeOwner = useCommandOwners();
  let previousTerminal: string | undefined;
  beforeEach(() => {
    previousTerminal = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = 'vscode';
  });
  afterEach(() => {
    if (previousTerminal === undefined) delete process.env.TERM_PROGRAM;
    else process.env.TERM_PROGRAM = previousTerminal;
  });

  it('persists IDE mode for the registered settings owner rather than invocation settings', async () => {
    const owner = await makeOwner('ide-owner');
    const sibling = await makeOwner('ide-sibling');
    const settings = settingsAt(owner.workspace.getWorkingDirectory());
    const otherSettings = settingsAt(sibling.workspace.getWorkingDirectory());
    const client = await IdeClient.create();
    let enabled = false;
    const state: IdeState = {
      getIdeClient: () => client,
      getIdeMode: () => enabled,
      setIdeMode: (value) => {
        enabled = value;
      },
      setIdeClientConnected: () => {},
      setIdeClientDisconnected: () => client.disconnect(),
      getLspConfig: () => undefined,
    };
    try {
      const command = createIdeCommand(
        bindIdeCommand(state, settings, () => 0),
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), ideCommand: command },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const enable = registry
        .getCommands()
        .find((entry) => entry.name === 'ide')
        ?.subCommands?.find((entry) => entry.name === 'enable')?.action;
      if (!enable) throw new Error('IDE enable command unavailable');
      await enable(
        createMockCommandContext({
          services: { agent: sibling, settings: otherSettings },
        }),
        '',
      );
      const persisted: unknown = JSON.parse(
        await readFile(settings.user.path, 'utf8'),
      );
      expect(persisted).toMatchObject({ ui: { ideMode: true } });
      expect(otherSettings.merged.ui.ideMode).toBe(false);
      await owner.dispose();
      expect(await sibling.getHistory()).toStrictEqual([]);
    } finally {
      await client.disconnect();
    }
  });
});
