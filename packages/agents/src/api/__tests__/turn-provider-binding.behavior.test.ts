/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import {
  ProfileManager,
  type LoadBalancerProfile,
} from '@vybestack/llxprt-code-settings';
import {
  collect,
  successful,
  withOwners,
} from './turn-revision-capture.fixture.js';

describe('Foreground admitted provider and model binding additions on the HTTP wire', () => {
  it('keeps a tool-result continuation on the admitted endpoint after replacement', async () => {
    await withOwners(
      async (a, b, original, replacement, start) => {
        const admitted = start(a, 'Read an allowed file');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'capture-tool-replacement',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'turn-capture-local-only',
          },
        });
        successful(await start(b, 'Unchanged sibling'));
        original.release();
        successful(await admitted);
        expect(
          original
            .requests()
            .map(({ model, temperature }) => ({ model, temperature })),
        ).toStrictEqual([
          { model: 'capture-a', temperature: 0.2 },
          { model: 'capture-a', temperature: 0.2 },
        ]);
        expect(JSON.stringify(original.requests()[1]?.messages)).toContain(
          'function',
        );
        successful(await start(a, 'New ordinary admission'));
        expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
          'capture-b',
          'capture-tool-replacement',
        ]);
      },
      false,
      true,
    );
  }, 30_000);

  it('keeps the admitted route when only the model changes on the same provider', async () => {
    await withOwners(async (a, b, original, sibling, start) => {
      const admitted = start(a, 'Original model');
      await original.entered;
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-next-model',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': original.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      a.injectSteer('Same provider continuation');
      successful(await start(b, 'Independent owner'));
      original.release();
      const completed = await admitted;
      successful(completed);
      expect(
        completed.events
          .filter((event) => event.type === 'model-info')
          .map((event) => ({
            model: event.info.model,
            label: event.info.displayLabel,
          })),
      ).toStrictEqual([
        { model: 'capture-a', label: 'capture-a' },
        { model: 'capture-a', label: 'capture-a' },
      ]);
      successful(await start(a, 'Next model admission'));
      expect(
        original
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-next-model', temperature: 0.8 },
      ]);
      expect(sibling.requests().map(({ model }) => model)).toStrictEqual([
        'capture-b',
      ]);
    });
  }, 30_000);
  it('keeps an endpoint-only replacement out of an admitted continuation', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const admitted = start(a, 'Original endpoint');
      await original.entered;
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-a',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      a.injectSteer('Stay on admitted endpoint');
      successful(await start(b, 'Independent sibling'));
      original.release();
      successful(await admitted);
      successful(await start(a, 'Use replacement endpoint'));
      expect(
        original
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
      ]);
      expect(
        replacement
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-b', temperature: 0.7 },
        { model: 'capture-a', temperature: 0.8 },
      ]);
    });
  }, 30_000);

  it('retains the admitted direct endpoint after a public auth endpoint change', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const admitted = start(a, 'Original auth endpoint');
      await original.entered;
      await a.auth.setBaseUrl(replacement.url);
      a.injectSteer('Use the admitted direct endpoint');
      successful(await start(b, 'Independent owner'));
      original.release();
      successful(await admitted);
      successful(await start(a, 'Next endpoint admission'));
      expect(
        original
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
      ]);
      expect(
        replacement
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-b', temperature: 0.7 },
        { model: 'capture-a', temperature: 0.2 },
      ]);
    });
  }, 30_000);

  it('rejects a competing public model command while a turn owns its route', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const admitted = start(a, 'Original command route');
      await original.entered;
      await expect(
        a.setModel('capture-competing-command'),
      ).rejects.toBeInstanceOf(AgentBusyError);
      await expect(
        a.setProvider('openai', 'capture-competing-provider'),
      ).rejects.toBeInstanceOf(AgentBusyError);
      a.injectSteer('Continue on admitted model');
      successful(await start(b, 'Independent owner'));
      original.release();
      successful(await admitted);
      successful(await start(a, 'Fresh model admission'));
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'capture-a',
        'capture-a',
        'capture-a',
      ]);
      expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
        'capture-b',
      ]);
    });
  }, 30_000);

  it('rejects a public raw-key rotation at the next direct dispatch boundary', async () => {
    await withOwners(async (a, _b, original, replacement, start) => {
      const admitted = start(a, 'Original credentials');
      await original.entered;
      await a.auth.keys.setRaw('different-replacement-secret');
      a.injectSteer('Reject revoked direct authorization');
      original.release();
      expect(
        (await admitted).events.some((event) => event.type === 'error'),
      ).toBe(true);
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'capture-a',
      ]);
      successful(await start(a, 'Fresh admission after changing auth'));
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'capture-a',
        'capture-a',
      ]);
      expect(replacement.requests()).toHaveLength(0);
    });
  }, 30_000);

  it('does not retry an unauthorized admitted route with a newly applied credential', async () => {
    await withOwners(
      async (a, b, original, replacement, start) => {
        const admitted = start(a, 'Unauthorized original request');
        await original.entered;
        await a.profiles.applySnapshot({
          version: 1,
          provider: 'openai',
          model: 'capture-authorized-next',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'authorized-next-secret',
          },
        });
        successful(await start(b, 'Still authorized sibling'));
        original.release();
        const first = await admitted;
        expect(original.requests().map(({ model }) => model)).toStrictEqual([
          'capture-a',
        ]);
        expect(first.events.some((event) => event.type === 'error')).toBe(true);
        successful(await start(a, 'Fresh admission after 401'));
        expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
          'capture-b',
          'capture-authorized-next',
        ]);
      },
      false,
      false,
      1,
      1,
      false,
      401,
    );
  }, 30_000);

  it('does not send replacement credentials to the admitted endpoint', async () => {
    await withOwners(async (a, _b, original, replacement, start) => {
      const admitted = start(a, 'Original credentials');
      await original.entered;
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-new-auth',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'different-replacement-secret',
        },
      });
      a.injectSteer('Do not leak the new secret to the old endpoint');
      original.release();
      const completed = await admitted;
      expect(completed.events.some((event) => event.type === 'error')).toBe(
        true,
      );
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'capture-a',
      ]);
      successful(await start(a, 'New admission with new credentials'));
      expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
        'capture-new-auth',
      ]);
    });
  }, 30_000);

  it('finishes a paused consumer without hanging on disposal', async () => {
    await withOwners(async (a, _b, original, replacement) => {
      const iterator = a
        .stream('Request with paused reader', {
          mcpDiscovery: 'skip',
        })
        [Symbol.asyncIterator]();
      original.release();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-after-pause',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await a.dispose();
      expect((await iterator.next()).done).toBe(true);
    });
  }, 30_000);

  it('joins a retained binding when disposing during a held HTTP request', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const admitted = start(a, 'Held request for disposal');
      await original.entered;
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-after-disposal',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await a.dispose();
      original.release();
      await admitted;
      successful(await start(b, 'Sibling after disposal'));
      expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
        'capture-b',
      ]);
    });
  }, 30_000);

  it('releases a replaced binding after aborting its held request', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const controller = new AbortController();
      const admitted = collect(
        a.stream('Held request', {
          signal: controller.signal,
          promptId: 'abort-bound-run',
          mcpDiscovery: 'skip',
        }),
      );
      await original.entered;
      await a.profiles.applySnapshot({
        version: 1,
        provider: 'openai',
        model: 'capture-after-abort',
        modelParams: { temperature: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      controller.abort();
      original.release();
      await admitted;
      successful(await start(a, 'After aborted request'));
      successful(await start(b, 'Independent request'));
      expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
        'capture-after-abort',
        'capture-b',
      ]);
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'capture-a',
      ]);
    });
  }, 30_000);

  it('rejects a 401 on a replaced same-label LB member and uses the replacement next run', async () => {
    await withOwners(
      async (a, b, original, replacement, start) => {
        const profiles = new ProfileManager();
        await profiles.saveProfile('same-label-member', {
          version: 1,
          provider: 'openai',
          model: 'same-label-old',
          modelParams: { temperature: 0.2 },
          ephemeralSettings: {
            'base-url': original.url,
            'auth-key': 'same-label-old-secret',
          },
        });
        const lb: LoadBalancerProfile = {
          version: 1,
          type: 'loadbalancer',
          provider: '',
          model: '',
          modelParams: {},
          ephemeralSettings: {},
          policy: 'roundrobin',
          profiles: ['same-label-member'],
        };
        await a.profiles.applySnapshot(lb);
        const admitted = start(a, 'Original LB authorization');
        await original.entered;
        await profiles.saveProfile('same-label-member', {
          version: 1,
          provider: 'openai',
          model: 'same-label-new',
          modelParams: { temperature: 0.8 },
          ephemeralSettings: {
            'base-url': replacement.url,
            'auth-key': 'same-label-new-secret',
          },
        });
        await a.profiles.applySnapshot(lb);
        successful(await start(b, 'Unchanged sibling'));
        original.release();
        expect(
          (await admitted).events.some((event) => event.type === 'error'),
        ).toBe(true);
        expect(original.requests().map(({ model }) => model)).toStrictEqual([
          'same-label-old',
        ]);
        successful(await start(a, 'New LB authorization'));
        expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
          'capture-b',
          'same-label-new',
        ]);
      },
      false,
      false,
      1,
      1,
      false,
      401,
    );
  }, 30_000);

  it('does not reuse a revoked inline LB member credential after replacement', async () => {
    await withOwners(async (a, _b, original, replacement, start) => {
      const profiles = new ProfileManager();
      await profiles.saveProfile('old-auth-member', {
        version: 1,
        provider: 'openai',
        model: 'old-auth-model',
        modelParams: {},
        ephemeralSettings: {
          'base-url': original.url,
          'auth-key': 'old-member-secret',
        },
      });
      await profiles.saveProfile('new-auth-member', {
        version: 1,
        provider: 'openai',
        model: 'new-auth-model',
        modelParams: {},
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'new-member-secret',
        },
      });
      const lb = (name: string): LoadBalancerProfile => ({
        version: 1,
        type: 'loadbalancer',
        provider: '',
        model: '',
        modelParams: {},
        ephemeralSettings: {},
        policy: 'roundrobin',
        profiles: [name],
      });
      await a.profiles.applySnapshot(lb('old-auth-member'));
      const admitted = start(a, 'Before LB auth change');
      await original.entered;
      await a.profiles.applySnapshot(lb('new-auth-member'));
      a.injectSteer('Revoked credential must not be reused');
      original.release();
      expect(
        (await admitted).events.some((event) => event.type === 'error'),
      ).toBe(true);
      expect(original.requests().map(({ model }) => model)).toStrictEqual([
        'old-auth-model',
      ]);
      successful(await start(a, 'New LB key admission'));
      expect(replacement.requests().map(({ model }) => model)).toStrictEqual([
        'new-auth-model',
      ]);
    });
  }, 30_000);
});
