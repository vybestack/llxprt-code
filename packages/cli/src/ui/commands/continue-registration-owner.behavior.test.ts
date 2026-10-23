/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { validateSessionMediaPackage } from '@vybestack/llxprt-code-core';
import { createContinueCommand } from './continueCommand.js';
import { bindContinueCommandOperations } from './continueCommandHost.js';

describe('continue registration operation ownership', () => {
  const makeOwner = useCommandOwners();
  it('exports captured history without consulting an attached session facade', async () => {
    const owner = await makeOwner('continue-registration-owner');
    const decoy = await makeOwner('continue-registration-decoy');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'captured export conversation' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    await decoy.dispose();
    const session = (await owner.session.listSessions())[0];
    const root = await mkdtemp(join(tmpdir(), 'continue-registration-'));
    try {
      const operations = bindContinueCommandOperations(
        Object.assign(owner.session.exportSession.bind(owner.session), {
          session: decoy.session,
        }),
        () => true,
        async () => [...(await owner.session.listBrowserTargets())],
        validateSessionMediaPackage,
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            {
              ...createUnconfiguredBuiltinOwners(),
              continueCommand: createContinueCommand(operations),
            },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const action = registry
        .getCommands()
        .find((command) => command.name === 'continue')?.action;
      if (!action) throw new Error('Missing registered continue command');
      const destination = join(root, 'export');
      expect(
        await action(
          createMockCommandContext(),
          `export ${session.id} ${destination}`,
        ),
      ).toMatchObject({ type: 'message', messageType: 'info' });
      expect(
        await readFile(join(destination, 'session.jsonl'), 'utf8'),
      ).toContain('captured export conversation');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
