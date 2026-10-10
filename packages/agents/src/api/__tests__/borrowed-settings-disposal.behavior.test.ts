/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '../index.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

describe('borrowed settings disposal', () => {
  it.each([0, 1])(
    'retains caller settings and the peer when facade %s closes first',
    async (closingIndex) => {
      const built = await buildCliStyleConfig('multi-turn-text.jsonl');
      const options = {
        config: built.config,
        settingsService: built.settingsService,
        settingsOwner: built.settingsOwner,
        providerManager: built.providerManager,
        messageBus: built.messageBus,
        mcpRuntime: built.mcpRuntime,
      };
      const first = await fromConfig(options);
      const second = await fromConfig(options);
      const closing = closingIndex === 0 ? first : second;
      const peer = closingIndex === 0 ? second : first;
      try {
        const disposal = closing.dispose();
        expect(() =>
          closing.setEphemeralSetting('maxOutputTokens', 19),
        ).toThrow('Session settings owner is closed');
        expect(() => closing.getEphemeralSetting('maxOutputTokens')).toThrow(
          'Session settings owner is closed',
        );
        await disposal;
        built.settingsOwner.assertSettingsIdentity(built.settingsService);
        peer.setEphemeralSetting('maxOutputTokens', 71);
        const events = [];
        for await (const event of peer.stream(
          'Peer survives borrowed disposal',
        ))
          events.push(event);
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
        expect(built.settingsService.get('maxOutputTokens')).toBe(71);
        await peer.dispose();
        expect(() =>
          built.settingsOwner.assertSettingsIdentity(built.settingsService),
        ).not.toThrow();
      } finally {
        await first.dispose();
        await second.dispose();
        await built.cleanup();
      }
    },
    30000,
  );
});
