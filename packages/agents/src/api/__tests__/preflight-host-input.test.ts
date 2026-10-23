/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { deferred } from './helpers/shell-owner-gate.js';
import {
  captureAgentPreflightHostInput,
  requestAgentPreflightOAuth,
  openAgentPreflightBrowser,
} from '../preflight-host-input.js';

describe('agents preflight host input', () => {
  it('captures activation and settings data independently of the host document', () => {
    const document = {
      runtimeId: 'same-label',
      initialSettings: { nested: { value: 1 } },
      metadata: { stage: 'profile-bootstrap' },
      activation: { provider: 'openai', modelParams: { temperature: 0.2 } },
    };
    const captured = captureAgentPreflightHostInput(document);
    document.initialSettings.nested.value = 2;
    document.activation.modelParams.temperature = 0.8;
    expect(captured.initialSettings).toStrictEqual({ nested: { value: 1 } });
    expect(captured.activation?.modelParams).toStrictEqual({
      temperature: 0.2,
    });
  });

  it.each(['', '   ', '\t'])(
    'rejects an empty runtime label %j',
    (runtimeId) => {
      expect(() => captureAgentPreflightHostInput({ runtimeId })).toThrow(
        /runtimeId/,
      );
    },
  );

  it('rejects host-constructed owners in the declarative input', () => {
    expect(() =>
      captureAgentPreflightHostInput({
        runtimeId: 'owner',
        providerManager: {},
      }),
    ).toThrow(/providerManager/);
    expect(() =>
      captureAgentPreflightHostInput({
        runtimeId: 'owner',
        initialSettings: { read: () => 'secret' },
      }),
    ).toThrow(/initialSettings/);
  });

  it('validates the same activation intent accepted by agent construction', () => {
    expect(() =>
      captureAgentPreflightHostInput({
        runtimeId: 'owner',
        activation: { authMode: 'unexpected' },
      }),
    ).toThrow(/authMode/);
  });
  it('rejects constructed objects nested in settings data', () => {
    class HostOwner {
      read(): string {
        return 'owner';
      }
    }
    expect(() =>
      captureAgentPreflightHostInput({
        runtimeId: 'owner',
        initialSettings: { nestedOwner: new HostOwner() },
      }),
    ).toThrow(/initialSettings/);
  });
});

describe('preflight host OAuth and browser requests', () => {
  it('fails when an OAuth request has no host capability', async () => {
    await expect(
      requestAgentPreflightOAuth(
        undefined,
        { provider: 'openai', url: 'https://example.test/auth' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('OAuth request capability');
  });

  it('routes equal-label OAuth requests to their supplied hosts', async () => {
    const first = await requestAgentPreflightOAuth(
      { request: async (prompt) => prompt.provider === 'openai' },
      { provider: 'openai', url: 'https://example.test/a' },
      new AbortController().signal,
    );
    const second = await requestAgentPreflightOAuth(
      { request: async (prompt) => prompt.url.endsWith('/b') },
      { provider: 'openai', url: 'https://example.test/a' },
      new AbortController().signal,
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('does not enter a host capability after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('preflight cancelled'));
    await expect(
      requestAgentPreflightOAuth(
        {
          request: async () => {
            throw new Error('host entered');
          },
        },
        { provider: 'openai', url: 'https://example.test/auth' },
        controller.signal,
      ),
    ).rejects.toThrow('preflight cancelled');
  });

  it('rejects an OAuth response after its request has been cancelled', async () => {
    const controller = new AbortController();
    await expect(
      requestAgentPreflightOAuth(
        {
          request: async () => {
            controller.abort(new Error('preflight cancelled'));
            return true;
          },
        },
        { provider: 'openai', url: 'https://example.test/auth' },
        controller.signal,
      ),
    ).rejects.toThrow('preflight cancelled');
  });

  it('fails when browser launch has no host capability', async () => {
    await expect(
      openAgentPreflightBrowser(
        undefined,
        'https://example.test/auth',
        new AbortController().signal,
      ),
    ).rejects.toThrow('browser request capability');
  });

  it('propagates browser capability failure without a fallback', async () => {
    await expect(
      openAgentPreflightBrowser(
        {
          open: async () => {
            throw new Error('browser unavailable');
          },
        },
        'https://example.test/auth',
        new AbortController().signal,
      ),
    ).rejects.toThrow('browser unavailable');
  });

  it('awaits the supplied browser request', async () => {
    const controller = new AbortController();
    let opened: readonly string[] = [];
    await openAgentPreflightBrowser(
      {
        open: async (url, signal) => {
          signal.throwIfAborted();
          await Promise.resolve();
          opened = [...opened, new URL(url).pathname];
        },
      },
      'https://example.test/auth/start',
      controller.signal,
    );
    expect(opened).toStrictEqual(['/auth/start']);
  });

  it('delivers cancellation to an accepted host browser request', async () => {
    const controller = new AbortController();
    const entered = deferred<void>();
    const pending = openAgentPreflightBrowser(
      {
        open: async (_url, signal) => {
          entered.resolve();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        },
      },
      'https://example.test/auth',
      controller.signal,
    );
    await entered.promise;
    controller.abort(new Error('accepted browser cancelled'));
    await expect(pending).rejects.toThrow('accepted browser cancelled');
  });

  it('does not launch a browser for an already cancelled preflight', async () => {
    const controller = new AbortController();
    controller.abort(new Error('browser preflight cancelled'));
    await expect(
      openAgentPreflightBrowser(
        {
          open: async () => {
            throw new Error('browser entered');
          },
        },
        'https://example.test/auth',
        controller.signal,
      ),
    ).rejects.toThrow('browser preflight cancelled');
  });

  it('rejects a browser result that settles after cancellation', async () => {
    const controller = new AbortController();
    await expect(
      openAgentPreflightBrowser(
        {
          open: async () => {
            controller.abort(new Error('browser preflight cancelled'));
          },
        },
        'https://example.test/auth',
        controller.signal,
      ),
    ).rejects.toThrow('browser preflight cancelled');
  });
});
