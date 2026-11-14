import { collectResumeRows } from '../../__tests__/resumeRows.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createSetupGithubCommand } from './setupGithubCommand.js';
import { bindGithubSetup } from './setupGithubCommandHost.js';

describe('registered GitHub workspace owner', () => {
  const makeOwner = useCommandOwners();
  it('writes downloaded workflows only in the registered repository', async () => {
    const owner = await makeOwner('setup-owner');
    const sibling = await makeOwner('setup-sibling');
    const root = owner.workspace.getWorkingDirectory();
    const siblingRoot = sibling.workspace.getWorkingDirectory();
    for (const cwd of [root, siblingRoot]) {
      execFileSync('git', ['init', '--quiet'], { cwd });
      execFileSync(
        'git',
        ['remote', 'add', 'origin', 'git@github.com:example/fixture.git'],
        { cwd },
      );
    }
    const network = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith('/releases/latest'))
            return Response.json({ tag_name: 'fixture-release' });
          return new Response('name: fixture\non: workflow_dispatch\n');
        },
        { preconnect: () => {} },
      ),
    );
    const previousDirectory = process.cwd();
    process.chdir(siblingRoot);
    try {
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            {
              ...createUnconfiguredBuiltinOwners(),
              setupGithubCommand: createSetupGithubCommand(
                bindGithubSetup(root, undefined),
              ),
            },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const action = registry
        .getCommands()
        .find((command) => command.name === 'setup-github')?.action;
      if (!action) throw new Error('Setup command unavailable');
      await action(
        createMockCommandContext({
          services: {
            agent: sibling,
            config: {
              getWorkingDir: () => siblingRoot,
              getProxy: () => undefined,
            },
          },
        }),
        '',
      );
      expect(existsSync(join(root, '.github', 'workflows'))).toBe(true);
      expect((await readdir(join(root, '.github', 'workflows'))).length).toBe(
        5,
      );
      expect((await readdir(join(root, '.github', 'commands'))).length).toBe(4);
      expect(existsSync(join(siblingRoot, '.github'))).toBe(false);
      await owner.dispose();
      expect(await collectResumeRows(sibling.streamHistory())).toStrictEqual(
        [],
      );
    } finally {
      process.chdir(previousDirectory);
      network.mockRestore();
    }
  });
});
