/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { Config, SessionSettingsOwner } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { useCommandOwners } from './__tests__/command-owner-fixture.js';
import { captureNonInteractiveRun } from './__tests__/captured-headless-run-fixture.js';

describe('noninteractive execution ownership', () => {
  const makeOwner = useCommandOwners();
  it('streams on the captured application after a sibling with the same identity retires', async () => {
    const owner = await makeOwner('headless-owner');
    const peer = await makeOwner('headless-peer');
    const directory = owner.workspace.getWorkingDirectory();
    const config = new Config({
      sessionId: owner.getRuntimeId(),
      cwd: directory,
      targetDir: directory,
      model: owner.getModel(),
      debugMode: false,
    });
    const store = new SettingsService();
    const selected = new SessionSettingsOwner(store);
    const run = captureNonInteractiveRun(config, owner, true, () =>
      selected.telemetry.flush(),
    );
    const output = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      expect(owner.getRuntimeId()).toBe(peer.getRuntimeId());
      await peer.dispose();
      await run(
        'Headless request captured by its original owner',
        'bound-turn',
      );
      const history = await owner.getHistory();
      expect(history).toStrictEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('captured by its original owner'),
              }),
            ]),
          }),
          expect.objectContaining({ speaker: 'ai' }),
        ]),
      );
      expect(owner.getModel()).toBe('headless-owner-initial');
    } finally {
      output.mockRestore();
      await config.dispose();
      await selected.dispose();
    }
  });
});
