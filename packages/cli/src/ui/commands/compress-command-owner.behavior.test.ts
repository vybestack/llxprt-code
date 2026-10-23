/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  useCommandOwners,
  commandOwnerClient,
} from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindCompressCommand } from './compressCommandHost.js';
import { createCompressCommand } from './compressCommand.js';
import { CompressionStatus } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { HistoryItemCompression, HistoryItemWithoutId } from '../types.js';

describe('registered compress command owner', () => {
  const makeOwner = useCommandOwners();

  it('uses the registered Agent compression result and leaves the invocation Agent unchanged', async () => {
    const owner = await makeOwner('owner');
    const decoy = await makeOwner('decoy');
    const ownerHistory = [
      {
        speaker: 'human' as const,
        blocks: [
          { type: 'text' as const, text: 'owner question '.repeat(300) },
        ],
      },
      {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'owner answer '.repeat(300) }],
      },
      {
        speaker: 'human' as const,
        blocks: [
          { type: 'text' as const, text: 'owner follow-up '.repeat(300) },
        ],
      },
    ];
    await owner.setHistory(ownerHistory);
    await decoy.setHistory([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'decoy history remains intact' }],
      },
    ]);
    await commandOwnerClient(owner).startChat(
      await commandOwnerClient(owner).getHistory(),
    );
    await commandOwnerClient(decoy).startChat(
      await commandOwnerClient(decoy).getHistory(),
    );
    const emitted: HistoryItemWithoutId[] = [];
    const invocation = createMockCommandContext({
      services: { agent: decoy },
      ui: { addItem: (item: HistoryItemWithoutId) => emitted.push(item) },
    });
    const command = createCompressCommand(
      bindCompressCommand(owner.compress.bind(owner)),
    );
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          { ...createUnconfiguredBuiltinOwners(), compressCommand: command },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const registered = registry
      .getCommands()
      .find((candidate) => candidate.name === 'compress');
    if (!registered?.action) throw new Error('Compress command is unavailable');

    await registered.action(invocation, '');

    expect(emitted.some((item) => item.type === MessageType.COMPRESSION)).toBe(
      true,
    );
    const compression = emitted.find(
      (item): item is HistoryItemCompression =>
        item.type === MessageType.COMPRESSION,
    );
    expect(compression).toBeDefined();
    expect(compression?.compression.compressionStatus).toBe(
      CompressionStatus.NOOP,
    );
    expect(await decoy.getHistory()).toMatchObject([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'decoy history remains intact' }],
      },
    ]);
  });
});
