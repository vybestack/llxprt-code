/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { useCommandOwners } from '../../__tests__/command-owner-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';
import { BuiltinCommandLoader } from '../../__tests__/builtin-loader-fixture.js';
import { CommandService } from '../../services/CommandService.js';
import { bindAboutDetails } from './aboutCommandHost.js';
import { createAboutCommand } from './aboutCommand.js';
import type { HistoryItem } from '../types.js';

describe('about registration operations', () => {
  const makeOwner = useCommandOwners();
  it('reports the captured session model instead of a callable legacy runtime', async () => {
    const owner = await makeOwner('about-captured');
    const peer = await makeOwner('about-decoy');
    await peer.setModel('about-peer-model');
    const snapshot = Object.assign(
      owner.getRuntimeDiagnosticsSnapshot.bind(owner),
      {
        getRuntimeDiagnosticsSnapshot:
          peer.getRuntimeDiagnosticsSnapshot.bind(peer),
        getActiveProviderName: peer.getProvider.bind(peer),
        getActiveProviderDetails: () => undefined,
        getEphemeralSetting: peer.getEphemeralSetting.bind(peer),
      },
    );
    const readProvider = Object.assign(owner.getProvider.bind(owner), {
      getModel: peer.getModel.bind(peer),
      getProvider: peer.getProvider.bind(peer),
      getEphemeralSetting: peer.getEphemeralSetting.bind(peer),
      getIdeMode: () => false,
    });
    const details = bindAboutDetails(
      snapshot,
      readProvider,
      () => undefined,
      owner.getEphemeralSetting.bind(owner),
      owner.getModel.bind(owner),
      owner.getEphemeralSetting.bind(owner),
      owner.getProvider.bind(owner),
      () => '',
      () => ({
        providerName: owner.getProvider(),
        modelName: owner.getModel(),
        displayLabel: owner.getProvider(),
      }),
      () => undefined,
    );
    const output: Array<Omit<HistoryItem, 'id'>> = [];
    const registry = await CommandService.create(
      [
        new BuiltinCommandLoader(
          {
            ...createUnconfiguredBuiltinOwners(),
            aboutCommand: createAboutCommand(details, (item) =>
              output.push(item),
            ),
          },
          null,
        ),
      ],
      new AbortController().signal,
    );
    const action = registry
      .getCommands()
      .find((item) => item.name === 'about')?.action;
    if (!action) throw new Error('Missing registered about command');
    await action(createMockCommandContext(), '');
    expect(JSON.stringify(output)).toContain(
      `${owner.getProvider()}:${owner.getModel()}`,
    );
    expect(JSON.stringify(output)).not.toContain('about-peer-model');
  });
});
