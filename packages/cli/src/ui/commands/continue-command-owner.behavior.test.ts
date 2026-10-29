/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { validateSessionMediaPackage } from '@vybestack/llxprt-code-core';

import { mkdtemp, rm } from 'node:fs/promises';
import { NativeJournalPageReader } from '@vybestack/llxprt-code-core/journal/native-journal-page-reader.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { bindContinueCommandOperations } from './continueCommandHost.js';
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { createContinueCommand } from './continueCommand.js';

describe('registered continue command owner', () => {
  const makeOwner = useCommandOwners();

  it('uses its registered interactive-mode read instead of invocation config', async () => {
    const command = createContinueCommand({
      isInteractive: () => true,
      listContinueTargets: async () => [],
      exportSession: async () => undefined,
      validateSessionPackage: async () => {
        throw new Error('unused');
      },
    });
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), continueCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const registered = registry
      .getCommands()
      .find((item) => item.name === 'continue');
    if (!registered?.action) throw new Error('Continue command is unavailable');
    const invocation = createMockCommandContext({
      services: { config: { isInteractive: () => false } },
    });

    const result = await registered.action(invocation, '');

    expect(result).toMatchObject({ type: 'dialog', dialog: 'sessionBrowser' });
  });
  it('exports from the registered Agent rather than the invocation Agent', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    await owner.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'registered owner content' }],
      },
    ]);
    await decoy.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'invocation decoy content' }],
      },
    ]);
    await owner.session.setRecording({ enabled: true });
    await decoy.session.setRecording({ enabled: true });
    const session = (await owner.session.listSessions()).at(0);
    if (session === undefined) throw new Error('Owner session was not listed');
    const exportRoot = await mkdtemp(join(tmpdir(), 'continue-owner-export-'));
    const destination = join(exportRoot, 'package');
    try {
      const command = createContinueCommand(
        bindContinueCommandOperations(
          owner.session.exportSession.bind(owner.session),
          () => false,
          async () => [...(await owner.session.listBrowserTargets())],
          validateSessionMediaPackage,
        ),
      );
      const registry = await CommandService.create(
        [
          new BuiltinCommandLoader(
            { ...createUnconfiguredBuiltinOwners(), continueCommand: command },
            null,
          ),
        ],
        new AbortController().signal,
      );
      const registered = registry
        .getCommands()
        .find((item) => item.name === 'continue');
      if (!registered?.action)
        throw new Error('Registered continue command is unavailable');
      const result = await registered.action(
        createMockCommandContext({ services: { agent: decoy } }),
        `export ${session.id} ${destination}`,
      );
      expect(result).toMatchObject({ type: 'message', messageType: 'info' });
      const validated = await validateSessionMediaPackage(destination);
      const reader = await NativeJournalPageReader.open(
        validated.recording.path,
      );
      try {
        const texts: string[] = [];
        for await (const entry of reader.entries()) {
          const content = await reader.readContent(entry);
          texts.push(
            ...content.blocks.flatMap((block) =>
              block.type === 'text' ? [block.text] : [],
            ),
          );
        }
        expect(texts).toContain('registered owner content');
        expect(texts).not.toContain('invocation decoy content');
      } finally {
        await reader.close();
      }
    } finally {
      await rm(exportRoot, { recursive: true, force: true });
    }
  }, 30000);
});
