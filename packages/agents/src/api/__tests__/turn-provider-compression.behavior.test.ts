/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  ProfileManager,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import { successful, withOwners } from './turn-revision-capture.fixture.js';

describe('Foreground compression on an admitted provider route', () => {
  it('compresses a hard-limit continuation on the admitted HTTP endpoint and model after profile replacement', async () => {
    await withOwners(
      async (a, _b, original, replacement, start) => {
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        for (let index = 0; index < 3; index++) {
          successful(
            await start(
              a,
              `Previous conversation ${index}: ${'context '.repeat(4000)}`,
            ),
          );
        }
        const admitted = start(a, 'Pause before reducing the context limit');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'capture-replacement',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        a.setEphemeralSetting('context-limit', 12000);
        a.setEphemeralSetting('maxOutputTokens', 100);
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        a.injectSteer('Keep answering after context compression');
        original.release();
        const completed = await admitted;
        successful(completed);
        const compression = original
          .requests()
          .filter((request) =>
            JSON.stringify(request.messages).includes(
              '### CRITICAL INSTRUCTION',
            ),
          );
        expect(compression).toHaveLength(1);
        expect(compression[0]).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
        expect(replacement.requests()).toHaveLength(0);
        expect(original.requests().slice(-1)[0]).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
        expect(
          JSON.stringify(original.requests().slice(-1)[0]?.messages),
        ).toContain('Keep answering after context compression');
      },
      false,
      false,
      4,
    );
  }, 30_000);

  it('compresses on the admitted load-balancer member after replacement', async () => {
    await withOwners(
      async (a, _b, original, replacement, start) => {
        const profiles = new ProfileManager();
        await profiles.saveProfile('old-compression-member', {
          version: 1,
          provider: 'openai',
          model: 'old-compression-model',
          modelParams: { temperature: 0.2 },
          ephemeralSettings: {
            'base-url': original.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        await profiles.saveProfile('new-compression-member', {
          version: 1,
          provider: 'openai',
          model: 'new-compression-model',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        const lb = (member: string): LoadBalancerProfile => ({
          version: 1,
          type: 'loadbalancer',
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
          policy: 'roundrobin',
          profiles: [member],
        });
        await a.profiles.applySnapshot(lb('old-compression-member'));
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        for (let index = 0; index < 3; index++) {
          successful(
            await start(a, `LB history ${index}: ${'context '.repeat(4000)}`),
          );
        }
        const admitted = start(a, 'Pause the LB compression turn');
        await original.entered;
        await a.profiles.applySnapshot(lb('new-compression-member'));
        a.setEphemeralSetting('context-limit', 12000);
        a.setEphemeralSetting('maxOutputTokens', 100);
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        a.injectSteer('Continue with the admitted LB member');
        original.release();
        successful(await admitted);
        const compression = original
          .requests()
          .filter((request) =>
            JSON.stringify(request.messages).includes(
              '### CRITICAL INSTRUCTION',
            ),
          );
        expect(compression).toHaveLength(1);
        expect(compression[0]).toMatchObject({
          model: 'old-compression-model',
          temperature: 0.2,
        });
        expect(replacement.requests()).toHaveLength(0);
        expect(original.requests().slice(-1)[0]).toMatchObject({
          model: 'old-compression-model',
          temperature: 0.2,
        });
      },
      false,
      false,
      4,
    );
  }, 30_000);

  it('does not dispatch compressed history with credentials revoked during a paused run', async () => {
    await withOwners(
      async (a, _b, original, replacement, start) => {
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        for (let index = 0; index < 3; index++) {
          successful(
            await start(a, `Earlier turn ${index}: ${'context '.repeat(4000)}`),
          );
        }
        const admitted = start(a, 'Pause before revoking the original key');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'revoked-compression-model',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'new-key-revokes-original',
          },
        });
        a.setEphemeralSetting('context-limit', 12000);
        a.setEphemeralSetting('maxOutputTokens', 100);
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        a.injectSteer('Do not send compressed history with a revoked key');
        original.release();
        const completed = await admitted;
        expect(completed.events.some((event) => event.type === 'error')).toBe(
          true,
        );
        expect(original.requests()).toHaveLength(4);
        expect(replacement.requests()).toHaveLength(0);
      },
      false,
      false,
      4,
    );
  }, 30_000);

  it('honors a separately configured compression profile after replacing the foreground profile', async () => {
    await withOwners(
      async (a, _b, original, replacement, start) => {
        const profiles = new ProfileManager();
        await profiles.saveProfile('dedicated-compressor', {
          version: 1,
          provider: 'openai',
          model: 'dedicated-compression-model',
          modelParams: { temperature: 0.4 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        for (let index = 0; index < 3; index++) {
          successful(
            await start(
              a,
              `Prior conversation ${index}: ${'context '.repeat(4000)}`,
            ),
          );
        }
        const admitted = start(a, 'Pause before selecting the compressor');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'capture-replacement',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        a.setEphemeralSetting('compression.profile', 'dedicated-compressor');
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        a.setEphemeralSetting('context-limit', 12000);
        a.setEphemeralSetting('maxOutputTokens', 100);
        a.injectSteer('Continue using the admitted route');
        original.release();
        successful(await admitted);
        expect(replacement.requests()).toMatchObject([
          { model: 'dedicated-compression-model', temperature: 0.4 },
        ]);
        expect(JSON.stringify(replacement.requests()[0]?.messages)).toContain(
          '### CRITICAL INSTRUCTION',
        );
        expect(original.requests().slice(-1)[0]).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
      },
      false,
      false,
      4,
    );
  }, 30_000);

  it('uses the admitted endpoint for context-size 413 compression and its retry', async () => {
    await withOwners(
      async (a, _b, original, replacement, start) => {
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        for (let index = 0; index < 3; index++) {
          successful(await start(a, `Previous 413 context ${index}`));
        }
        const admitted = start(a, 'Pause before a 413 continuation');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'replacement-after-413',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        a.setEphemeralSetting('compression.strategy', 'one-shot');
        a.injectSteer('Retry this request after the 413');
        original.release();
        const result = await admitted;
        expect(result.rejection).toBeUndefined();
        expect(
          result.events.filter((event) => event.type === 'error'),
        ).toStrictEqual([]);
        expect(
          result.events.filter((event) => event.type === 'done'),
        ).toMatchObject([{ type: 'done', reason: 'stop' }]);
        expect(
          result.events.filter((event) => event.type === 'text').length,
        ).toBeGreaterThan(1);
        expect(original.requests()).toHaveLength(7);
        expect(original.requests()[4]).toMatchObject({ model: 'capture-a' });
        expect(JSON.stringify(original.requests()[5]?.messages)).toContain(
          '### CRITICAL INSTRUCTION',
        );
        expect(original.requests()[5]).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
        expect(original.requests()[6]).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
        expect(JSON.stringify(original.requests()[6]?.messages)).toContain(
          'Retry this request after the 413',
        );
        expect(replacement.requests()).toHaveLength(0);
      },
      false,
      false,
      4,
      5,
    );
  }, 30_000);

  it('surfaces an unhandled HTTP 413 as an error completion without a retry', async () => {
    await withOwners(
      async (a, _b, original, _replacement, start) => {
        const admitted = start(a, 'A request that cannot be retried');
        await original.entered;
        original.release();
        const result = await admitted;
        expect(result.rejection).toBeUndefined();
        expect(
          result.events.filter((event) => event.type === 'error'),
        ).toHaveLength(1);
        expect(
          result.events.filter((event) => event.type === 'done'),
        ).toMatchObject([{ type: 'done', reason: 'error' }]);
        expect(original.requests()).toHaveLength(1);
      },
      false,
      false,
      1,
      1,
      false,
    );
  }, 30_000);
});
