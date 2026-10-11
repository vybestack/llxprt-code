/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { withRecordingLifetimeFixture } from '../../../../agents/src/api/__tests__/helpers/recording-owner-lifetime-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { chatCommand } from './chatCommand.js';
import { chatOwnerCommand } from './chatOwnerCommand.js';

async function saveCheckpoint(mode?: 'agent' | 'raw'): Promise<string> {
  let recorded = '';
  await withRecordingLifetimeFixture(async ({ agent }) => {
    await agent.setHistory([
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ]);
    await agent.session.setRecording({ enabled: true });
    const path = agent.session.getRecording().path;
    if (!path) throw new Error('No owner recording');
    const command = new BuiltinCommandLoader(null, mode)
      .loadCommandsSync()
      .find((item) => item.name === 'chat')
      ?.subCommands?.find((item) => item.name === 'save');
    if (!command?.action) throw new Error('Missing /chat save');
    const result = await command.action(
      createMockCommandContext({ services: { agent } }),
      'checkpoint',
    );
    expect(result).toMatchObject({ messageType: 'info' });
    recorded = await readFile(path, 'utf8');
  });
  return recorded;
}

describe('interactive /chat command registry', () => {
  it('uses the Agent session for explicit owner mode in sync and async loads', async () => {
    const sync = await saveCheckpoint('agent');
    expect(sync).toContain('checkpoint');
    await withRecordingLifetimeFixture(async ({ agent }) => {
      await agent.session.setRecording({ enabled: true });
      const command = (
        await new BuiltinCommandLoader(null, 'agent').loadCommands(
          new AbortController().signal,
        )
      ).find((item) => item.name === 'chat');
      expect(command).toBe(chatOwnerCommand);
    });
  }, 30000);

  it('keeps the raw /chat handler by default', async () => {
    const command = new BuiltinCommandLoader(null)
      .loadCommandsSync()
      .find((item) => item.name === 'chat');
    expect(command).toBe(chatCommand);
  }, 30000);
});
