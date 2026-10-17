/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { loadTrustedFolders } from '../../config/trustedFolders.js';
import { createPermissionsCommand } from './permissionsCommand.js';
import { bindPermissionCommit } from './permissionsCommandHost.js';

describe('registered permission workspace owner', () => {
  const makeOwner = useCommandOwners();
  let previous: string | undefined;
  beforeEach(() => {
    previous = process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH;
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH;
    else process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH = previous;
  });
  it('resolves trust paths against the registered workspace instead of the invocation workspace', async () => {
    const owner = await makeOwner('permission-owner');
    const sibling = await makeOwner('permission-sibling');
    const ownerRoot = owner.workspace.getWorkingDirectory();
    process.env.LLXPRT_CODE_TRUSTED_FOLDERS_PATH = join(
      ownerRoot,
      'trust.json',
    );
    const command = createPermissionsCommand(
      () => ownerRoot,
      bindPermissionCommit(null),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            permissionsCommand: command,
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((entry) => entry.name === 'permissions')?.action;
    if (!action) throw new Error('Permission command unavailable');
    const result = await action(
      createMockCommandContext({
        services: {
          config: {
            getWorkingDir: () => sibling.workspace.getWorkingDirectory(),
          },
        },
      }),
      'TRUST_FOLDER .',
    );
    expect(result).toMatchObject({ type: 'message', messageType: 'info' });
    expect(loadTrustedFolders().isPathTrusted(ownerRoot)).toBe(true);
    expect(
      loadTrustedFolders().isPathTrusted(
        sibling.workspace.getWorkingDirectory(),
      ),
    ).not.toBe(true);
    await owner.dispose();
    expect(
      sibling.workspace
        .getDirectories()
        .map((directory) => realpathSync(directory)),
    ).toContain(realpathSync(sibling.workspace.getWorkingDirectory()));
  });
});
