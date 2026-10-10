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
import { successful, withOwners } from './turn-revision-capture.fixture.js';

describe('Public admitted-turn request capture (#2616 C/S2)', () => {
  it.each(['unchanged', 'temperature'])(
    'keeps admitted request values through a steered continuation: %s',
    async (mutation) => {
      await withOwners(async (a, b, endpointA, endpointB, start) => {
        expect(a.getRuntimeId()).toBe(b.getRuntimeId());
        const first = start(a, 'First admitted request');
        await Promise.race([
          endpointA.entered,
          first.then((result) => {
            throw new Error(
              `Turn ended before HTTP barrier: ${JSON.stringify(result)}`,
            );
          }),
        ]);
        const busy = await start(a, 'Must not be admitted');
        expect(busy.rejection).toBeInstanceOf(AgentBusyError);
        expect(endpointA.requests()).toHaveLength(1);
        const original = endpointA.requests()[0];
        expect(original).toMatchObject({
          model: 'capture-a',
          temperature: 0.2,
        });
        if (mutation === 'temperature') a.setModelParam('temperature', 0.9);
        a.injectSteer('Include this in the same admitted run');
        successful(await start(b, 'Independent sibling while A is blocked'));
        expect(endpointB.requests()).toMatchObject([
          { model: 'capture-b', temperature: 0.7 },
        ]);
        endpointA.release();
        successful(await first);
        successful(await start(a, 'Next ordinary turn'));
        successful(await start(b, 'Sibling remains unchanged'));
        expect(endpointA.requests()).toHaveLength(3);
        expect(endpointB.requests()).toHaveLength(2);
        expect(endpointB.requests()[1]).toMatchObject({
          model: 'capture-b',
          temperature: 0.7,
        });
        expect(endpointA.requests()[2]).toMatchObject({
          model: 'capture-a',
          temperature: mutation === 'temperature' ? 0.9 : 0.2,
        });
        expect(JSON.stringify(endpointA.requests()[1]?.messages)).toContain(
          'Include this in the same admitted run',
        );
        expect(endpointA.requests()[1]).toMatchObject({
          model: original.model,
          temperature: original.temperature,
        });
      });
    },
    30_000,
  );
});

describe('Foreground admitted model parameter ownership on the HTTP wire', () => {
  it('keeps added and cleared keys out of an admitted continuation and reads them next turn', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      a.setModelParam('top_p', 0.4);
      const first = start(a, 'Admission before parameter changes');
      await endpoint.entered;
      a.clearModelParam('top_p');
      a.setModelParam('frequency_penalty', 0.6);
      a.injectSteer('Continue with captured parameters');
      endpoint.release();
      successful(await first);
      successful(await start(a, 'Next admission sees add and clear'));
      expect(endpoint.requests()).toMatchObject([
        { top_p: 0.4, temperature: 0.2 },
        { top_p: 0.4, temperature: 0.2 },
        { frequency_penalty: 0.6, temperature: 0.2 },
      ]);
      expect(endpoint.requests()[1]).not.toHaveProperty('frequency_penalty');
      expect(endpoint.requests()[2]).not.toHaveProperty('top_p');
    });
  }, 30_000);

  it('treats an empty admitted parameter map as authoritative', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      a.clearModelParam('temperature');
      const first = start(a, 'Empty parameter admission');
      await endpoint.entered;
      a.setModelParam('temperature', 0.8);
      a.injectSteer('Continue without added parameter');
      endpoint.release();
      successful(await first);
      successful(await start(a, 'New parameter admission'));
      expect(endpoint.requests()[0]).not.toHaveProperty('temperature');
      expect(endpoint.requests()[1]).not.toHaveProperty('temperature');
      expect(endpoint.requests()[2]).toMatchObject({ temperature: 0.8 });
    });
  }, 30_000);

  it('owns nested caller data but captures new values on a later admission after reset', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      const stop = ['before'];
      a.setModelParam('stop', stop);
      const first = start(a, 'Nested admission');
      await endpoint.entered;
      stop.push('after');
      a.injectSteer('Continue with the first stop array');
      endpoint.release();
      successful(await first);
      expect(stop).toStrictEqual(['before', 'after']);
      expect(endpoint.requests()[0]).toMatchObject({ stop: ['before'] });
      expect(endpoint.requests()[1]).toMatchObject({ stop: ['before'] });
      a.setModelParam('stop', ['replacement']);
      await a.resetChat();
      successful(await start(a, 'Admission after reset'));
      expect(endpoint.requests()[2]).toMatchObject({ stop: ['replacement'] });
    });
  }, 30_000);

  it('rejects invalid nested wire data before HTTP and releases admission', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      a.setModelParam('stop', ['ok', undefined]);
      const failed = await start(a, 'Invalid admission');
      expect(failed.rejection).toBeInstanceOf(TypeError);
      expect(String(failed.rejection)).toContain('modelParams.stop[1]');
      expect(endpoint.requests()).toHaveLength(0);
      a.setModelParam('stop', ['valid']);
      const next = start(a, 'Successful admission after failure');
      await endpoint.entered;
      endpoint.release();
      successful(await next);
      expect(endpoint.requests()[0]).toMatchObject({ stop: ['valid'] });
    });
  }, 30_000);
  it('captures generic maxOutputTokens fallback while native max_tokens wins', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      a.setEphemeralSetting('maxOutputTokens', 111);
      const first = start(a, 'Generic token fallback admission');
      await endpoint.entered;
      a.setEphemeralSetting('maxOutputTokens', 222);
      a.injectSteer('Continue with admitted generic token limit');
      endpoint.release();
      successful(await first);
      expect(endpoint.requests()[0]).toMatchObject({ max_tokens: 111 });
      expect(endpoint.requests()[1]).toMatchObject({ max_tokens: 111 });
      a.setModelParam('max_tokens', 333);
      successful(await start(a, 'Native token parameter overrides generic'));
      expect(endpoint.requests()[2]).toMatchObject({ max_tokens: 333 });
      a.clearModelParam('max_tokens');
      a.setEphemeralSetting('maxOutputTokens', undefined);
      successful(await start(a, 'Absent generic fallback stays absent'));
      expect(endpoint.requests()[3]).not.toHaveProperty('max_tokens');
    });
  }, 30_000);
  it('reapplies a saved profile with the same provider and model for a fresh admission', async () => {
    await withOwners(async (a, _b, endpoint, _other, start) => {
      await a.profiles.saveCurrent('same-binding');
      const first = start(a, 'Saved profile baseline');
      await endpoint.entered;
      endpoint.release();
      successful(await first);
      expect(endpoint.requests()[0]).toMatchObject({ temperature: 0.2 });
      a.setModelParam('temperature', 0.9);
      successful(await start(a, 'Changed parameter before reapply'));
      expect(endpoint.requests()[1]).toMatchObject({ temperature: 0.9 });
      await a.profiles.apply('same-binding');
      successful(await start(a, 'Same provider and model after reapply'));
      expect(endpoint.requests()[2]).toMatchObject({ temperature: 0.2 });
    });
  }, 30_000);
});

describe('Foreground admitted provider and model binding on the HTTP wire', () => {
  it('keeps the admitted direct endpoint and model during profile replacement, without changing a sibling or the next admission', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const admitted = start(a, 'Admit original direct provider');
      await original.entered;
      expect(original.requests()[0]).toMatchObject({
        model: 'capture-a',
        temperature: 0.2,
      });
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
      a.injectSteer('Continue on the admitted direct binding');
      successful(await start(b, 'Sibling keeps its provider'));
      original.release();
      const completed = await admitted;
      successful(
        await start(a, 'New admission uses the committed replacement'),
      );
      expect(
        replacement
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-b', temperature: 0.7 },
        { model: 'capture-replacement', temperature: 0.8 },
      ]);
      successful(completed);
      expect(
        original
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
      ]);
      expect(JSON.stringify(original.requests()[1]?.messages)).toContain(
        'Continue on the admitted direct binding',
      );
    });
  }, 30_000);

  it('retains the admitted binding and the next ordinary turn after failed replacement rollback', async () => {
    await withOwners(async (a, b, original, sibling, start) => {
      const admitted = start(a, 'Direct request before failed replacement');
      await original.entered;
      await expect(
        a.profiles.applySnapshot({
          version: 1,
          provider: 'unregistered-provider',
          model: 'unregistered-model',
          modelParams: {},
          ephemeralSettings: {},
        }),
      ).rejects.toThrow("Provider 'unregistered-provider' is not available");
      expect(a.getProvider()).toBe('openai');
      expect(a.getModel()).toBe('capture-a');
      a.injectSteer('Still using the original provider after rollback');
      successful(await start(b, 'Sibling after failed replacement'));
      original.release();
      successful(await admitted);
      successful(await start(a, 'Fresh admission after rollback'));
      expect(
        original
          .requests()
          .map(({ model, temperature }) => ({ model, temperature })),
      ).toStrictEqual([
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
        { model: 'capture-a', temperature: 0.2 },
      ]);
      expect(sibling.requests()).toMatchObject([
        { model: 'capture-b', temperature: 0.7 },
      ]);
    });
  }, 30_000);

  it('keeps the original load-balancer member and model across replacement and a failed replacement rollback', async () => {
    await withOwners(async (a, b, original, replacement, start) => {
      const profiles = new ProfileManager();
      await profiles.saveProfile('binding-original', {
        version: 1,
        provider: 'openai',
        model: 'old-member-model',
        modelParams: { presence_penalty: 0.2 },
        ephemeralSettings: {
          'base-url': original.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await profiles.saveProfile('binding-replacement', {
        version: 1,
        provider: 'openai',
        model: 'new-member-model',
        modelParams: { presence_penalty: 0.8 },
        ephemeralSettings: {
          'base-url': replacement.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      const lb = (members: string[]): LoadBalancerProfile => ({
        version: 1,
        type: 'loadbalancer',
        provider: '',
        model: '',
        modelParams: { temperature: 0.3 },
        ephemeralSettings: {},
        policy: 'roundrobin',
        profiles: members,
      });
      await a.profiles.applySnapshot(lb(['binding-original']));
      const admitted = start(a, 'Admit the original LB instance');
      await original.entered;
      expect(original.requests()[0]).toMatchObject({
        model: 'old-member-model',
        presence_penalty: 0.2,
        temperature: 0.3,
      });
      await expect(
        a.profiles.applySnapshot(lb(['nonexistent-binding-member'])),
      ).rejects.toThrow(
        'references profile "nonexistent-binding-member" which does not exist',
      );
      expect(a.getProvider()).toBe('load-balancer');
      await a.profiles.applySnapshot(lb(['binding-replacement']));
      a.injectSteer('Continue on the original LB instance');
      successful(await start(b, 'Independent sibling after LB replacement'));
      original.release();
      const completed = await admitted;
      successful(await start(a, 'New admission uses replacement LB member'));
      expect(replacement.requests()).toMatchObject([
        { model: 'capture-b', temperature: 0.7 },
        {
          model: 'new-member-model',
          presence_penalty: 0.8,
          temperature: 0.3,
        },
      ]);
      successful(completed);
      expect(
        original.requests().map(({ model, temperature, presence_penalty }) => ({
          model,
          temperature,
          presence_penalty,
        })),
      ).toStrictEqual([
        {
          model: 'old-member-model',
          presence_penalty: 0.2,
          temperature: 0.3,
        },
        {
          model: 'old-member-model',
          presence_penalty: 0.2,
          temperature: 0.3,
        },
      ]);
    });
  }, 30_000);
});

describe('Public load-balanced foreground admission on the HTTP wire', () => {
  it('retains member-specific and LB overrides across a steered rotation', async () => {
    await withOwners(async (a, b, firstEndpoint, secondEndpoint, start) => {
      const profiles = new ProfileManager();
      const member = (url: string, weight: number) => ({
        version: 1,
        provider: 'openai',
        model: 'capture-member',
        modelParams: { temperature: 0.1, presence_penalty: weight },
        ephemeralSettings: {
          'base-url': url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await profiles.saveProfile(
        'first-member',
        member(firstEndpoint.url, 0.2),
      );
      await profiles.saveProfile(
        'second-member',
        member(secondEndpoint.url, 0.4),
      );
      const lbProfile: LoadBalancerProfile = {
        version: 1,
        type: 'loadbalancer',
        provider: '',
        model: '',
        modelParams: { temperature: 0.3 },
        ephemeralSettings: {},
        policy: 'roundrobin',
        profiles: ['first-member', 'second-member'],
      };
      await a.profiles.applySnapshot(lbProfile);
      const admitted = start(a, 'Request through first member');
      await Promise.race([
        firstEndpoint.entered,
        admitted.then((result) => {
          throw new Error(
            `LB ended before HTTP barrier: ${JSON.stringify(result)}`,
          );
        }),
      ]);
      expect(firstEndpoint.requests()[0]).toMatchObject({
        temperature: 0.3,
        presence_penalty: 0.2,
      });
      a.setModelParam('temperature', 0.8);
      await profiles.saveProfile(
        'second-member',
        member(secondEndpoint.url, 0.9),
      );
      a.injectSteer('Rotate through the second member');
      successful(await start(b, 'Independent sibling'));
      expect(secondEndpoint.requests()[0]).toMatchObject({
        model: 'capture-b',
        temperature: 0.7,
      });
      firstEndpoint.release();
      successful(await admitted);
      expect(secondEndpoint.requests()[1]).toMatchObject({
        temperature: 0.3,
        presence_penalty: 0.4,
      });
      expect(JSON.stringify(secondEndpoint.requests()[1]?.messages)).toContain(
        'Rotate through the second member',
      );
      successful(await start(a, 'Fresh LB admission'));
      expect(firstEndpoint.requests()[1]).toMatchObject({
        temperature: 0.8,
        presence_penalty: 0.2,
      });
      await a.profiles.applySnapshot(lbProfile);
      successful(await start(a, 'Fresh first-member admission after reload'));
      successful(await start(a, 'Fresh second-member admission after reload'));
      expect(secondEndpoint.requests().slice(-1)[0]).toMatchObject({
        temperature: 0.3,
        presence_penalty: 0.9,
      });
      expect(
        secondEndpoint
          .requests()
          .filter((request) => request.model === 'capture-b'),
      ).toHaveLength(1);
    });
  }, 30_000);
  it('uses the captured second member on a real failed HTTP attempt', async () => {
    await withOwners(async (a, _b, primary, secondary, start) => {
      const profiles = new ProfileManager();
      await profiles.saveProfile('fail-primary', {
        version: 1,
        provider: 'openai',
        model: 'primary-model',
        modelParams: { presence_penalty: 0.2 },
        ephemeralSettings: {
          'base-url': primary.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await profiles.saveProfile('success-secondary', {
        version: 1,
        provider: 'openai',
        model: 'secondary-model',
        modelParams: { presence_penalty: 0.4 },
        ephemeralSettings: {
          'base-url': secondary.url,
          'auth-key': 'turn-capture-local-only',
        },
      });
      await a.profiles.applySnapshot({
        version: 1,
        type: 'loadbalancer',
        provider: '',
        model: '',
        modelParams: { temperature: 0.3 },
        ephemeralSettings: {},
        policy: 'failover',
        profiles: ['fail-primary', 'success-secondary'],
      });
      const admitted = start(a, 'Try primary before failing over');
      await primary.entered;
      a.setModelParam('temperature', 0.8);
      primary.release();
      successful(await admitted);
      expect(primary.requests()[0]).toMatchObject({
        temperature: 0.3,
        presence_penalty: 0.2,
      });
      expect(secondary.requests()[0]).toMatchObject({
        temperature: 0.3,
        presence_penalty: 0.4,
      });
      successful(
        await start(a, 'Next ordinary admission uses updated override'),
      );
      expect(secondary.requests().slice(-1)[0]).toMatchObject({
        temperature: 0.8,
      });
    }, true);
  }, 30_000);
});
